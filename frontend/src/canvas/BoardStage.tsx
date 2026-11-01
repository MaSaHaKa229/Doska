import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Rect as KRect, Shape, Stage, Text, Transformer } from 'react-konva';
import type { BoardObject, Point, Rect, RenderContext, ToolContext, ToolPointerEvent } from '@doska/shared';
import type { BoardModel } from '../collab/model';
import { cursorVisible, type Presence } from '../collab/presence';
import type { PeopleDirectory } from '../collab/people';
import { useBoard, currentCamera, type ToolOptions } from '../store/board';
import { useAuth } from '../store/auth';
import { registry } from '../plugins/registry';
import { DEFAULT_CAMERA, panBy, screenToWorld, viewportRect, wheelIntent, wheelZoomFactor, zoomAt, type Camera, type Size } from './camera';
import { drawBackground, type Ctx2D } from './background';
import { findSnap, gridSnap, SNAP_LABELS, type SnapResult } from './snapping';
import { resolveColor, SURFACE_COLORS, type CanvasTheme } from '../objects/colors';
import { HAND_TOOL_ID, LASER_TOOL_ID, SELECT_TOOL_ID } from '../tools/shape-tools';
import { toolUnavailable } from '../tools/availability';
import { PdfBackground } from './PdfBackground';
import { requestEditText } from '../tools/text-tool';
import { requestObjectEditor } from '../tools/formula-tools';
import { StrokeShape } from '../objects/stroke/stroke';
import { compactForPresence } from '../objects/stroke/geometry';
import { PEN_TOOL_ID } from '../tools/draw-tools';
import type { LaserPointer } from '../collab/laser';
import { toast } from '../store/toast';

/** Допуск попадания курсора, экранные пиксели. */
const HIT_TOLERANCE_PX = 6;
/** Порог, после которого нажатие считается перетаскиванием, экранные пиксели. */
const DRAG_THRESHOLD_PX = 3;
/** Радиус привязки, экранные пиксели. */
const SNAP_TOLERANCE_PX = 10;
/** Запас видимой области для виртуализации (доля размера экрана). */
const VIEWPORT_MARGIN = 0.2;

function useCanvasTheme(surface: 'auto' | 'chalk' | undefined): CanvasTheme {
  // Подписка на тему пользователя: при её смене меняется data-theme у <html>.
  useAuth((s) => s.user?.preferences.theme);
  if (surface === 'chalk') return 'chalk';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function expand(r: Rect, k: number): Rect {
  return { x: r.x - r.width * k, y: r.y - r.height * k, width: r.width * (1 + 2 * k), height: r.height * (1 + 2 * k) };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Нормализованный прямоугольник по двум углам. */
function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

// ---------------------------------------------------------------------
//  Объект
// ---------------------------------------------------------------------

interface ObjectViewProps {
  model: BoardModel;
  id: string;
  theme: CanvasTheme;
  register: (id: string, node: Konva.Group | null) => void;
}

/**
 * Один объект. Подписан только на свой объект в модели: изменения других
 * объектов его не перерисовывают. Попадания считает ядро (module.hitTest),
 * поэтому узлы Konva не слушают события (listening = false) — это заметно
 * ускоряет отрисовку при тысячах объектов.
 */
export const ObjectView = memo(function ObjectView({ model, id, theme, register }: ObjectViewProps) {
  const entry = useSyncExternalStore(
    useCallback((cb) => model.subscribeObject(id, cb), [model, id]),
    () => model.get(id),
  );
  const ref = useCallback((node: Konva.Group | null) => register(id, node), [id, register]);
  if (!entry) return null;
  const { obj, module, broken } = entry;
  const ctx: RenderContext = {
    ...model.resolve,
    theme,
    selected: false,
    hovered: false,
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    resolveColor: (c) => resolveColor(c, theme),
  };
  let content: ReactNode;
  if (!module || broken) {
    const b = (obj.props as { __bounds?: Rect }).__bounds ?? { x: 0, y: 0, width: 80, height: 40 };
    content = (
      <>
        <KRect {...b} stroke={resolveColor('muted', theme)} dash={[6, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        <Text
          x={b.x + 4}
          y={b.y + 4}
          width={Math.max(40, b.width - 8)}
          text={module ? `Повреждённый объект (${obj.type})` : `Неизвестный объект (${obj.type})`}
          fontSize={12}
          fill={resolveColor('muted', theme)}
          listening={false}
        />
      </>
    );
  } else {
    content = module.render(obj, ctx) as ReactNode;
  }
  return (
    <Group
      ref={ref}
      id={obj.id}
      x={obj.x}
      y={obj.y}
      rotation={(obj.rotation * 180) / Math.PI}
      scaleX={obj.scaleX}
      scaleY={obj.scaleY}
      visible={!obj.hidden}
      listening={false}
    >
      {content}
    </Group>
  );
});

// ---------------------------------------------------------------------
//  Взаимодействие
// ---------------------------------------------------------------------

type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; last: Point; pointerId: number }
  | { kind: 'pinch' }
  | { kind: 'laser'; pointerId: number }
  | { kind: 'marquee'; start: Point; additive: boolean; base: string[]; pointerId: number }
  | {
      kind: 'move';
      startScreen: Point;
      startWorld: Point;
      leaves: string[];
      origin: Map<string, Point>;
      moved: boolean;
      pointerId: number;
      clickRoot: string;
      wasSelected: boolean;
      /** Характерные точки перемещаемых объектов (для привязки при перемещении). */
      snapPoints: Point[];
    }
  | { kind: 'handle'; objectId: string; handleId: string; pointerId: number }
  | { kind: 'tool'; pointerId: number };

export interface BoardStageProps {
  model: BoardModel;
  /** Вызывается при каждом изменении камеры (для мини-панели масштаба). */
  onCamera?: (cam: Camera, size: Size) => void;
  /** Ссылка на Stage (экспорт, «показать всё»). */
  stageRef?: React.MutableRefObject<Konva.Stage | null>;
  sizeRef?: React.MutableRefObject<Size>;
  /** Присутствие (курсоры, выделения других) — нет в автономных тестах холста. */
  presence?: Presence;
  people?: PeopleDirectory;
  /** Лазерная указка текущего пользователя. */
  laser?: LaserPointer;
}

const NO_PEERS: never[] = [];
const HOVER_DELAY_MS = 600;

function formatTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString('ru-RU', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function BoardStage({ model, stageRef: externalStageRef, sizeRef: externalSizeRef, presence, people, laser }: BoardStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [size, setSize] = useState<Size>({ width: 800, height: 600 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  if (externalSizeRef) externalSizeRef.current = size;

  const pageId = useBoard((s) => s.pageId);
  const camera = useBoard((s) => (s.pageId && s.cameras[s.pageId]) || DEFAULT_CAMERA);
  const toolId = useBoard((s) => s.toolId);
  const panning = useBoard((s) => s.panning);
  const selection = useBoard((s) => s.selection);
  const marquee = useBoard((s) => s.marquee);
  const preview = useBoard((s) => s.preview);
  const snapHint = useBoard((s) => s.snapHint);
  const caps = useBoard((s) => s.caps);
  const penOnly = useAuth((s) => s.user?.preferences.penOnly ?? false);
  const settings = useBoard((s) => s.board?.settings);
  const peers = useSyncExternalStore(
    useCallback((cb) => (presence ? presence.subscribe(cb) : () => undefined), [presence]),
    () => (presence ? presence.peers() : NO_PEERS),
  );
  useSyncExternalStore(
    useCallback((cb) => (people ? people.subscribe(cb) : () => undefined), [people]),
    () => people,
  );

  useSyncExternalStore(useCallback((cb) => model.subscribePages(cb), [model]), () => model.pagesStamp);
  const page = pageId ? model.page(pageId) : undefined;
  const theme = useCanvasTheme(page?.background.surface);
  model.resolve.zoom = camera.zoom;
  model.resolve.theme = theme;

  const pageVersion = useSyncExternalStore(
    useCallback((cb) => (pageId ? model.subscribePage(pageId, cb) : () => undefined), [model, pageId]),
    () => (pageId ? model.pageVersion(pageId) : 0),
  );

  // Размер контейнера.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Своё присутствие: вид, выделение, инструмент.
  useEffect(() => {
    if (presence && pageId) presence.setViewport({ pageId, centerX: camera.cx, centerY: camera.cy, zoom: camera.zoom });
  }, [presence, pageId, camera.cx, camera.cy, camera.zoom]);
  useEffect(() => presence?.setSelection(selection), [presence, selection]);
  useEffect(() => presence?.setTool(toolId), [presence, toolId]);

  // Виртуализация: только объекты, пересекающие видимую область с запасом.
  const view = viewportRect(camera, size);
  const visibleIds = useMemo(
    () => (pageId ? model.queryRect(pageId, expand(view, VIEWPORT_MARGIN)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, pageId, pageVersion, view.x, view.y, view.width, view.height],
  );

  const register = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  // ----- Выделение и Transformer -----
  const leaves = useMemo(() => model.leaves(selection), [model, selection, pageVersion]);
  const transformable = useMemo(() => {
    if (!leaves.length || !caps?.write) return false;
    // Объект с собственными ручками (концы отрезка) правится ручками, без рамки.
    if (leaves.length === 1) {
      const e = model.get(leaves[0]!);
      if (e?.module && !e.broken && e.module.dragHandle && e.module.getHandles(e.obj, model.resolve).length) return false;
    }
    return leaves.every((id) => {
      const e = model.get(id);
      return e && e.module && !e.broken && e.module.transform?.resize !== 'none' && model.canModify(id, 'x');
    });
  }, [model, leaves, caps]);
  const rotatable = leaves.every((id) => model.get(id)?.module?.transform?.rotatable !== false);
  const proportional = leaves.some((id) => model.get(id)?.module?.transform?.resize === 'proportional');

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const list = transformable ? leaves.map((id) => nodes.current.get(id)).filter((n): n is Konva.Group => !!n) : [];
    tr.nodes(list);
    tr.getLayer()?.batchDraw();
  });

  const onTransformEnd = () => {
    const tr = transformerRef.current;
    if (!tr) return;
    const patches = tr.nodes().map((node) => {
      const base = { x: node.x(), y: node.y(), rotation: (node.rotation() * Math.PI) / 180 };
      const entry = model.get(node.id());
      // Объект сам решает, как растягиваться (текст — меняет ширину, а не масштаб).
      if (entry?.module?.applyResize && !entry.broken) {
        const extra = entry.module.applyResize(entry.obj, node.scaleX(), node.scaleY());
        node.scaleX(typeof extra.scaleX === 'number' ? extra.scaleX : entry.obj.scaleX);
        node.scaleY(typeof extra.scaleY === 'number' ? extra.scaleY : entry.obj.scaleY);
        return { id: node.id(), patch: { ...base, ...extra } };
      }
      return { id: node.id(), patch: { ...base, scaleX: node.scaleX(), scaleY: node.scaleY() } };
    });
    model.updateObjects(patches);
  };

  // Присутствие для контекста инструментов (контекст создаётся один раз).
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  // ----- Контекст инструментов -----
  const toolCtx = useMemo<ToolContext>(() => {
    const s = () => useBoard.getState();
    return {
      get userId() {
        return model.userId;
      },
      get pageId() {
        return s().pageId ?? '';
      },
      get canWrite() {
        return !!s().caps?.write;
      },
      resolve: model.resolve,
      createObject: (type, init) => model.createObject(type, { ...init, pageId: s().pageId ?? '' }) ?? '',
      updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
      deleteObjects: (ids) => void model.deleteObjects(ids),
      transact: (fn, opts) => model.transact(fn, opts),
      canModify: (id) => model.canModify(id, 'props'),
      canDelete: (id) => model.canDelete(id),
      publishDrawing: (d) => {
        const pageId = s().pageId;
        presenceRef.current?.setDrawing(d && pageId ? { ...d, pageId, points: compactForPresence(d.points) } : null);
      },
      hitTest: (pt, tol) =>
        model
          .hitTest(s().pageId ?? '', pt, tol)
          .map((id) => model.getObject(id))
          .filter((o): o is BoardObject => !!o),
      setSelection: (ids) => s().setSelection(ids),
      setPreview: (p) => s().setPreview(p),
      getPreview: <T,>() => s().preview as T | null,
      activateTool: (id) => s().setTool(id),
      getToolOptions: <T,>() => s().toolOptions as T,
      screenToWorld: (px) => px / currentCamera().zoom,
    };
  }, [model]);

  const tool = registry.getTool(toolId);

  // ----- Указатель -----
  const interaction = useRef<Interaction>({ kind: 'idle' });
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point; cam: Camera } | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Point) => screenToWorld(currentCamera(), sizeRef.current, p);
  const setCamera = (cam: Camera) => useBoard.getState().setCamera(cam);

  /** Привязка точки к объектам и сетке (Alt — без привязки). */
  const snapPoint = (world: Point, alt: boolean, exclude: ReadonlySet<string> = new Set()): SnapResult | null => {
    const prefs = useAuth.getState().user?.preferences;
    if (alt || !pageId || !prefs) return null;
    const zoom = currentCamera().zoom;
    const tol = SNAP_TOLERANCE_PX / zoom;
    const sources = prefs.snapToObjects ? model.snapSources(pageId, world, tol * 3, exclude) : [];
    const pg = model.page(pageId);
    const grid = prefs.snapToGrid && pg ? gridSnap(world, pg.background, zoom) : null;
    return findSnap(world, tol, sources, grid);
  };

  const toolEvent = (e: React.PointerEvent, world: Point): ToolPointerEvent => {
    const snap = tool?.snapping ? snapPoint(world, e.altKey) : null;
    useBoard.getState().setSnapHint(snap && snap.kind !== 'grid' ? snap : null);
    return toolEventWith(e, world, snap);
  };

  const toolEventWith = (e: React.PointerEvent, world: Point, snap: SnapResult | null): ToolPointerEvent => ({
    world,
    snapped: snap?.point ?? world,
    snap: snap && snap.kind !== 'grid' ? { kind: snap.kind, point: snap.point, refId: snap.refId } : null,
    pressure: e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5,
    pointerType: e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse',
    modifiers: { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
    timeStamp: e.timeStamp,
  });

  /** Ручка (конец отрезка и т. п.) под курсором у единственного выделенного объекта. */
  const handleAt = (world: Point): { objectId: string; handleId: string } | null => {
    if (selection.length !== 1 || !caps?.write) return null;
    const e = model.get(selection[0]!);
    if (!e?.module || e.broken || !e.module.dragHandle || !model.canModify(e.obj.id, 'props')) return null;
    const tol = 8 / currentCamera().zoom;
    for (const h of e.module.getHandles(e.obj, model.resolve)) {
      if (Math.hypot(h.position.x - world.x, h.position.y - world.y) <= tol) return { objectId: e.obj.id, handleId: h.id };
    }
    return null;
  };

  // ----- Подпись автора при наведении -----
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverId = useRef<string | null>(null);
  const showAuthors = caps?.moderate || settings?.showAuthorsToStudents !== false;
  const scheduleHover = (id: string | null, at: Point) => {
    if (id === hoverId.current) return;
    hoverId.current = id;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
    if (!id || !showAuthors) return;
    hoverTimer.current = setTimeout(() => setHover({ id, x: at.x, y: at.y }), HOVER_DELAY_MS);
  };
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    scheduleHover(null, { x: 0, y: 0 });
    if (!pageId) return;
    const sp = screenPoint(e);
    pointers.current.set(e.pointerId, sp);

    // Два касания — щипок (масштаб + перемещение), отменяет текущее действие.
    if (pointers.current.size === 2 && e.pointerType === 'touch') {
      cancelInteraction();
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: currentCamera() };
      interaction.current = { kind: 'pinch' };
      return;
    }
    if (interaction.current.kind !== 'idle') return;

    // Ручки Transformer обрабатывает сам Konva.
    const hit = stageRef.current?.getIntersection(sp);
    if (hit && hit.getParent() instanceof Konva.Transformer) return;

    containerRef.current?.setPointerCapture(e.pointerId);
    const world = toWorld(sp);
    const isTouchPan = penOnly && e.pointerType === 'touch';
    if (e.button === 1 || panning || toolId === HAND_TOOL_ID || isTouchPan) {
      interaction.current = { kind: 'pan', last: sp, pointerId: e.pointerId };
      return;
    }
    if (e.button !== 0) return;

    // Лазерная указка: след в присутствии, документ не меняется.
    if (toolId === LASER_TOOL_ID && tool) {
      const unavailable = toolUnavailable(tool, caps);
      if (unavailable) toast.info(unavailable);
      else if (laser) {
        interaction.current = { kind: 'laser', pointerId: e.pointerId };
        laser.down(pageId, world);
      }
      return;
    }

    if (toolId === SELECT_TOOL_ID || !tool?.onPointerDown) {
      const handle = handleAt(world);
      if (handle) {
        model.undo.stopCapturing(); // жест ручки — один шаг отмены
        interaction.current = { kind: 'handle', ...handle, pointerId: e.pointerId };
        return;
      }
      const hits = model.hitTest(pageId, world, HIT_TOLERANCE_PX / currentCamera().zoom);
      const root = hits.length ? model.rootOf(hits[0]!) : null;
      const store = useBoard.getState();
      if (root) {
        const wasSelected = store.selection.includes(root);
        let next = store.selection;
        if (e.shiftKey) next = wasSelected ? next.filter((x) => x !== root) : [...next, root];
        else if (!wasSelected) next = [root];
        store.setSelection(next);
        const moveLeaves = model.leaves(next);
        const canMove = !!caps?.write && moveLeaves.length > 0 && moveLeaves.every((id) => model.canModify(id, 'x'));
        if (canMove && next.includes(root)) {
          interaction.current = {
            kind: 'move',
            startScreen: sp,
            startWorld: world,
            leaves: moveLeaves,
            origin: new Map(moveLeaves.map((id) => [id, { x: model.getObject(id)!.x, y: model.getObject(id)!.y }])),
            moved: false,
            pointerId: e.pointerId,
            clickRoot: root,
            wasSelected,
            snapPoints: moveLeaves
              .flatMap((id) => {
                const en = model.get(id);
                return en?.module?.getSnapPoints?.(en.obj, model.resolve).map((p) => p.point) ?? [];
              })
              .slice(0, 12),
          };
        }
      } else {
        if (!e.shiftKey) store.setSelection([]);
        interaction.current = { kind: 'marquee', start: world, additive: e.shiftKey, base: e.shiftKey ? store.selection : [], pointerId: e.pointerId };
      }
      return;
    }

    // Инструмент плагина.
    const unavailable = toolUnavailable(tool, caps);
    if (unavailable) {
      toast.info(unavailable);
      return;
    }
    if (!model.canCreateOn(pageId)) {
      toast.info('На этой странице нельзя создавать объекты');
      return;
    }
    interaction.current = { kind: 'tool', pointerId: e.pointerId };
    tool.onPointerDown(toolEvent(e, world), toolCtx);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sp = screenPoint(e);
    if (presence && pageId) {
      const w = toWorld(sp);
      presence.setCursor({ pageId, x: w.x, y: w.y });
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, sp);
    const it = interaction.current;

    if (it.kind === 'pinch' && pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p0 = pinch.current;
      let cam = zoomAt(p0.cam, sizeRef.current, p0.mid, p0.cam.zoom * (dist / Math.max(1, p0.dist)));
      cam = panBy(cam, mid.x - p0.mid.x, mid.y - p0.mid.y);
      setCamera(cam);
      return;
    }
    if (it.kind === 'pan' && it.pointerId === e.pointerId) {
      setCamera(panBy(currentCamera(), sp.x - it.last.x, sp.y - it.last.y));
      interaction.current = { ...it, last: sp };
      return;
    }
    const world = toWorld(sp);
    if (it.kind === 'laser' && it.pointerId === e.pointerId) {
      laser?.move(world);
      return;
    }
    if (it.kind === 'marquee' && it.pointerId === e.pointerId) {
      useBoard.getState().setMarquee(rectFrom(it.start, world));
      return;
    }
    if (it.kind === 'move' && it.pointerId === e.pointerId) {
      if (!it.moved && Math.hypot(sp.x - it.startScreen.x, sp.y - it.startScreen.y) < DRAG_THRESHOLD_PX) return;
      it.moved = true;
      // Во время перетаскивания узлы двигаются напрямую (без записи в документ
      // на каждом кадре); в документ — одна транзакция при отпускании.
      const { dx, dy } = snappedDelta(it, world, e.altKey);
      for (const id of it.leaves) {
        const node = nodes.current.get(id);
        const o = it.origin.get(id)!;
        node?.position({ x: o.x + dx, y: o.y + dy });
      }
      transformerRef.current?.forceUpdate();
      stageRef.current?.batchDraw();
      return;
    }
    if (it.kind === 'handle' && it.pointerId === e.pointerId) {
      const entry = model.get(it.objectId);
      const snap = snapPoint(world, e.altKey, new Set([it.objectId]));
      useBoard.getState().setSnapHint(snap && snap.kind !== 'grid' ? snap : null);
      const target = snap?.point ?? world;
      const patch = entry?.module?.dragHandle?.(entry.obj, it.handleId, target, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, model.resolve);
      // Ручки двигаются редко и коротко: пишем сразу, шаги склеиваются в один шаг отмены.
      if (patch) model.updateObjects([{ id: it.objectId, patch }], { merge: true });
      return;
    }
    if (it.kind === 'tool' && it.pointerId === e.pointerId) {
      // Перо выдаёт точки чаще кадров: промежуточные (coalesced) события
      // делают рукописную линию плавной. Инструментам с привязкой они не нужны.
      const native = e.nativeEvent;
      const coalesced = !tool?.snapping && typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      if (coalesced.length > 1) {
        for (const ce of coalesced) {
          tool?.onPointerMove?.(toolEventWith(ce as unknown as React.PointerEvent, toWorld(screenPoint(ce)), null), toolCtx);
        }
      } else tool?.onPointerMove?.(toolEvent(e, world), toolCtx);
      return;
    }
    if (it.kind === 'idle' && e.pointerType === 'mouse' && pageId) {
      const hits = model.hitTest(pageId, world, HIT_TOLERANCE_PX / currentCamera().zoom);
      if (toolId === SELECT_TOOL_ID) {
        const over = handleAt(world) ? 'pointer' : hits.length ? 'move' : null;
        if (over !== hoverCursor) setHoverCursor(over);
      }
      scheduleHover(hits[0] ?? null, sp);
    }
  };

  /**
   * Сдвиг при перемещении с привязкой: из характерных точек перемещаемых
   * объектов выбирается та, что ближе всего «прилипает» к точке других
   * объектов или к сетке, и сдвиг корректируется на эту разницу.
   */
  const snappedDelta = (it: Extract<Interaction, { kind: 'move' }>, world: Point, alt: boolean) => {
    let dx = world.x - it.startWorld.x;
    let dy = world.y - it.startWorld.y;
    let best: { d: number; cx: number; cy: number; snap: SnapResult } | null = null;
    const exclude = new Set(it.leaves);
    for (const p of it.snapPoints) {
      const moved = { x: p.x + dx, y: p.y + dy };
      const snap = snapPoint(moved, alt, exclude);
      if (!snap) continue;
      const d = Math.hypot(snap.point.x - moved.x, snap.point.y - moved.y);
      if (!best || d < best.d) best = { d, cx: snap.point.x - moved.x, cy: snap.point.y - moved.y, snap };
    }
    if (best) {
      dx += best.cx;
      dy += best.cy;
    }
    useBoard.getState().setSnapHint(best && best.snap.kind !== 'grid' ? best.snap : null);
    return { dx, dy };
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const it = interaction.current;
    if (it.kind === 'pinch') {
      if (pointers.current.size < 2) {
        pinch.current = null;
        interaction.current = { kind: 'idle' };
      }
      return;
    }
    if ('pointerId' in it && it.pointerId !== e.pointerId) return;
    const world = toWorld(screenPoint(e));
    const store = useBoard.getState();
    switch (it.kind) {
      case 'marquee': {
        const r = rectFrom(it.start, world);
        store.setMarquee(null);
        if (pageId && r.width * currentCamera().zoom > 2 && r.height * currentCamera().zoom > 2) {
          const roots = new Set<string>();
          for (const id of model.queryRect(pageId, r)) {
            const root = model.rootOf(id);
            const b = model.boundsOf([root]);
            if (b && contains(r, b) && !model.getObject(id)?.hidden) roots.add(root);
          }
          store.setSelection([...new Set([...it.base, ...roots])]);
        }
        break;
      }
      case 'move':
        if (it.moved) {
          const { dx, dy } = snappedDelta(it, world, e.altKey);
          model.updateObjects(it.leaves.map((id) => ({ id, patch: { x: it.origin.get(id)!.x + dx, y: it.origin.get(id)!.y + dy } })));
        } else if (it.wasSelected && !e.shiftKey && store.selection.length > 1) {
          // Щелчок по уже выделенному без перетаскивания — оставить только его.
          store.setSelection([it.clickRoot]);
        }
        break;
      case 'tool':
        tool?.onPointerUp?.(toolEvent(e, world), toolCtx);
        break;
      case 'laser':
        laser?.up();
        break;
      default:
        break;
    }
    store.setSnapHint(null);
    interaction.current = { kind: 'idle' };
  };

  const cancelInteraction = () => {
    const it = interaction.current;
    if (it.kind === 'move') {
      for (const id of it.leaves) nodes.current.get(id)?.position(it.origin.get(id)!);
      stageRef.current?.batchDraw();
    }
    if (it.kind === 'marquee') useBoard.getState().setMarquee(null);
    if (it.kind === 'tool') useBoard.getState().setPreview(null);
    if (it.kind === 'laser') laser?.up();
    interaction.current = { kind: 'idle' };
  };

  // Колесо: нужен passive: false, чтобы отменить прокрутку страницы.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const cam = currentCamera();
      if (wheelIntent(e) === 'zoom') {
        useBoard.getState().setCamera(zoomAt(cam, sizeRef.current, p, cam.zoom * wheelZoomFactor(e.deltaY, e.deltaMode)));
      } else {
        useBoard.getState().setCamera(panBy(cam, -e.deltaX, -e.deltaY));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Esc отменяет текущее перетаскивание.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && interaction.current.kind !== 'idle') cancelInteraction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (externalStageRef) externalStageRef.current = stageRef.current;
  });

  // ----- Отрисовка -----
  const colors = SURFACE_COLORS[theme];
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6f5c';
  const cursor = panning || toolId === HAND_TOOL_ID
    ? interaction.current.kind === 'pan'
      ? 'grabbing'
      : 'grab'
    : toolId !== SELECT_TOOL_ID
      ? (tool?.cursor ?? 'crosshair')
      : (hoverCursor ?? 'default');

  const selectionBoxes = !transformable
    ? selection
        .map((id) => model.boundsOf([id]))
        .filter((b): b is Rect => !!b)
    : [];
  const handles =
    selection.length === 1 && caps?.write && model.get(selection[0]!)?.module?.dragHandle
      ? model.get(selection[0]!)!.module!.getHandles(model.get(selection[0]!)!.obj, model.resolve)
      : [];
  void preview; // перерисовка оверлея инструмента при изменении предпросмотра

  return (
    <div
      ref={containerRef}
      className="board-canvas"
      style={{ cursor, background: colors.paper }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        cancelInteraction();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        // Двойной щелчок по тексту, формуле или решению открывает редактор.
        if (!pageId || toolId !== SELECT_TOOL_ID) return;
        const world = toWorld(screenPoint(e));
        const id = model.hitTest(pageId, world, HIT_TOLERANCE_PX / currentCamera().zoom).find((h) => model.get(h)?.module?.editor);
        const editor = id ? model.get(id)?.module?.editor : undefined;
        if (!id || !editor) return;
        if (editor === 'text') requestEditText(id);
        else if (editor === 'formula' || editor === 'solution') requestObjectEditor({ editor, id, at: null });
      }}
      onPointerLeave={() => {
        presence?.setCursor(null);
        scheduleHover(null, { x: 0, y: 0 });
      }}
      data-testid="board-canvas"
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={size.width / 2 - camera.cx * camera.zoom}
        y={size.height / 2 - camera.cy * camera.zoom}
        scaleX={camera.zoom}
        scaleY={camera.zoom}
      >
        <Layer listening={false}>
          {page && (
            <Shape
              listening={false}
              perfectDrawEnabled={false}
              sceneFunc={(ctx) => {
                // Нативный 2D-контекст: обёртка Konva не поддерживает присваивание strokeStyle.
                const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
                drawBackground(native as unknown as Ctx2D, page.background, view, camera.zoom, {
                  minor: colors.grid,
                  major: colors.gridStrong,
                });
              }}
            />
          )}
          {page?.background.pdf && <PdfBackground pdf={page.background.pdf} camera={camera} size={size} />}
        </Layer>
        <Layer>
          {visibleIds.map((id) => (
            <ObjectView key={id} model={model} id={id} theme={theme} register={register} />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={rotatable}
            keepRatio={proportional}
            flipEnabled={false}
            ignoreStroke
            anchorSize={10}
            anchorCornerRadius={5}
            borderStroke={accent}
            anchorStroke={accent}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
        <Layer listening={false}>
          {selectionBoxes.map((b, i) => (
            <KRect
              key={i}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              stroke={accent}
              strokeWidth={1.5 / camera.zoom}
              dash={[6 / camera.zoom, 4 / camera.zoom]}
            />
          ))}
          {peers.map((p) => {
            // «Редактирует …» над текстом, открытым другим участником.
            const b = p.editing && model.getObject(p.editing)?.pageId === pageId ? model.boundsOf([p.editing]) : null;
            if (!b) return null;
            const fs = 12 / camera.zoom;
            return (
              <Group key={`edit-${p.clientId}`} x={b.x} y={b.y - fs * 1.8} listening={false}>
                <KRect width={fs * (p.user.fullName.length * 0.55 + 7)} height={fs * 1.6} fill={p.user.color} cornerRadius={fs * 0.4} />
                <Text x={fs * 0.4} y={fs * 0.3} text={`Редактирует ${p.user.fullName}`} fontSize={fs} fill="#ffffff" />
                <KRect y={fs * 1.8} width={b.width} height={b.height} stroke={p.user.color} strokeWidth={1.5 / camera.zoom} dash={[6 / camera.zoom, 4 / camera.zoom]} />
              </Group>
            );
          })}
          {peers.map((p) => {
            // Недорисованные штрихи других участников.
            const d = p.drawing;
            if (!d || d.pageId !== pageId || d.points.length < 3) return null;
            return (
              <StrokeShape
                key={`draw-${p.clientId}`}
                props={{ points: d.points, width: d.width, opacity: d.opacity, pressure: d.tool === PEN_TOOL_ID }}
                color={resolveColor(d.color, theme)}
              />
            );
          })}
          {peers.map((p) => {
            if (!p.selection.length || !cursorVisible(p, caps?.role ?? 'viewer', settings?.showStudentCursors !== false)) return null;
            const onPage = p.selection.filter((id) => model.getObject(id)?.pageId === pageId);
            const b = onPage.length ? model.boundsOf(onPage) : null;
            if (!b) return null;
            const pad = 4 / camera.zoom;
            return (
              <KRect
                key={`sel-${p.clientId}`}
                x={b.x - pad}
                y={b.y - pad}
                width={b.width + pad * 2}
                height={b.height + pad * 2}
                stroke={p.user.color}
                strokeWidth={1.5 / camera.zoom}
                dash={[4 / camera.zoom, 3 / camera.zoom]}
              />
            );
          })}
          {handles.map((h) => (
            <Circle
              key={h.id}
              x={h.position.x}
              y={h.position.y}
              radius={6 / camera.zoom}
              fill="#ffffff"
              stroke={accent}
              strokeWidth={2 / camera.zoom}
            />
          ))}
          {marquee && (
            <KRect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill={accent}
              opacity={0.12}
              stroke={accent}
              strokeWidth={1 / camera.zoom}
            />
          )}
          {tool?.renderOverlay?.(toolCtx) as ReactNode}
          {snapHint && <SnapMarker hint={snapHint} zoom={camera.zoom} color={accent} />}
        </Layer>
      </Stage>
      {hover && <AuthorTooltip model={model} people={people} id={hover.id} x={hover.x} y={hover.y} />}
    </div>
  );
}

/** «Кто нарисовал»: автор, время создания и последнего изменения. */
function AuthorTooltip({ model, people, id, x, y }: { model: BoardModel; people?: PeopleDirectory; id: string; x: number; y: number }) {
  const o = model.getObject(id);
  if (!o) return null;
  const name = (uid: string) => people?.get(uid)?.fullName ?? 'участник доски';
  return (
    <div className="author-tip" style={{ left: x + 14, top: y + 18 }} role="tooltip">
      <div>
        <strong>{name(o.createdBy)}</strong> · {formatTime(o.createdAt)}
      </div>
      {(o.updatedBy !== o.createdBy || o.updatedAt - o.createdAt > 60_000) && (
        <div className="muted">
          изменено: {name(o.updatedBy)} · {formatTime(o.updatedAt)}
        </div>
      )}
      {o.locked && <div className="muted">заблокировано учителем</div>}
    </div>
  );
}

/** Маркер привязки: вид зависит от типа точки, рядом — подпись. */
function SnapMarker({ hint, zoom, color }: { hint: SnapResult; zoom: number; color: string }) {
  const r = 6 / zoom;
  const sw = 1.5 / zoom;
  const { x, y } = hint.point;
  const fill = 'rgba(255,255,255,0.6)';
  let shape: ReactNode;
  switch (hint.kind) {
    case 'intersection':
      shape = (
        <Shape
          sceneFunc={(c, sh) => {
            c.beginPath();
            c.moveTo(x - r, y - r);
            c.lineTo(x + r, y + r);
            c.moveTo(x + r, y - r);
            c.lineTo(x - r, y + r);
            c.strokeShape(sh);
          }}
          stroke={color}
          strokeWidth={sw * 1.3}
        />
      );
      break;
    case 'midpoint':
      shape = (
        <Shape
          sceneFunc={(c, sh) => {
            c.beginPath();
            c.moveTo(x, y - r);
            c.lineTo(x + r, y + r * 0.8);
            c.lineTo(x - r, y + r * 0.8);
            c.closePath();
            c.fillStrokeShape(sh);
          }}
          stroke={color}
          strokeWidth={sw}
          fill={fill}
        />
      );
      break;
    case 'center':
    case 'quadrant':
      shape = <Circle x={x} y={y} radius={r} stroke={color} strokeWidth={sw} fill={fill} />;
      break;
    default:
      shape = <KRect x={x - r} y={y - r} width={r * 2} height={r * 2} stroke={color} strokeWidth={sw} fill={fill} />;
  }
  return (
    <Group listening={false}>
      {shape}
      <Text x={x + r * 2.2} y={y + r * 1.2} text={SNAP_LABELS[hint.kind]} fontSize={11 / zoom} fill={color} />
    </Group>
  );
}

/** Экспорт для BoardPage: опции инструмента по умолчанию. */
export type { ToolOptions };
