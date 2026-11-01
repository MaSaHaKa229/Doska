import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Layer, Stage } from 'react-konva';
import * as Y from 'yjs';
import type { BoardCapabilities } from '@doska/shared';
import { BoardModel } from '../collab/model';
import { BoardProvider, boardSocketUrl } from '../collab/provider';
import { registry } from '../plugins/registry';
import { SURFACE_COLORS, type CanvasTheme } from '../objects/colors';
import { fetchBoardSnapshot } from '../api/assignments';
import { ObjectView } from './BoardStage';
import { fitRect } from './camera';

/** Миниатюра рисует не больше стольких объектов (первые по порядку отрисовки). */
const MAX_THUMB_OBJECTS = 3000;

/** Права для модели миниатюры: только просмотр, правок не бывает. */
const VIEW_ONLY: BoardCapabilities = {
  role: 'viewer',
  view: true,
  write: false,
  noWriteReason: 'read-only',
  moderate: false,
  manageLesson: false,
  managePages: false,
  editOthers: false,
  editTeacherObjects: false,
  laser: false,
  leadFollow: false,
  clearStudentObjects: false,
  restoreVersions: false,
  raiseHand: false,
};

const noop = () => undefined;

function newViewModel(doc: Y.Doc): BoardModel {
  return new BoardModel(doc, { userId: '', registry, getCaps: () => VIEW_ONLY, ownerId: '' });
}

/**
 * Упрощённая отрисовка первой страницы доски: те же модули объектов, что и
 * на холсте, без сетки, выделения и взаимодействия. Вид подгоняется под
 * содержимое страницы.
 */
export function BoardThumbnail({ model, width, height }: { model: BoardModel; width: number; height: number }) {
  useSyncExternalStore(useCallback((cb) => model.subscribePages(cb), [model]), () => model.pagesStamp);
  const page = model.pages()[0];
  const pageId = page?.id ?? '';
  useSyncExternalStore(
    useCallback((cb) => (pageId ? model.subscribePage(pageId, cb) : noop), [model, pageId]),
    () => (pageId ? model.pageVersion(pageId) : 0),
  );
  const theme: CanvasTheme = page?.background.surface === 'chalk' ? 'chalk' : 'light';
  const ids = pageId ? model.pageObjects(pageId).slice(0, MAX_THUMB_OBJECTS) : [];
  const bounds = pageId ? model.pageBounds(pageId) : null;
  const cam = bounds ? fitRect(bounds, { width, height }, 8, 1) : { cx: 0, cy: 0, zoom: 1 };
  model.resolve.zoom = cam.zoom;
  model.resolve.theme = theme;
  return (
    <div className="thumb" style={{ width, height, background: SURFACE_COLORS[theme].paper }} aria-hidden>
      {ids.length > 0 && (
        <Stage width={width} height={height} listening={false} x={width / 2 - cam.cx * cam.zoom} y={height / 2 - cam.cy * cam.zoom} scaleX={cam.zoom} scaleY={cam.zoom}>
          <Layer listening={false}>
            {ids.map((id) => (
              <ObjectView key={id} model={model} id={id} theme={theme} register={noop} />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}

/**
 * Документ доски по облегчённой подписке (?lite=1): миниатюра обновляется
 * в реальном времени. Подписка открыта, только пока enabled (карточка на
 * экране).
 */
export function useLiveBoardModel(boardId: string, enabled: boolean): BoardModel | null {
  const [model, setModel] = useState<BoardModel | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const doc = new Y.Doc();
    const provider = new BoardProvider(boardId, doc, boardSocketUrl(boardId, true));
    const m = newViewModel(doc);
    setModel(m);
    return () => {
      setModel(null);
      provider.destroy();
      m.destroy();
      doc.destroy();
    };
  }, [boardId, enabled]);
  return model;
}

// Снимки уже загруженных досок: ключ — id и время последнего изменения.
const snapshotCache = new Map<string, Uint8Array>();
const SNAPSHOT_CACHE_LIMIT = 120;
// Не больше четырёх загрузок одновременно — список досок не забивает сеть.
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Документ доски по однократному снимку (GET /api/boards/:id/snapshot) —
 * для миниатюр в списке досок. Перезагружается, когда меняется version
 * (время последнего изменения доски).
 */
export function useSnapshotModel(boardId: string, version: string, enabled: boolean): { model: BoardModel | null; failed: boolean } {
  const [state, setState] = useState<{ model: BoardModel | null; failed: boolean }>({ model: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    const key = `${boardId}:${version}`;
    const ctrl = new AbortController();
    let doc: Y.Doc | null = null;
    let model: BoardModel | null = null;
    const show = (bytes: Uint8Array) => {
      doc = new Y.Doc();
      // Модель строит индексы по событиям документа — создаётся до применения снимка.
      model = newViewModel(doc);
      Y.applyUpdate(doc, bytes);
      setState({ model, failed: false });
    };
    const cached = snapshotCache.get(key);
    if (cached) show(cached);
    else {
      limited(() => fetchBoardSnapshot(boardId, ctrl.signal))
        .then((bytes) => {
          if (ctrl.signal.aborted) return;
          if (snapshotCache.size >= SNAPSHOT_CACHE_LIMIT) snapshotCache.delete(snapshotCache.keys().next().value!);
          snapshotCache.set(key, bytes);
          show(bytes);
        })
        .catch(() => !ctrl.signal.aborted && setState({ model: null, failed: true }));
    }
    return () => {
      ctrl.abort();
      model?.destroy();
      doc?.destroy();
      setState({ model: null, failed: false });
    };
  }, [boardId, version, enabled]);
  return state;
}

/** Миниатюра по снимку (список досок). */
export function SnapshotThumb({ boardId, version, width, height }: { boardId: string; version: string; width: number; height: number }) {
  const { model } = useSnapshotModel(boardId, version, true);
  return model ? <BoardThumbnail model={model} width={width} height={height} /> : <div className="thumb" style={{ width, height }} />;
}

/** Живая миниатюра по облегчённой подписке (сетка работ). */
export function LiveThumb({ boardId, width, height }: { boardId: string; width: number; height: number }) {
  const model = useLiveBoardModel(boardId, true);
  return model ? <BoardThumbnail model={model} width={width} height={height} /> : <div className="thumb" style={{ width, height }} />;
}
