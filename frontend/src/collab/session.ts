import * as Y from 'yjs';
import { parseBoardSettings, type BoardDetails, type Me } from '@doska/shared';
import { BoardModel } from './model';
import { BoardProvider } from './provider';
import { registry } from '../plugins/registry';
import { useBoard } from '../store/board';
import { toast } from '../store/toast';

export interface BoardSession {
  doc: Y.Doc;
  provider: BoardProvider;
  model: BoardModel;
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
  const provider = new BoardProvider(details.id, doc);

  const unsubs: (() => void)[] = [];
  unsubs.push(
    provider.on('status', (status, reason) => useBoard.getState().setStatus(status, reason)),
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
    destroy() {
      unsubs.forEach((u) => u());
      provider.destroy();
      model.destroy();
      doc.destroy();
      useBoard.getState().reset();
    },
  };
}
