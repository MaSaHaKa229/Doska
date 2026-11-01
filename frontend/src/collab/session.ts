import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { parseBoardSettings, type BoardDetails, type Me } from '@doska/shared';
import { BoardModel, LOCAL_ORIGIN } from './model';
import { Presence } from './presence';
import { PeopleDirectory } from './people';
import { BoardProvider } from './provider';
import { registry } from '../plugins/registry';
import { useBoard } from '../store/board';
import { toast } from '../store/toast';

export interface BoardSession {
  doc: Y.Doc;
  provider: BoardProvider;
  model: BoardModel;
  presence: Presence;
  people: PeopleDirectory;
  destroy(): void;
}

/**
 * Открытие доски: Y.Doc + WebSocket-провайдер + модель; связь с
 * состоянием интерфейса (useBoard): статус соединения, права, страница.
 */
export function openBoardSession(details: BoardDetails, user: Me): BoardSession {
  const store = useBoard.getState();
  store.reset();
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
  });
  // Документ хранится в браузере (IndexedDB): изменения, сделанные без
  // связи, переживают перезагрузку вкладки и уйдут на сервер при
  // подключении. База своя для каждой пары «доска + пользователь» и
  // удаляется при выходе из учётной записи.
  const local = typeof indexedDB !== 'undefined' ? new IndexeddbPersistence(localDbName(details.id, user.id), doc) : null;
  const provider = new BoardProvider(details.id, doc);
  const presence = new Presence(provider.awareness);
  const people = new PeopleDirectory(details.id);
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
        if (first) s.setPage(first.id);
      }
    }),
    provider.on('control', (msg) => {
      const s = useBoard.getState();
      switch (msg.t) {
        case 'session.init':
          s.setBoard({ ...msg.board, settings: parseBoardSettings(msg.board.settings) }, msg.capabilities);
          break;
        case 'capabilities':
          s.setCaps(msg.capabilities);
          break;
        case 'settings.changed':
          if (s.board) s.setBoard({ ...s.board, settings: msg.settings }, s.caps ?? details.capabilities);
          break;
        case 'mode.changed':
          if (s.board) s.setBoard({ ...s.board, mode: msg.mode }, s.caps ?? details.capabilities);
          break;
        case 'notice':
          if (msg.level === 'info') toast.info(msg.message);
          else toast.error(msg.message);
          break;
        case 'error':
          // Неподдерживаемые пока команды урока (этап 4.1) не показываем пользователю.
          if (msg.code !== 'NOT_AVAILABLE') toast.error(msg.message);
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
        if (first) s.setPage(first.id);
      }
    }),
  );

  return {
    doc,
    provider,
    model,
    presence,
    people,
    destroy() {
      unsubs.forEach((u) => u());
      doc.off('update', onLocalUpdate);
      presence.destroy();
      provider.destroy();
      void local?.destroy();
      model.destroy();
      doc.destroy();
      useBoard.getState().reset();
    },
  };
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
