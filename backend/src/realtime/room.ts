import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { FastifyInstance } from 'fastify';
import {
  BOARD_KINDS,
  CloseCode,
  DENY_MESSAGES,
  LIMITS,
  MessageType,
  PROTOCOL_VERSION,
  awarenessStateSchema,
  decodeClientControl,
  parseBoardSettings,
  readFrameType,
  type BoardKind,
  type BoardMode,
  type BoardSettings,
  type ClientControlMessage,
} from '@doska/shared';
import { DocGuard, GuardError, SERVER_ORIGIN } from './guard.js';
import { BoardPersistence, type PersistenceOptions } from './persistence.js';
import { Connection } from './connection.js';
import { loadBoardAccess, loadModeratorIds } from '../boards/access.js';

interface BoardMeta {
  title: string;
  kind: BoardKind;
  mode: BoardMode;
  ownerId: string;
  settings: BoardSettings;
}

/**
 * Комната — одна загруженная в память доска: Yjs-документ, awareness,
 * проверка прав, сохранение и подключённые клиенты.
 */
export class Room {
  readonly conns = new Set<Connection>();
  readonly awareness: awarenessProtocol.Awareness;
  readonly guard: DocGuard;
  unloadTimer: NodeJS.Timeout | null = null;

  private constructor(
    private readonly app: FastifyInstance,
    readonly boardId: string,
    readonly doc: Y.Doc,
    readonly persistence: BoardPersistence,
    public meta: BoardMeta,
    moderatorIds: Set<string>,
  ) {
    this.guard = new DocGuard(doc);
    this.guard.moderatorIds = moderatorIds;
    this.awareness = new awarenessProtocol.Awareness(doc);
    // У сервера нет собственного присутствия.
    this.awareness.setLocalState(null);
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed];
      if (!changed.length) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.Awareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  static async load(app: FastifyInstance, boardId: string, persistenceOpts: PersistenceOptions): Promise<Room> {
    const board = await app.prisma.board.findFirst({ where: { id: boardId, deletedAt: null } });
    if (!board) throw new Error('Доска не найдена');
    const doc = await BoardPersistence.load(app.prisma, boardId, board.ownerId);
    const persistence = new BoardPersistence(app.prisma, boardId, doc, app.log, persistenceOpts);
    return new Room(
      app,
      boardId,
      doc,
      persistence,
      {
        title: board.title,
        kind: board.kind,
        mode: board.mode,
        ownerId: board.ownerId,
        settings: parseBoardSettings(board.settings),
      },
      await loadModeratorIds(app.prisma, boardId),
    );
  }

  attach(conn: Connection): void {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
      this.unloadTimer = null;
    }
    this.conns.add(conn);
  }

  detach(conn: Connection): void {
    this.conns.delete(conn);
    if (conn.awarenessClients.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessClients], 'disconnect');
    }
  }

  broadcast(data: Uint8Array, except?: Connection): void {
    for (const c of this.conns) if (c !== except && c.ready) c.send(data);
  }

  // ------------------------------------------------------------------
  //  Входящие сообщения
  // ------------------------------------------------------------------

  handleMessage(conn: Connection, data: Uint8Array): void {
    const type = readFrameType(data);
    if (type === MessageType.Control) {
      if (!conn.buckets.control.take()) return;
      const res = decodeClientControl(data);
      if (!res.ok) return conn.close(CloseCode.ProtocolViolation, 'Неверное управляющее сообщение');
      return this.handleControl(conn, res.message);
    }
    if (!conn.ready) return conn.close(CloseCode.ProtocolViolation, 'Ожидалось сообщение hello');
    try {
      const decoder = decoding.createDecoder(data);
      decoding.readVarUint(decoder);
      switch (type) {
        case MessageType.Sync:
          return this.handleSync(conn, decoder, data.byteLength);
        case MessageType.Awareness:
          if (!conn.buckets.awareness.take()) return;
          return this.handleAwareness(conn, decoding.readVarUint8Array(decoder));
        case MessageType.QueryAwareness:
          return this.sendAwarenessTo(conn);
        default:
          return conn.close(CloseCode.ProtocolViolation, 'Неизвестный тип сообщения');
      }
    } catch (err) {
      if (err instanceof GuardError) return conn.close(CloseCode.ProtocolViolation, err.message);
      this.app.log.warn({ err, boardId: this.boardId }, 'Ошибка обработки сообщения WebSocket');
      return conn.close(CloseCode.ProtocolViolation, 'Неверный формат сообщения');
    }
  }

  private handleSync(conn: Connection, decoder: decoding.Decoder, size: number): void {
    const syncType = decoding.readVarUint(decoder);
    if (syncType === syncProtocol.messageYjsSyncStep1) {
      const sv = decoding.readVarUint8Array(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.Sync);
      syncProtocol.writeSyncStep2(encoder, this.doc, sv);
      conn.send(encoding.toUint8Array(encoder));
      return;
    }
    if (syncType !== syncProtocol.messageYjsSyncStep2 && syncType !== syncProtocol.messageYjsUpdate) {
      throw new GuardError('Неизвестный тип sync-сообщения');
    }
    // Обновления нельзя пропускать (это создало бы «дыру» в clock клиента),
    // поэтому при превышении частоты — предупреждение, при повторе — разрыв.
    if (!conn.buckets.sync.take() || !conn.buckets.syncBytes.take(size)) {
      if (!conn.rateLimited()) return;
    }
    this.applyClientUpdate(conn, decoding.readVarUint8Array(decoder));
  }

  /** Применить обновление клиента с проверкой прав и разослать результат. */
  applyClientUpdate(conn: Connection, update: Uint8Array): void {
    const captured: { update: Uint8Array; origin: unknown }[] = [];
    const onUpdate = (u: Uint8Array, origin: unknown) => captured.push({ update: u, origin });
    this.doc.on('update', onUpdate);
    let violations;
    try {
      violations = this.guard.applyClientUpdate(update, conn, { userId: conn.user.id, caps: conn.caps });
    } finally {
      this.doc.off('update', onUpdate);
    }
    if (captured.length === 0) return; // всё уже было у сервера
    const all = captured.length === 1 ? captured[0]!.update : Y.mergeUpdates(captured.map((c) => c.update));
    this.broadcast(syncUpdateFrame(all), conn);
    this.persistence.enqueue(all);

    const compensation = captured.filter((c) => c.origin === SERVER_ORIGIN);
    if (compensation.length) {
      conn.send(syncUpdateFrame(compensation.length === 1 ? compensation[0]!.update : Y.mergeUpdates(compensation.map((c) => c.update))));
    }
    if (violations.length) {
      const reason = violations[0]!.reason;
      conn.sendControl({
        t: 'notice',
        level: 'warning',
        code: 'CHANGE_REVERTED',
        reason,
        message:
          violations.length === 1
            ? `Изменение отменено: ${DENY_MESSAGES[reason].toLowerCase()}`
            : `Отменено изменений: ${violations.length}. ${DENY_MESSAGES[reason]}`,
        objectIds: violations.map((v) => v.objectId ?? v.pageId ?? '').filter(Boolean).slice(0, 1000),
      });
    }
  }

  /**
   * Awareness: принимаются только состояния собственного clientID
   * соединения; поле user подменяется данными сессии, laser/drawing
   * обнуляются без соответствующих прав.
   */
  private handleAwareness(conn: Connection, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const count = decoding.readVarUint(decoder);
    if (count > 4) throw new GuardError('Слишком много состояний awareness');
    const out = encoding.createEncoder();
    encoding.writeVarUint(out, count);
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const json = decoding.readVarString(decoder);
      if (clientId !== conn.yClientId) throw new GuardError('Чужой clientID в awareness');
      let state: unknown = null;
      if (json !== 'null') {
        if (json.length > LIMITS.maxAwarenessBytes) return; // слишком большое — молча пропускаем
        let raw: unknown;
        try {
          raw = JSON.parse(json);
        } catch {
          return;
        }
        const parsed = awarenessStateSchema.safeParse(raw);
        if (!parsed.success) return;
        state = {
          ...parsed.data,
          user: { id: conn.user.id, fullName: conn.user.fullName, role: conn.user.role, color: conn.user.color },
          laser: conn.caps.laser ? parsed.data.laser : null,
          drawing: conn.caps.write ? parsed.data.drawing : null,
        };
      }
      encoding.writeVarUint(out, clientId);
      encoding.writeVarUint(out, clock);
      encoding.writeVarString(out, JSON.stringify(state));
      if (state !== null) conn.awarenessClients.add(clientId);
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, encoding.toUint8Array(out), conn);
  }

  private sendAwarenessTo(conn: Connection): void {
    const clients = [...this.awareness.getStates().keys()];
    if (!clients.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.Awareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    conn.send(encoding.toUint8Array(encoder));
  }

  private handleControl(conn: Connection, msg: ClientControlMessage): void {
    if (msg.t === 'hello') {
      if (conn.ready) return;
      if (msg.protocol !== PROTOCOL_VERSION) {
        return conn.close(CloseCode.ProtocolMismatch, 'Обновите страницу: версия приложения устарела');
      }
      // Та же вкладка переподключилась — старое соединение вытесняется.
      for (const other of this.conns) {
        if (other !== conn && other.sessionId === msg.sessionId && other.user.id === conn.user.id) {
          other.close(CloseCode.Superseded, 'Доска открыта заново в этой вкладке');
        }
      }
      conn.sessionId = msg.sessionId;
      conn.yClientId = msg.yClientId;
      conn.ready = true;
      conn.sendControl({
        t: 'session.init',
        protocol: PROTOCOL_VERSION,
        serverTime: Date.now(),
        user: { id: conn.user.id, fullName: conn.user.fullName, role: conn.user.role, color: conn.user.color },
        board: {
          id: this.boardId,
          title: this.meta.title,
          kind: this.meta.kind,
          mode: this.meta.mode,
          ownerId: this.meta.ownerId,
          settings: this.meta.settings,
        },
        capabilities: conn.caps,
        // Мел, руки и «Следуйте за мной» обслуживаются модулем урока (этап 4.1).
        chalkHolders: [],
        hands: [],
        follow: null,
      });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.Sync);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      conn.send(encoding.toUint8Array(encoder));
      this.sendAwarenessTo(conn);
      return;
    }
    if (!conn.ready) return conn.close(CloseCode.ProtocolViolation, 'Ожидалось сообщение hello');
    if (msg.t === 'ping') {
      conn.sendControl({ t: 'pong', ts: msg.ts, serverTime: Date.now() });
      return;
    }
    // Команды управления уроком (режим, мел, «Следуйте за мной», руки,
    // очистка) реализуются на этапе 4.1.
    conn.sendControl({ t: 'error', code: 'NOT_AVAILABLE', message: 'Команда пока недоступна на сервере' });
  }

  // ------------------------------------------------------------------
  //  Изменения доступа
  // ------------------------------------------------------------------

  /**
   * Пересчёт прав всех подключённых (после смены доступа, режима, настроек,
   * роли пользователя). Потерявшие доступ отключаются.
   */
  async refreshAccess(): Promise<void> {
    const board = await this.app.prisma.board.findFirst({ where: { id: this.boardId, deletedAt: null } });
    if (!board) {
      for (const c of this.conns) c.close(CloseCode.NotFound, 'Доска удалена');
      return;
    }
    const settingsChanged = JSON.stringify(parseBoardSettings(board.settings)) !== JSON.stringify(this.meta.settings);
    this.meta = {
      title: board.title,
      kind: board.kind as (typeof BOARD_KINDS)[number],
      mode: board.mode,
      ownerId: board.ownerId,
      settings: parseBoardSettings(board.settings),
    };
    this.guard.moderatorIds = await loadModeratorIds(this.app.prisma, this.boardId);
    for (const conn of [...this.conns]) {
      const status = await this.app.userStatus.get(conn.user.id);
      if (!status || !status.active) {
        conn.close(CloseCode.AccountDisabled, 'Учётная запись заблокирована');
        continue;
      }
      conn.user = { id: status.id, login: status.login, fullName: status.fullName, role: status.role, color: status.color };
      const access = await loadBoardAccess(this.app.prisma, { id: status.id, role: status.role }, this.boardId);
      if (!access || !access.caps.view) {
        conn.close(CloseCode.Forbidden, 'Доступ к доске закрыт');
        continue;
      }
      const changed = JSON.stringify(access.caps) !== JSON.stringify(conn.caps);
      conn.caps = access.caps;
      conn.facts = access.facts;
      if (!conn.ready) continue;
      if (settingsChanged) conn.sendControl({ t: 'settings.changed', settings: this.meta.settings });
      if (changed) {
        conn.sendControl({ t: 'capabilities', capabilities: access.caps });
        conn.sendControl({ t: 'notice', level: 'info', code: 'RIGHTS_CHANGED', message: 'Ваши права на доске изменились' });
      }
    }
  }

  async destroy(): Promise<void> {
    await this.persistence.close();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

function syncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}
