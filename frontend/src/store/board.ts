import { create } from 'zustand';
import type { BoardCapabilities, BoardKind, BoardMode, BoardSettings, Rect } from '@doska/shared';
import { DEFAULT_CAMERA, type Camera } from '../canvas/camera';
import type { ShapeKind } from '../objects/shape';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed';

export interface ToolOptions {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  shapeKind: ShapeKind;
}

export interface BoardInfo {
  id: string;
  title: string;
  kind: BoardKind;
  mode: BoardMode;
  ownerId: string;
  settings: BoardSettings;
}

interface BoardState {
  board: BoardInfo | null;
  caps: BoardCapabilities | null;
  status: ConnectionStatus;
  /** Причина закрытия без переподключения (нет доступа, доска удалена…). */
  closedReason: string | null;
  synced: boolean;

  pageId: string | null;
  cameras: Record<string, Camera>;
  toolId: string;
  /** Временное перемещение (пробел, средняя кнопка). */
  panning: boolean;
  /** Выделенные корни (объекты верхнего уровня или группы). */
  selection: string[];
  marquee: Rect | null;
  toolOptions: ToolOptions;
  preview: unknown;
  canUndo: boolean;
  canRedo: boolean;

  setBoard(board: BoardInfo, caps: BoardCapabilities): void;
  setCaps(caps: BoardCapabilities): void;
  setStatus(status: ConnectionStatus, closedReason?: string | null): void;
  setSynced(v: boolean): void;
  setPage(pageId: string): void;
  setCamera(cam: Camera): void;
  setTool(toolId: string): void;
  setPanning(v: boolean): void;
  setSelection(ids: string[]): void;
  setMarquee(r: Rect | null): void;
  setToolOptions(patch: Partial<ToolOptions>): void;
  setPreview(p: unknown): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  reset(): void;
}

const TOOL_OPTIONS_KEY = 'doska.toolOptions';

function loadToolOptions(): ToolOptions {
  const def: ToolOptions = { stroke: 'ink', fill: 'none', strokeWidth: 2, dash: 'solid', shapeKind: 'rect' };
  try {
    const raw = JSON.parse(localStorage.getItem(TOOL_OPTIONS_KEY) ?? '{}') as Partial<ToolOptions>;
    return { ...def, ...raw };
  } catch {
    return def;
  }
}

const initial = () => ({
  board: null,
  caps: null,
  status: 'connecting' as ConnectionStatus,
  closedReason: null,
  synced: false,
  pageId: null,
  cameras: {},
  toolId: 'core.select',
  panning: false,
  selection: [],
  marquee: null,
  toolOptions: loadToolOptions(),
  preview: null,
  canUndo: false,
  canRedo: false,
});

/** Состояние открытой доски (интерфейс; данные доски — в Y.Doc/BoardModel). */
export const useBoard = create<BoardState>((set, get) => ({
  ...initial(),
  setBoard: (board, caps) => set({ board, caps }),
  setCaps: (caps) => set({ caps }),
  setStatus: (status, closedReason = null) => set({ status, closedReason }),
  setSynced: (synced) => set({ synced }),
  setPage: (pageId) => set({ pageId, selection: [], marquee: null }),
  setCamera: (cam) => {
    const pageId = get().pageId;
    if (pageId) set({ cameras: { ...get().cameras, [pageId]: cam } });
  },
  setTool: (toolId) => set({ toolId, preview: null }),
  setPanning: (panning) => set({ panning }),
  setSelection: (selection) => set({ selection }),
  setMarquee: (marquee) => set({ marquee }),
  setToolOptions: (patch) => {
    const toolOptions = { ...get().toolOptions, ...patch };
    try {
      localStorage.setItem(TOOL_OPTIONS_KEY, JSON.stringify(toolOptions));
    } catch {
      /* приватный режим */
    }
    set({ toolOptions });
  },
  setPreview: (preview) => set({ preview }),
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  reset: () => set(initial()),
}));

export function currentCamera(): Camera {
  const s = useBoard.getState();
  return (s.pageId && s.cameras[s.pageId]) || DEFAULT_CAMERA;
}
