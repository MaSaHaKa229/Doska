import type { ReactNode } from 'react';
import { Arrow, Text } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule, ToolPointerEvent } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { CELL, QUANTITY_INFO, type Quantity } from './quantities';
import { AXES_TYPE, SCALE_EDITOR, SCALE_TYPE, axesAngleDeg, physAxesModule, type PhysAxesProps, type ScaleProps } from './axes';
import { BODY_KIND_TITLES, BODY_TYPE, SUPPORT_TITLES, SUPPORT_TYPE, physBodyModule, supportModule, type BodyProps, type PhysBodyKind, type SupportKind, type SupportProps } from './bodies';
import { PLUGIN_ID, SUM_TYPE, VECTOR_TYPE, sumModule, vectorModule, type SumProps, type VectorProps } from './vectors';

const section = PLUGIN_ID;
const HINT = '#2a7de1';

/** Масштаб величины на странице (единиц в клетке) или 0. */
export function pageScale(ctx: Pick<ToolContext, 'listObjects'>, q: Quantity): number {
  const s = ctx.listObjects(SCALE_TYPE).find((o) => (o.props as ScaleProps).q === q);
  return s ? (s.props as ScaleProps).perCell : 0;
}

function hint(ctx: ToolContext, at: Point, text: string) {
  const w = ctx.screenToWorld(1);
  return <Text x={at.x + 14 * w} y={at.y + 14 * w} text={text} fontSize={13 * w} fill={HINT} listening={false} />;
}

// =====================================================================
//  Вектор величины: протяжка от точки приложения
// =====================================================================

interface Drag {
  tail: Point;
  tip: Point;
}

/**
 * Конец вектора. Привязка к объекту — точно в его точку; привязка к сетке —
 * целые клетки от точки приложения (длина и проекции — целые клетки, как в
 * тетради). Shift — угол кратен 15°, Alt — без привязки.
 */
function tipOf(tail: Point, e: ToolPointerEvent): Point {
  let p = e.modifiers.alt ? e.world : e.snapped;
  if (!e.modifiers.alt && !e.snap && (p.x !== e.world.x || p.y !== e.world.y))
    p = { x: tail.x + Math.round((e.world.x - tail.x) / CELL) * CELL, y: tail.y + Math.round((e.world.y - tail.y) / CELL) * CELL };
  if (!e.modifiers.shift) return p;
  const dx = p.x - tail.x;
  const dy = p.y - tail.y;
  const l = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: tail.x + Math.cos(a) * l, y: tail.y + Math.sin(a) * l };
}

function vectorTool(q: Quantity, icon: string): ToolModule<ReactNode> {
  const info = QUANTITY_INFO[q];
  return {
    id: `${PLUGIN_ID}.${q}`,
    title: q === 'other' ? 'Вектор величины' : `Вектор: ${info.title.toLowerCase()}`,
    icon,
    group: 'physics',
    section,
    keywords: [...info.keywords, 'вектор', 'физика'],
    requiresWrite: true,
    snapping: true,
    cursor: 'crosshair',
    onPointerDown(e, ctx) {
      const tail = e.modifiers.alt ? e.world : e.snapped;
      ctx.setPreview({ tail, tip: tail } satisfies Drag);
    },
    onPointerMove(e, ctx) {
      const d = ctx.getPreview<Drag>();
      if (d) ctx.setPreview({ ...d, tip: tipOf(d.tail, e) } satisfies Drag);
    },
    onPointerUp(e, ctx) {
      const d = ctx.getPreview<Drag>();
      ctx.setPreview(null);
      if (!d) return;
      let tip = tipOf(d.tail, e);
      // Щелчок без протяжки — вектор в 4 клетки вправо.
      if (Math.hypot(tip.x - d.tail.x, tip.y - d.tail.y) < 8) tip = { x: d.tail.x + CELL * 4, y: d.tail.y };
      const props: VectorProps = { ...vectorModule.createProps(), q, label: info.symbol, color: info.color, dx: tip.x - d.tail.x, dy: tip.y - d.tail.y, perCell: pageScale(ctx, q) };
      const id = ctx.createObject<VectorProps>(VECTOR_TYPE, { x: d.tail.x, y: d.tail.y, props });
      if (id) ctx.setSelection([id]);
    },
    onKeyDown(key, _m, ctx) {
      if (key !== 'Escape' || !ctx.getPreview<Drag>()) return false;
      ctx.setPreview(null);
      return true;
    },
    renderOverlay(ctx) {
      const d = ctx.getPreview<Drag>();
      if (!d || Math.hypot(d.tip.x - d.tail.x, d.tip.y - d.tail.y) < 2) return null;
      const w = ctx.screenToWorld(1);
      return <Arrow points={[d.tail.x, d.tail.y, d.tip.x, d.tip.y]} stroke={HINT} fill={HINT} strokeWidth={2} strokeScaleEnabled={false} pointerLength={12 * w} pointerWidth={9 * w} listening={false} />;
    },
  };
}

// =====================================================================
//  Сумма векторов: щелчки по слагаемым, Enter или щелчок мимо — готово
// =====================================================================

interface Picks {
  ids: string[];
  cursor: Point | null;
}

const vectorAt = (ctx: ToolContext, at: Point) => ctx.hitTest(at, ctx.screenToWorld(6)).find((o) => o.type === VECTOR_TYPE);

function createSum(ctx: ToolContext, ids: string[]): void {
  if (ids.length < 2) return;
  const id = ctx.createObject<SumProps>(SUM_TYPE, { x: 0, y: 0, props: sumModule.createProps(), deps: ids });
  ctx.activateTool('core.select');
  if (id) ctx.setSelection([id]);
}

const sumTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.sum`,
  title: 'Сумма векторов',
  icon: 'Sigma',
  group: 'physics',
  section,
  keywords: ['сумма векторов', 'равнодействующая', 'правило параллелограмма', 'правило многоугольника', 'сложение сил'],
  requiresWrite: true,
  cursor: 'pointer',
  onActivate(ctx) {
    // Выделенные заранее векторы складываются сразу.
    const sel = ctx.getSelection().filter((id) => ctx.resolve.getObject(id)?.type === VECTOR_TYPE);
    if (sel.length >= 2) createSum(ctx, sel);
    else ctx.setPreview({ ids: [], cursor: null } satisfies Picks);
  },
  onPointerMove(e, ctx) {
    const p = ctx.getPreview<Picks>();
    if (p) ctx.setPreview({ ...p, cursor: e.world });
  },
  onPointerDown(e, ctx) {
    const p = ctx.getPreview<Picks>() ?? { ids: [], cursor: null };
    const v = vectorAt(ctx, e.world);
    if (!v) {
      if (p.ids.length >= 2) createSum(ctx, p.ids);
      return;
    }
    if (p.ids.includes(v.id)) return;
    ctx.setPreview({ ids: [...p.ids, v.id], cursor: e.world } satisfies Picks);
    ctx.setSelection([...p.ids, v.id]);
  },
  onKeyDown(key, _m, ctx) {
    const p = ctx.getPreview<Picks>();
    if (key === 'Enter' && p && p.ids.length >= 2) {
      createSum(ctx, p.ids);
      return true;
    }
    if (key === 'Escape' && p?.ids.length) {
      ctx.setPreview({ ids: [], cursor: p.cursor } satisfies Picks);
      ctx.setSelection([]);
      return true;
    }
    return false;
  },
  onDeactivate: (ctx) => ctx.setPreview(null),
  renderOverlay(ctx) {
    const p = ctx.getPreview<Picks>();
    if (!p?.cursor) return null;
    const n = p.ids.length;
    return hint(ctx, p.cursor, n < 2 ? `Сумма: выберите ${n ? 'ещё вектор' : 'векторы-слагаемые'}` : `Выбрано ${n}: ещё вектор или Enter (щелчок мимо) — сумма`);
  },
};

// =====================================================================
//  Проекции на оси: щелчок по вектору (оси — ближайшие на странице)
// =====================================================================

const decomposeTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.decompose`,
  title: 'Проекции на оси',
  icon: 'Axis3d',
  group: 'physics',
  section,
  keywords: ['проекции', 'разложение вектора', 'проекция силы', 'компоненты вектора', 'fx fy'],
  requiresWrite: true,
  cursor: 'pointer',
  onPointerMove: (e, ctx) => ctx.setPreview(e.world),
  onDeactivate: (ctx) => ctx.setPreview(null),
  onPointerDown(e, ctx) {
    const v = vectorAt(ctx, e.world) as BoardObject<VectorProps> | undefined;
    if (!v) return;
    // Оси — ближайшие к точке приложения (повёрнутые — например, вдоль наклонной плоскости).
    const axes = ctx.listObjects(AXES_TYPE).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
    const axisAngle = axes ? axesAngleDeg(axes) : 0;
    ctx.updateObject<VectorProps>(v.id, { props: v.props.decompose && v.props.axisAngle === axisAngle ? { decompose: false } : { decompose: true, axisAngle } });
  },
  renderOverlay(ctx) {
    const p = ctx.getPreview<Point>();
    return p ? hint(ctx, p, 'Проекции: щёлкните по вектору (повторно — убрать)') : null;
  },
};

// =====================================================================
//  Тела, опоры, оси, масштаб — щелчком
// =====================================================================

function bodyTool(kind: PhysBodyKind, icon: string, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${kind}`,
    title: BODY_KIND_TITLES[kind],
    icon,
    group: 'physics',
    section,
    keywords: [...keywords, 'тело', 'физика'],
    requiresWrite: true,
    snapping: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const base = physBodyModule.createProps();
      const props: BodyProps = { ...base, kind, label: kind === 'point' ? 'A' : 'm', ...(kind === 'ball' ? { w: 60 } : {}) };
      const half = kind === 'block' ? props.h / 2 : kind === 'ball' ? props.w / 2 : 0;
      // Тело встаёт на опору: щелчок по линии опоры — нижняя грань на ней.
      const onLine = e.snap && e.snap.kind !== 'center';
      const at = onLine ? { x: e.snapped.x, y: e.snapped.y - half } : e.world;
      const id = ctx.createObject<BodyProps>(BODY_TYPE, { x: at.x, y: at.y, props });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

function supportTool(kind: SupportKind, icon: string, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${kind}`,
    title: SUPPORT_TITLES[kind],
    icon,
    group: 'physics',
    section,
    keywords: [...keywords, 'опора', 'физика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const props: SupportProps = { ...supportModule.createProps(), kind, len: kind === 'mount' ? 100 : 240 };
      const id = ctx.createObject<SupportProps>(SUPPORT_TYPE, { x: e.world.x - props.len / 2, y: e.world.y, props, ...(kind === 'mount' ? { rotation: Math.PI } : {}) });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

const axesTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.axes`,
  title: 'Оси координат',
  icon: 'Move',
  group: 'physics',
  section,
  keywords: ['оси координат', 'система отсчёта', 'ось x', 'ось y', 'физика'],
  requiresWrite: true,
  snapping: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    const id = ctx.createObject<PhysAxesProps>(AXES_TYPE, { x: e.snapped.x, y: e.snapped.y, props: physAxesModule.createProps() });
    ctx.activateTool('core.select');
    if (id) ctx.setSelection([id]);
  },
};

const scaleTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.scale`,
  title: 'Масштаб',
  icon: 'Ruler',
  group: 'physics',
  section,
  keywords: ['масштаб', 'клетка', 'масштаб сил', 'единиц в клетке'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    ctx.activateTool('core.select');
    requestObjectEditor({ editor: SCALE_EDITOR, id: null, at: e.world });
  },
};

export const commonTools: ToolModule<ReactNode>[] = [
  vectorTool('force', 'MoveUpRight'),
  vectorTool('velocity', 'MoveRight'),
  vectorTool('acceleration', 'ChevronsRight'),
  vectorTool('momentum', 'ArrowBigRight'),
  vectorTool('displacement', 'ArrowRightFromLine'),
  vectorTool('field', 'Zap'),
  vectorTool('other', 'ArrowUpRight'),
  sumTool,
  decomposeTool,
  bodyTool('block', 'RectangleHorizontal', ['брусок', 'груз', 'тело на плоскости']),
  bodyTool('ball', 'CircleDot', ['шар', 'шарик', 'мяч']),
  bodyTool('point', 'Dot', ['материальная точка', 'точка']),
  supportTool('surface', 'Minus', ['пол', 'стена', 'потолок', 'поверхность', 'наклонная плоскость', 'штриховка']),
  supportTool('mount', 'Anchor', ['подвес', 'крепление', 'потолок', 'нить']),
  axesTool,
  scaleTool,
];
