import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Rect as KRect, Shape, Stage, Text, Transformer } from 'react-konva';
import type { BoardObject, Point, Rect, RenderContext, ToolContext, ToolPointerEvent } from '@doska/shared';
import type { BoardModel } from '../collab/model';
import { useBoard, currentCamera, type ToolOptions } from '../store/board';
import { useAuth } from '../store/auth';
import { registry } from '../plugins/registry';
import { DEFAULT_CAMERA, panBy, screenToWorld, viewportRect, wheelIntent, wheelZoomFactor, zoomAt, type Camera, type Size } from './camera';
import { drawBackground, type Ctx2D } from './background';
import { resolveColor, SURFACE_COLORS, type CanvasTheme } from '../objects/colors';
import { HAND_TOOL_ID, SELECT_TOOL_ID } from '../tools/shape-tools';
import { noWriteHint } from '@doska/shared';
import { toast } from '../store/toast';

/** Допуск попадания курсора, экранные пиксели. */
const HIT_TOLERANCE_PX = 6;
/** Порог, после которого нажатие считается перетаскиванием, экранные пиксели. */
const DRAG_THRESHOLD_PX = 3;
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
const ObjectView = memo(function ObjectView({ model, id, theme, register }: ObjectViewProps) {
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
}

export function BoardStage({ model, stageRef: externalStageRef, sizeRef: externalSizeRef }: BoardStageProps) {
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
  const caps = useBoard((s) => s.caps);
  const penOnly = useAuth((s) => s.user?.preferences.penOnly ?? false);

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
    const patches = tr.nodes().map((node) => ({
      id: node.id(),
      patch: {
        x: node.x(),
        y: node.y(),
        rotation: (node.rotation() * Math.PI) / 180,
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      },
    }));
    model.updateObjects(patches);
  };

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
      transact: (fn) => model.transact(fn),
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

  const toolEvent = (e: React.PointerEvent, world: Point): ToolPointerEvent => ({
    world,
    snapped: world, // привязки к сетке и объектам — этап 3.3
    snap: null,
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
          };
        }
      } else {
        if (!e.shiftKey) store.setSelection([]);
        interaction.current = { kind: 'marquee', start: world, additive: e.shiftKey, base: e.shiftKey ? store.selection : [], pointerId: e.pointerId };
      }
      return;
    }

    // Инструмент плагина.
    if (tool.requiresWrite && !caps?.write) {
      toast.info(noWriteHint(caps?.noWriteReason ?? 'read-only') ?? 'Нет права записи');
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
    if (it.kind === 'marquee' && it.pointerId === e.pointerId) {
      useBoard.getState().setMarquee(rectFrom(it.start, world));
      return;
    }
    if (it.kind === 'move' && it.pointerId === e.pointerId) {
      if (!it.moved && Math.hypot(sp.x - it.startScreen.x, sp.y - it.startScreen.y) < DRAG_THRESHOLD_PX) return;
      it.moved = true;
      // Во время перетаскивания узлы двигаются напрямую (без записи в документ
      // на каждом кадре); в документ — одна транзакция при отпускании.
      const dx = world.x - it.startWorld.x;
      const dy = world.y - it.startWorld.y;
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
      const patch = entry?.module?.dragHandle?.(entry.obj, it.handleId, world, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, model.resolve);
      // Ручки двигаются редко и коротко: пишем сразу, шаги склеиваются в один шаг отмены.
      if (patch) model.updateObjects([{ id: it.objectId, patch }], { merge: true });
      return;
    }
    if (it.kind === 'tool' && it.pointerId === e.pointerId) {
      tool?.onPointerMove?.(toolEvent(e, world), toolCtx);
      return;
    }
    if (it.kind === 'idle' && e.pointerType === 'mouse' && pageId && toolId === SELECT_TOOL_ID) {
      const over = handleAt(world)
        ? 'pointer'
        : model.hitTest(pageId, world, HIT_TOLERANCE_PX / currentCamera().zoom).length
          ? 'move'
          : null;
      if (over !== hoverCursor) setHoverCursor(over);
    }
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
          const dx = world.x - it.startWorld.x;
          const dy = world.y - it.startWorld.y;
          model.updateObjects(it.leaves.map((id) => ({ id, patch: { x: it.origin.get(id)!.x + dx, y: it.origin.get(id)!.y + dy } })));
        } else if (it.wasSelected && !e.shiftKey && store.selection.length > 1) {
          // Щелчок по уже выделенному без перетаскивания — оставить только его.
          store.setSelection([it.clickRoot]);
        }
        break;
      case 'tool':
        tool?.onPointerUp?.(toolEvent(e, world), toolCtx);
        break;
      default:
        break;
    }
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
        </Layer>
      </Stage>
    </div>
  );
}

/** Экспорт для BoardPage: опции инструмента по умолчанию. */
export type { ToolOptions };
