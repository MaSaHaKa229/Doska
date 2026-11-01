import { create } from 'zustand';
import type { BoardCapabilities, BoardKind, BoardMode, BoardSettings, BoardWorkInfo, FollowState, RaisedHand, Rect } from '@doska/shared';
import { DEFAULT_CAMERA, type Camera } from '../canvas/camera';
import type { ShapeKind } from '../objects/shape';
import type { SnapResult } from '../canvas/snapping';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed';

export interface ToolOptions {
  /** Цвет линии фигур и пера. */
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  shapeKind: ShapeKind;
  /** Толщина пера на экране (пт); в документ пишется в мировых единицах. */
  penWidth: number;
  /** Распознавать фигуры: задержать перо в конце штриха. */
  recognizeShapes: boolean;
  markerColor: string;
  markerWidth: number;
  /** Ластик: целые объекты или части штрихов. */
  eraserMode: 'stroke' | 'pixel';
  /** Диаметр ластика на экране (пт). */
  eraserSize: number;
}

export interface BoardInfo {
  id: string;
  title: string;
  kind: BoardKind;
  mode: BoardMode;
  ownerId: string;
  settings: BoardSettings;
}

/** Кто меняет вид: пользователь или приложение (показ учителя, первое открытие). */
export type ViewSource = 'user' | 'system';

interface BoardState {
  /** Текущий пользователь (для «я ли веду показ», «у меня ли мел»). */
  userId: string | null;
  board: BoardInfo | null;
  caps: BoardCapabilities | null;
  status: ConnectionStatus;
  /** Причина закрытия без переподключения (нет доступа, доска удалена…). */
  closedReason: string | null;
  synced: boolean;
  /** Свои изменения, сделанные без связи и ещё не отправленные серверу. */
  pendingChanges: number;

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
  /** Текущая привязка (маркер с подписью у курсора). */
  snapHint: SnapResult | null;
  canUndo: boolean;
  canRedo: boolean;

  /** Работа по заданию (доска kind = ASSIGNMENT_WORK) или null. */
  work: BoardWorkInfo | null;
  setWork(work: BoardWorkInfo | null): void;

  // ----- Урок -----
  chalkHolders: string[];
  hands: RaisedHand[];
  /** «Следуйте за мной»: текущий показ или null. */
  follow: FollowState | null;
  /** Ученик временно отошёл от вида учителя (показ не строгий). */
  followDetached: boolean;

  setUserId(id: string): void;
  setChalkHolders(ids: string[]): void;
  setHands(hands: RaisedHand[]): void;
  setFollow(state: FollowState | null): void;
  setFollowDetached(v: boolean): void;
  setBoard(board: BoardInfo, caps: BoardCapabilities): void;
  setCaps(caps: BoardCapabilities): void;
  setStatus(status: ConnectionStatus, closedReason?: string | null): void;
  setSynced(v: boolean): void;
  setPendingChanges(n: number): void;
  /** source = 'user': во время строгого показа учителя игнорируется. */
  setPage(pageId: string, source?: ViewSource): void;
  setCamera(cam: Camera, source?: ViewSource): void;
  setTool(toolId: string): void;
  setPanning(v: boolean): void;
  setSelection(ids: string[]): void;
  setMarquee(r: Rect | null): void;
  /** persist = false — только на этой доске (например, красный цвет пометок проверки). */
  setToolOptions(patch: Partial<ToolOptions>, persist?: boolean): void;
  setPreview(p: unknown): void;
  setSnapHint(s: SnapResult | null): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  reset(): void;
}

const TOOL_OPTIONS_KEY = 'doska.toolOptions';

function loadToolOptions(): ToolOptions {
  const def: ToolOptions = {
    stroke: 'ink',
    fill: 'none',
    strokeWidth: 2,
    dash: 'solid',
    shapeKind: 'rect',
    penWidth: 3,
    recognizeShapes: true,
    markerColor: 'accent-7',
    markerWidth: 16,
    eraserMode: 'stroke',
    eraserSize: 20,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(TOOL_OPTIONS_KEY) ?? '{}') as Partial<ToolOptions>;
    return { ...def, ...raw };
  } catch {
    return def;
  }
}

const initial = () => ({
  userId: null,
  board: null,
  caps: null,
  status: 'connecting' as ConnectionStatus,
  closedReason: null,
  synced: false,
  pendingChanges: 0,
  pageId: null,
  cameras: {},
  toolId: 'core.select',
  panning: false,
  selection: [],
  marquee: null,
  toolOptions: loadToolOptions(),
  preview: null,
  snapHint: null,
  canUndo: false,
  canRedo: false,
  work: null,
  chalkHolders: [],
  hands: [],
  follow: null,
  followDetached: false,
});

/**
 * Следует ли пользователь за показом: показ идёт, ведёт его не он, и сам он
 * показ вести не может (ученик, наблюдатель). Учителя-соведущие не
 * перемещаются принудительно.
 */
export function isFollowing(s: Pick<BoardState, 'follow' | 'userId' | 'caps'>): boolean {
  return !!s.follow && s.follow.leaderId !== s.userId && !s.caps?.leadFollow;
}

/**
 * Можно ли пользователю сейчас самому менять вид. Во время строгого показа —
 * нет; в нестрогом смена вида означает «временно отойти от учителя».
 */
function viewChange(get: () => BoardState, set: (p: Partial<BoardState>) => void, source: ViewSource): boolean {
  const s = get();
  if (source === 'system' || !isFollowing(s)) return true;
  if (s.follow!.strict) return false;
  if (!s.followDetached) set({ followDetached: true });
  return true;
}

/** Состояние открытой доски (интерфейс; данные доски — в Y.Doc/BoardModel). */
export const useBoard = create<BoardState>((set, get) => ({
  ...initial(),
  setBoard: (board, caps) => set({ board, caps }),
  setCaps: (caps) => set({ caps }),
  setStatus: (status, closedReason = null) => set({ status, closedReason }),
  setSynced: (synced) => set({ synced }),
  setPendingChanges: (pendingChanges) => set({ pendingChanges }),
  setPage: (pageId, source = 'user') => {
    if (!viewChange(get, set, source)) return;
    set({ pageId, selection: [], marquee: null });
  },
  setCamera: (cam, source = 'user') => {
    const pageId = get().pageId;
    if (!pageId || !viewChange(get, set, source)) return;
    set({ cameras: { ...get().cameras, [pageId]: cam } });
  },
  setUserId: (userId) => set({ userId }),
  setChalkHolders: (chalkHolders) => set({ chalkHolders }),
  setHands: (hands) => set({ hands }),
  setFollow: (follow) => {
    const prev = get().follow;
    // Новый показ (или другой ведущий) — снова следовать за учителем.
    const restarted = !prev || !follow || prev.leaderId !== follow.leaderId;
    set({ follow, ...(restarted ? { followDetached: false } : {}) });
  },
  setFollowDetached: (followDetached) => set({ followDetached }),
  setTool: (toolId) => set({ toolId, preview: null }),
  setPanning: (panning) => set({ panning }),
  setSelection: (selection) => set({ selection }),
  setMarquee: (marquee) => set({ marquee }),
  setWork: (work) => set({ work }),
  setToolOptions: (patch, persist = true) => {
    const toolOptions = { ...get().toolOptions, ...patch };
    if (!persist) return set({ toolOptions });
    try {
      localStorage.setItem(TOOL_OPTIONS_KEY, JSON.stringify(toolOptions));
    } catch {
      /* приватный режим */
    }
    set({ toolOptions });
  },
  setPreview: (preview) => set({ preview }),
  setSnapHint: (snapHint) => {
    const cur = get().snapHint;
    if (cur === snapHint || (cur && snapHint && cur.kind === snapHint.kind && cur.point.x === snapHint.point.x && cur.point.y === snapHint.point.y)) return;
    set({ snapHint });
  },
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  reset: () => set(initial()),
}));

export function currentCamera(): Camera {
  const s = useBoard.getState();
  return (s.pageId && s.cameras[s.pageId]) || DEFAULT_CAMERA;
}
