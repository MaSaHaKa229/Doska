import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { BOARD_MODE_LABELS, parseBoardSettings, type BoardDetails, type ClientControlMessage, type Me, type RaisedHand } from '@doska/shared';
import { BoardModel, LOCAL_ORIGIN } from './model';
import { Presence } from './presence';
import { PeopleDirectory } from './people';
import { BoardProvider } from './provider';
import { LaserPointer } from './laser';
import { playChime } from '../lib/sound';
import { registry } from '../plugins/registry';
import { useBoard } from '../store/board';
import { toast } from '../store/toast';

export interface BoardSession {
  doc: Y.Doc;
  provider: BoardProvider;
  model: BoardModel;
  presence: Presence;
  people: PeopleDirectory;
  laser: LaserPointer;
  /** Команда урока серверу (режим, мел, руки, показ, очистка, настройки). */
  send(msg: ClientControlMessage): void;
  destroy(): void;
}

/**
 * Открытие доски: Y.Doc + WebSocket-провайдер + модель; связь с
 * состоянием интерфейса (useBoard): статус соединения, права, страница.
 */
export function openBoardSession(details: BoardDetails, user: Me): BoardSession {
  const store = useBoard.getState();
  store.reset();
  store.setUserId(user.id);
  store.setBoard(
    {
      id: details.id,
      title: details.title,
      kind: details.kind,
      mode: details.mode,
      ownerId: details.owner.id,
      settings: details.settings,
    },
    details.capabilities,
  );

  const doc = new Y.Doc();
  const model = new BoardModel(doc, {
    userId: user.id,
    registry,
    getCaps: () => useBoard.getState().caps ?? details.capabilities,
    ownerId: details.owner.id,
    defaultLayer: () => (details.kind === 'ASSIGNMENT_WORK' && useBoard.getState().caps?.moderate ? 'review' : 'content'),
  });
  // Работа по заданию: сведения о задании; учитель проверяет красным цветом
  // (только на этой доске, в настройки инструментов не сохраняется).
  store.setWork(details.work);
  if (details.kind === 'ASSIGNMENT_WORK' && details.capabilities.moderate) store.setToolOptions({ stroke: 'accent-1' }, false);
  // Документ хранится в браузере (IndexedDB): изменения, сделанные без
  // связи, переживают перезагрузку вкладки и уйдут на сервер при
  // подключении. База своя для каждой пары «доска + пользователь» и
  // удаляется при выходе из учётной записи.
  const local = typeof indexedDB !== 'undefined' ? new IndexeddbPersistence(localDbName(details.id, user.id), doc) : null;
  const provider = new BoardProvider(details.id, doc);
  const presence = new Presence(provider.awareness);
  const people = new PeopleDirectory(details.id);
  const laser = new LaserPointer((state) => presence.setLaser(state));
  people.remember([{ id: user.id, fullName: user.fullName, role: user.role }]);

  // Счётчик своих изменений, сделанных без связи.
  let pending = 0;
  const onLocalUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN && provider.status !== 'online') {
      pending++;
      useBoard.getState().setPendingChanges(pending);
    }
  };
  doc.on('update', onLocalUpdate);
  // Выделенные объекты могли удалить другие (очистка учителем, чужой ластик):
  // выделение не должно указывать на несуществующее.
  const pruneSelection = () => {
    const s = useBoard.getState();
    if (s.selection.length && s.selection.some((id) => !model.getObject(id))) {
      s.setSelection(s.selection.filter((id) => model.getObject(id)));
    }
  };
  doc.on('afterTransaction', pruneSelection);

  const unsubs: (() => void)[] = [];
  unsubs.push(
    provider.on('status', (status, reason) => useBoard.getState().setStatus(status, reason)),
    provider.on('flushed', () => {
      pending = 0;
      useBoard.getState().setPendingChanges(0);
    }),
    presence.subscribe(() => people.remember(presence.peers().map((p) => p.user))),
    provider.on('synced', () => {
      const s = useBoard.getState();
      s.setSynced(true);
      if (!s.pageId || !model.page(s.pageId)) {
        const first = model.pages()[0];
        if (first) s.setPage(first.id, 'system');
      }
    }),
    provider.on('control', (msg) => {
      const s = useBoard.getState();
      switch (msg.t) {
        case 'session.init':
          s.setBoard({ ...msg.board, settings: parseBoardSettings(msg.board.settings) }, msg.capabilities);
          s.setChalkHolders(msg.chalkHolders);
          s.setHands(msg.hands);
          s.setFollow(msg.follow);
          break;
        case 'chalk.changed': {
          const had = s.chalkHolders.includes(user.id);
          const has = msg.holders.includes(user.id);
          s.setChalkHolders(msg.holders);
          if (has && !had) toast.success('Учитель дал вам мел — можно писать на доске');
          else if (had && !has) toast.info('Учитель забрал мел');
          break;
        }
        case 'hands': {
          const before = new Set(s.hands.map((h) => h.userId));
          s.setHands(msg.hands);
          const raised = msg.hands.filter((h) => !before.has(h.userId) && h.userId !== user.id);
          if (raised.length && s.caps?.manageLesson) notifyHands(raised);
          break;
        }
        case 'follow.state': {
          const prev = s.follow;
          s.setFollow(msg.state);
          const follower = !s.caps?.leadFollow;
          if (follower && msg.state && !prev) toast.info(`${msg.state.leaderName} ведёт показ — ваш вид следует за учителем`);
          else if (follower && !msg.state && prev) toast.info('Показ окончен — можно свободно перемещаться по доске');
          break;
        }
        case 'capabilities':
          s.setCaps(msg.capabilities);
          break;
        case 'settings.changed':
          if (s.board) s.setBoard({ ...s.board, settings: msg.settings }, s.caps ?? details.capabilities);
          break;
        case 'work.changed': {
          const prev = s.work;
          if (!prev) break;
          s.setWork({ ...prev, status: msg.status, grade: msg.grade, closed: msg.closed, submittedAt: msg.submittedAt, reviewedAt: msg.reviewedAt });
          const mine = prev.student.id === user.id;
          if (mine && msg.status === 'REVIEWED' && prev.status !== 'REVIEWED') {
            toast.success(msg.grade ? `Учитель проверил работу: ${msg.grade}` : 'Учитель проверил работу');
          } else if (mine && msg.status === 'IN_PROGRESS' && (prev.status === 'REVIEWED' || prev.status === 'SUBMITTED')) {
            // Свою отмену сдачи панель работы отражает сразу, поэтому сюда попадает только возврат учителем.
            toast.info('Учитель вернул работу на доработку');
          } else if (!mine && msg.status === 'SUBMITTED' && prev.status !== 'SUBMITTED') {
            toast.info(`${prev.student.fullName} сдал(а) работу`);
          }
          if (msg.closed !== prev.closed && mine) toast.info(msg.closed ? 'Приём работ закрыт учителем' : 'Приём работ снова открыт');
          break;
        }
        case 'mode.changed':
          if (s.board) s.setBoard({ ...s.board, mode: msg.mode }, s.caps ?? details.capabilities);
          if (msg.by !== user.id) toast.info(`Режим доски: «${BOARD_MODE_LABELS[msg.mode]}»`);
          break;
        case 'notice':
          if (msg.level === 'info') toast.info(msg.message);
          else toast.error(msg.message);
          break;
        case 'error':
          toast.error(msg.message);
          break;
        default:
          break;
      }
    }),
    model.subscribeHistory(() => useBoard.getState().setHistory(model.undo.canUndo(), model.undo.canRedo())),
    model.subscribePages(() => {
      const s = useBoard.getState();
      if (s.synced && s.pageId && !model.page(s.pageId)) {
        const first = model.pages()[0];
        if (first) s.setPage(first.id, 'system');
      }
    }),
  );

  return {
    doc,
    provider,
    model,
    presence,
    people,
    laser,
    send: (msg) => provider.sendControl(msg),
    destroy() {
      unsubs.forEach((u) => u());
      laser.destroy();
      doc.off('update', onLocalUpdate);
      doc.off('afterTransaction', pruneSelection);
      presence.destroy();
      provider.destroy();
      void local?.destroy();
      model.destroy();
      doc.destroy();
      useBoard.getState().reset();
    },
  };
}

/** Учителю: звук и уведомление о поднятых руках. */
function notifyHands(raised: RaisedHand[]): void {
  playChime();
  const names = raised.map((h) => h.fullName).join(', ');
  toast.info(raised.length === 1 ? `${names} поднимает руку` : `Поднимают руку: ${names}`);
}

const LOCAL_DB_PREFIX = 'doska:';

export function localDbName(boardId: string, userId: string): string {
  return `${LOCAL_DB_PREFIX}${boardId}:${userId}`;
}

/**
 * Удаление локальных копий досок (при выходе): на общем компьютере
 * содержимое досок не должно оставаться в браузере.
 */
export async function clearLocalBoards(): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  try {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .filter((d) => d.name?.startsWith(LOCAL_DB_PREFIX))
        .map(
          (d) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(d.name!);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
    );
  } catch {
    /* браузер без поддержки — нечего чистить */
  }
}
