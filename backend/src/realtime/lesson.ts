import * as Y from 'yjs';
import type { Prisma } from '@prisma/client';
import {
  DOC_ROOTS,
  computeCapabilities,
  type BoardAccessFacts,
  type BoardMode,
  type BoardSettings,
  type ClientControlMessage,
  type FollowState,
  type RaisedHand,
} from '@doska/shared';
import { SERVER_ORIGIN } from './guard.js';
import type { Connection } from './connection.js';
import type { Room } from './room.js';
import { loadBoardAccess } from '../boards/access.js';

/** Команды урока (всё, кроме hello и ping). */
export type LessonCommand = Exclude<ClientControlMessage, { t: 'hello' } | { t: 'ping' }>;

/** «Следуйте за мной»: не чаще 15 обновлений вида в секунду. */
export const FOLLOW_MIN_INTERVAL_MS = 1000 / 15;

/** Сколько объектов удаляется в одной серверной транзакции очистки. */
const MAX_CLEAR_OBJECTS = 100_000;

class LessonError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'BAD_REQUEST',
    message: string,
  ) {
    super(message);
  }
}

const forbid = (message: string) => new LessonError('FORBIDDEN', message);

/**
 * Управление уроком в комнате: режим, мел, поднятые руки, «Следуйте за
 * мной», очистка следов учеников, настройки доски.
 *
 * Права проверяются по capabilities соединения (общая функция
 * computeCapabilities). Режим, мел и настройки хранятся в БД; руки и
 * «Следуйте за мной» — только в памяти комнаты (это состояние урока «здесь
 * и сейчас», после выгрузки доски оно не нужно).
 *
 * Команды одной комнаты выполняются строго по очереди: иначе, например,
 * «дать мел» и «забрать у всех» могли бы записаться в БД в обратном порядке.
 */
export class Lesson {
  chalkHolders = new Set<string>();
  hands: RaisedHand[] = [];
  follow: FollowState | null = null;
  private followLeader: Connection | null = null;
  private followLastSent = 0;
  private followTimer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly room: Room) {}

  async loadChalk(): Promise<void> {
    const grants = await this.room.app.prisma.chalkGrant.findMany({
      where: { boardId: this.room.boardId },
      select: { userId: true },
    });
    this.chalkHolders = new Set(grants.map((g) => g.userId));
  }

  /** Поставить команду в очередь комнаты. */
  handle(conn: Connection, msg: LessonCommand): void {
    this.queue = this.queue
      .then(() => this.run(conn, msg))
      .catch((err: unknown) => {
        if (err instanceof LessonError) {
          conn.sendControl({ t: 'error', code: err.code, message: err.message });
          return;
        }
        this.room.app.log.error({ err, boardId: this.room.boardId, t: msg.t }, 'Ошибка команды урока');
        conn.sendControl({ t: 'error', code: 'INTERNAL', message: 'Не удалось выполнить команду' });
      });
  }

  /** Дождаться выполнения всех поставленных команд (для тестов и выгрузки). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async run(conn: Connection, msg: LessonCommand): Promise<void> {
    if (!conn.open) return;
    switch (msg.t) {
      case 'mode.set':
        return this.setMode(conn, msg.mode);
      case 'chalk.set':
        return this.setChalk(conn, msg.userId, msg.granted);
      case 'chalk.revokeAll':
        return this.revokeAllChalk(conn);
      case 'hand.raise':
        return this.raiseHand(conn);
      case 'hand.lower':
        return this.removeHand(conn.user.id);
      case 'hand.dismiss':
        return this.dismissHand(conn, msg.userId);
      case 'follow.start':
        return this.startFollow(conn, msg.viewport, msg.strict);
      case 'follow.update':
        return this.updateFollow(conn, msg.viewport, msg.scenes);
      case 'follow.stop':
        return this.stopFollow(conn);
      case 'objects.clearByAuthors':
        return this.clearByAuthors(conn, msg.authors, msg.pageId);
      case 'settings.set':
        return this.setSettings(conn, msg.settings);
    }
  }

  private requireLesson(conn: Connection, what: string): void {
    if (!conn.caps.manageLesson) throw forbid(`${what} может только учитель доски`);
    if (this.room.meta.kind !== 'LESSON') throw forbid('Эта команда доступна только на доске урока');
  }

  private actor(conn: Connection) {
    return { actorId: conn.user.id, actorLogin: conn.user.login, ip: conn.ip, userAgent: conn.userAgent };
  }

  // ------------------------------------------------------------------
  //  Пересчёт прав
  // ------------------------------------------------------------------

  /**
   * Изменить факты доступа подключённых и пересчитать права. Новые права
   * получают только те, у кого они изменились.
   */
  recompute(mutate: (facts: BoardAccessFacts, conn: Connection) => BoardAccessFacts): void {
    for (const conn of this.room.conns) {
      const facts = mutate(conn.facts, conn);
      const caps = computeCapabilities(facts);
      const changed = JSON.stringify(caps) !== JSON.stringify(conn.caps);
      conn.facts = facts;
      conn.caps = caps;
      if (changed && conn.ready) conn.sendControl({ t: 'capabilities', capabilities: caps });
    }
  }

  private broadcast(make: () => Parameters<Connection['sendControl']>[0]): void {
    const msg = make();
    for (const c of this.room.conns) if (c.ready && !c.lite) c.sendControl(msg);
  }

  // ------------------------------------------------------------------
  //  Режим
  // ------------------------------------------------------------------

  private async setMode(conn: Connection, mode: BoardMode): Promise<void> {
    this.requireLesson(conn, 'Менять режим');
    const from = this.room.meta.mode;
    if (from === mode) return;
    await this.room.app.prisma.$transaction(async (tx) => {
      await tx.board.update({ where: { id: this.room.boardId }, data: { mode } });
      await this.room.app.audit.record(
        {
          action: 'BOARD_MODE_CHANGED',
          ...this.actor(conn),
          targetType: 'board',
          targetId: this.room.boardId,
          details: { title: this.room.meta.title, from, to: mode },
        },
        tx,
      );
    });
    this.applyMode(mode, conn.user.id);
  }

  /** Новый режим уже записан в БД: пересчитать права и сообщить всем. */
  applyMode(mode: BoardMode, by: string): void {
    this.room.meta = { ...this.room.meta, mode };
    this.recompute((f) => ({ ...f, board: { ...f.board, mode } }));
    this.broadcast(() => ({ t: 'mode.changed', mode, by }));
  }

  // ------------------------------------------------------------------
  //  Мел
  // ------------------------------------------------------------------

  private async setChalk(conn: Connection, userId: string, granted: boolean): Promise<void> {
    this.requireLesson(conn, 'Выдавать мел');
    const prisma = this.room.app.prisma;
    if (granted) {
      if (this.chalkHolders.has(userId)) return;
      const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, role: true } });
      const access = target ? await loadBoardAccess(prisma, target, this.room.boardId) : null;
      if (!access || access.caps.role !== 'student') {
        throw new LessonError('BAD_REQUEST', 'Мел можно дать только ученику, допущенному к доске');
      }
      await prisma.chalkGrant.upsert({
        where: { boardId_userId: { boardId: this.room.boardId, userId } },
        create: { boardId: this.room.boardId, userId, grantedById: conn.user.id },
        update: {},
      });
      this.chalkHolders.add(userId);
      this.applyChalk();
      // Ученику дали слово — рука опускается.
      if (this.dropHand(userId)) this.broadcastHands();
      return;
    }
    if (!this.chalkHolders.has(userId)) return;
    await prisma.chalkGrant.deleteMany({ where: { boardId: this.room.boardId, userId } });
    this.chalkHolders.delete(userId);
    this.applyChalk();
  }

  private async revokeAllChalk(conn: Connection): Promise<void> {
    this.requireLesson(conn, 'Забирать мел');
    if (this.chalkHolders.size === 0) return;
    await this.room.app.prisma.chalkGrant.deleteMany({ where: { boardId: this.room.boardId } });
    this.chalkHolders.clear();
    this.applyChalk();
  }

  /** Сообщить всем текущих владельцев мела и пересчитать права. */
  applyChalk(): void {
    this.recompute((f, c) => ({ ...f, hasChalk: this.chalkHolders.has(c.user.id) }));
    this.broadcast(() => ({ t: 'chalk.changed', holders: [...this.chalkHolders] }));
  }

  // ------------------------------------------------------------------
  //  Поднятые руки
  // ------------------------------------------------------------------

  private raiseHand(conn: Connection): void {
    if (!conn.caps.raiseHand) throw forbid('Поднимать руку могут ученики');
    if (this.hands.some((h) => h.userId === conn.user.id)) return;
    this.hands = [...this.hands, { userId: conn.user.id, fullName: conn.user.fullName, at: Date.now() }];
    this.broadcastHands();
  }

  private removeHand(userId: string): void {
    if (this.dropHand(userId)) this.broadcastHands();
  }

  private dismissHand(conn: Connection, userId: string): void {
    this.requireLesson(conn, 'Опускать руку ученику');
    if (!this.dropHand(userId)) return;
    for (const c of this.room.conns) {
      if (c.user.id === userId && c.ready) {
        c.sendControl({ t: 'notice', level: 'info', code: 'HAND_DISMISSED', message: 'Учитель опустил вашу руку' });
      }
    }
    this.broadcastHands();
  }

  /** Убрать руку без рассылки (рассылает вызывающий); true — рука была поднята. */
  private dropHand(userId: string): boolean {
    const next = this.hands.filter((h) => h.userId !== userId);
    if (next.length === this.hands.length) return false;
    this.hands = next;
    return true;
  }

  private broadcastHands(): void {
    const hands = this.hands;
    this.broadcast(() => ({ t: 'hands', hands }));
  }

  // ------------------------------------------------------------------
  //  «Следуйте за мной»
  // ------------------------------------------------------------------

  private startFollow(conn: Connection, viewport: FollowState['viewport'], strict: boolean): void {
    if (!conn.caps.leadFollow) throw forbid('Вести показ может только учитель');
    this.clearFollowTimer();
    this.followLeader = conn;
    this.follow = { leaderId: conn.user.id, leaderName: conn.user.fullName, viewport, scenes: [], strict };
    this.followLastSent = Date.now();
    this.broadcastFollow();
  }

  private updateFollow(conn: Connection, viewport: FollowState['viewport'], scenes: FollowState['scenes']): void {
    // Обновления от того, кто показ не ведёт, молча игнорируются: они могут
    // прийти уже после того, как другой учитель перехватил показ.
    if (!this.follow || this.followLeader !== conn) return;
    this.follow = { ...this.follow, viewport, scenes };
    const wait = FOLLOW_MIN_INTERVAL_MS - (Date.now() - this.followLastSent);
    if (wait <= 0) {
      this.followLastSent = Date.now();
      this.broadcastFollow();
    } else {
      // Слишком часто: последнее состояние уйдёт по таймеру.
      this.followTimer ??= setTimeout(() => {
        this.followTimer = null;
        this.followLastSent = Date.now();
        if (this.follow) this.broadcastFollow();
      }, wait);
    }
  }

  private stopFollow(conn: Connection): void {
    if (!this.follow) return;
    if (this.follow.leaderId !== conn.user.id && !conn.caps.manageLesson) throw forbid('Показ ведёт другой учитель');
    this.endFollow();
  }

  private endFollow(): void {
    this.clearFollowTimer();
    this.follow = null;
    this.followLeader = null;
    this.broadcastFollow();
  }

  private clearFollowTimer(): void {
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = null;
  }

  private broadcastFollow(): void {
    const state = this.follow;
    this.broadcast(() => ({ t: 'follow.state', state }));
  }

  // ------------------------------------------------------------------
  //  Очистка следов учеников
  // ------------------------------------------------------------------

  private async clearByAuthors(conn: Connection, authors: 'students' | string[], pageId: string | null): Promise<void> {
    if (!conn.caps.clearStudentObjects) throw forbid('Очищать записи учеников может только учитель');
    const room = this.room;
    const authorSet = authors === 'students' ? null : new Set(authors);
    const pick = () =>
      room.guard
        .findObjects(
          (info) =>
            !info.authorIsModerator &&
            (authorSet === null || authorSet.has(info.createdBy)) &&
            (pageId === null || info.pageId === pageId),
        )
        .slice(0, MAX_CLEAR_OBJECTS);

    if (pick().length === 0) {
      conn.sendControl({ t: 'notice', level: 'info', code: 'BOARD_CLEARED', message: 'Записей учеников не найдено — очищать нечего' });
      return;
    }
    // Снимок до очистки: учитель сможет вернуть всё из истории версий.
    await room.persistence.createVersion('BEFORE_CLEAR', conn.user.id, 'Перед очисткой записей учеников');
    const ids = pick(); // документ мог измениться, пока сохранялся снимок
    const removed = room.applyServerChange(() => removeObjects(room.doc, ids));
    if (removed === 0) return;

    const names = await this.authorNames(authorSet);
    await room.app.audit.record({
      action: 'BOARD_CLEARED',
      ...this.actor(conn),
      targetType: 'board',
      targetId: room.boardId,
      details: { title: room.meta.title, authors: authors === 'students' ? 'students' : authors, pageId, objects: removed },
    });
    const whose = names ? `ученика ${names}` : 'учеников';
    const where = pageId ? ' на странице' : '';
    this.broadcast(() => ({
      t: 'notice',
      level: 'info',
      code: 'BOARD_CLEARED',
      message: `${conn.user.fullName} очистил(а) записи ${whose}${where}: ${removed}`,
    }));
  }

  private async authorNames(authors: Set<string> | null): Promise<string | null> {
    if (!authors || authors.size !== 1) return null;
    const u = await this.room.app.prisma.user.findUnique({ where: { id: [...authors][0]! }, select: { fullName: true } });
    return u?.fullName ?? null;
  }

  // ------------------------------------------------------------------
  //  Настройки
  // ------------------------------------------------------------------

  private async setSettings(conn: Connection, patch: Partial<BoardSettings>): Promise<void> {
    if (!conn.caps.manageLesson) throw forbid('Настройки доски меняет учитель');
    const settings: BoardSettings = { ...this.room.meta.settings, ...patch };
    if (JSON.stringify(settings) === JSON.stringify(this.room.meta.settings)) return;
    await this.room.app.prisma.board.update({
      where: { id: this.room.boardId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    this.applySettings(settings);
  }

  applySettings(settings: BoardSettings): void {
    this.room.meta = { ...this.room.meta, settings };
    this.recompute((f) => ({ ...f, board: { ...f.board, settings } }));
    this.broadcast(() => ({ t: 'settings.changed', settings }));
  }

  // ------------------------------------------------------------------
  //  Отключения
  // ------------------------------------------------------------------

  /** Соединение закрыто: показ ведущего прекращается, рука ушедшего опускается. */
  onDetach(conn: Connection): void {
    if (this.followLeader === conn) {
      // Ведущий открыл доску в другой вкладке того же устройства — показ
      // продолжается от неё; иначе прекращается.
      const other = [...this.room.conns].find((c) => c.user.id === conn.user.id && c.caps.leadFollow && c.ready && !c.lite);
      if (other) this.followLeader = other;
      else this.endFollow();
    }
    if (![...this.room.conns].some((c) => c.user.id === conn.user.id && !c.lite)) this.removeHand(conn.user.id);
  }

  destroy(): void {
    this.clearFollowTimer();
  }
}

/**
 * Удаление объектов в документе с наведением порядка в группах: дети
 * удалённой группы переходят в её родительскую группу, а группы, у которых
 * не осталось детей, удаляются. Возвращает число удалённых объектов.
 */
export function removeObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = doc.getMap(DOC_ROOTS.objects) as Y.Map<Y.Map<unknown>>;
  const removed = new Set(ids.filter((id) => objects.has(id)));
  if (removed.size === 0) return 0;
  const groupOf = (id: string) => (objects.get(id)?.get('groupId') as string | null | undefined) ?? null;

  // Новый родитель для детей удаляемых групп: ближайший неудаляемый предок.
  const survivingParent = (groupId: string | null): string | null => {
    let g = groupId;
    const seen = new Set<string>();
    while (g && removed.has(g) && !seen.has(g)) {
      seen.add(g);
      g = groupOf(g);
    }
    return g && objects.has(g) ? g : null;
  };

  // Группы, у которых были дети среди удаляемых: после удаления могут опустеть.
  const touchedGroups = new Set<string>();
  for (const id of removed) {
    const g = groupOf(id);
    if (g) touchedGroups.add(g);
  }

  let count = 0;
  doc.transact(() => {
    for (const [id, obj] of objects) {
      if (removed.has(id)) continue;
      const g = obj.get('groupId') as string | null;
      if (g && removed.has(g)) obj.set('groupId', survivingParent(g));
    }
    for (const id of removed) {
      objects.delete(id);
      count++;
    }
    // Пустые группы (после удаления всех их детей) убираются, вверх по цепочке.
    const childCount = new Map<string, number>();
    for (const [, obj] of objects) {
      const g = obj.get('groupId') as string | null;
      if (g) childCount.set(g, (childCount.get(g) ?? 0) + 1);
    }
    let queue = [...touchedGroups].filter((g) => !removed.has(g));
    while (queue.length) {
      const next: string[] = [];
      for (const g of queue) {
        const obj = objects.get(g);
        if (!obj || obj.get('type') !== 'core.group' || (childCount.get(g) ?? 0) > 0) continue;
        const parent = obj.get('groupId') as string | null;
        objects.delete(g);
        count++;
        if (parent) {
          childCount.set(parent, (childCount.get(parent) ?? 1) - 1);
          next.push(parent);
        }
      }
      queue = next;
    }
  }, SERVER_ORIGIN);
  return count;
}
