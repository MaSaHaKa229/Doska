import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { z } from 'zod';
import type { BoardObject, InspectorField, ObjectModule, Point, Rect, RenderContext, ResolveContext } from '@doska/shared';
import { useBoard } from '../../store/board';
import { SURFACE_COLORS } from '../../objects/colors';
import { fmtNum, mathReady, useMathReady } from '../analysis/expr';
import { AXES_TYPE, frameOf, paramsOf, type Frame } from '../analysis/plot';
import {
  analyzeConic,
  angleBetween,
  conicBranches,
  conicElements,
  conicText,
  distanceToLine,
  footOnLine,
  lineGeometry,
  lineText,
  parseLine,
  parseQuadratic,
  vangle,
  vdot,
  vlen,
  type Conic,
  type LineEq,
} from './eqs';

export const PLUGIN_ID = 'math.analytic';
export const LINE_TYPE = `${PLUGIN_ID}.line`;
export const CONIC_TYPE = `${PLUGIN_ID}.conic`;
export const APOINT_TYPE = `${PLUGIN_ID}.point`;
export const VECTOR_TYPE = `${PLUGIN_ID}.vector`;
export const VECOP_TYPE = `${PLUGIN_ID}.vecop`;
export const MEASURE_TYPE = `${PLUGIN_ID}.measure`;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
type Ctx2D = CanvasRenderingContext2D;
const raw = (c: Konva.Context) => (c as unknown as { _context: Ctx2D })._context;
const ok = Number.isFinite;
const color = z.string().max(32);
const NONE: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Кадр осей объекта (первая опора). */
export function frameFor(o: BoardObject, ctx: ResolveContext): Frame | null {
  const a = ctx.getObject(o.deps[0] ?? '');
  return a?.type === AXES_TYPE ? frameOf(a) : null;
}

/** Подпись на подложке, не выходящая за область осей. */
function Label({ at, text, fill, ctx, fr }: { at: Point; text: string; fill: string; ctx: RenderContext; fr: Frame }) {
  const w = text.length * 7.2 + 10;
  const r = fr.rect;
  const x = Math.max(r.x + 4, Math.min(at.x, r.x + r.width - w - 4));
  const y = Math.max(r.y + 4, Math.min(at.y, r.y + r.height - 24));
  return (
    <Group x={x} y={y}>
      <KRect width={w} height={20} fill={SURFACE_COLORS[ctx.theme].paper} opacity={0.85} cornerRadius={4} listening={false} />
      <Text x={5} y={3} text={text} fontSize={13} fill={fill} listening={false} />
    </Group>
  );
}

function Clip({ fr, children }: { fr: Frame; children: ReactNode }) {
  const r = fr.rect;
  return (
    <Group clipX={r.x} clipY={r.y} clipWidth={r.width} clipHeight={r.height}>
      {children}
    </Group>
  );
}

function Polylines({ lines, stroke, width, dash }: { lines: Point[][]; stroke: string; width: number; dash?: number[] }) {
  return (
    <Shape
      sceneFunc={(c, shape) => {
        const g = raw(c);
        g.beginPath();
        for (const l of lines) {
          if (l.length < 2) continue;
          g.moveTo(l[0]!.x, l[0]!.y);
          for (let i = 1; i < l.length; i++) g.lineTo(l[i]!.x, l[i]!.y);
        }
        c.strokeShape(shape);
      }}
      stroke={stroke}
      strokeWidth={width}
      strokeScaleEnabled={false}
      dash={dash}
      lineJoin="round"
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/** Прямая через точку p с направлением d, обрезанная запасом за кадр (мировые координаты). */
function fullLine(fr: Frame, p: Point, d: Point): Point[] {
  const R = Math.hypot(fr.xMax - fr.xMin, fr.yMax - fr.yMin) * 2;
  const l = Math.hypot(d.x, d.y) || 1;
  return [fr.toWorld(p.x - (d.x / l) * R, p.y - (d.y / l) * R), fr.toWorld(p.x + (d.x / l) * R, p.y + (d.y / l) * R)];
}

const distSeg = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};
const nearLines = (lines: Point[][], p: Point, tol: number) => lines.some((l) => l.some((q, i) => i > 0 && distSeg(p, l[i - 1]!, q) <= tol));
const inside = (r: Rect, p: Point) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
/** Число в произведении: отрицательное — в скобках. */
const par = (v: number) => (v < 0 ? `(${fmtNum(v, 3)})` : fmtNum(v, 3));
const coords = (x: number, y: number) => `(${fmtNum(x, 3)}; ${fmtNum(y, 3)})`;

/** Привязка координат к половинам единицы (точки и векторы ставят «в клетки»). */
export const snapHalf = (v: number) => Math.round(v * 2) / 2 + 0;

// =====================================================================
//  Прямая и кривая второго порядка по уравнению
// =====================================================================

const eqStyle = {
  text: z.string().max(300),
  color,
  width: z.number().finite().min(0.5).max(16),
  dash: z.enum(['solid', 'dashed', 'dotted']),
  showEq: z.boolean(),
};

export const linePropsSchema = z.object({ ...eqStyle, showVectors: z.boolean() });
export type LineProps = z.infer<typeof linePropsSchema>;

export const conicPropsSchema = z.object({ ...eqStyle, showFoci: z.boolean(), showDirectrices: z.boolean(), showAsymptotes: z.boolean() });
export type ConicProps = z.infer<typeof conicPropsSchema>;

/** Уравнение прямой объекта (с параметрами слайдеров). */
export function lineOf(o: BoardObject, ctx: ResolveContext): LineEq | { error: string } | null {
  if (!mathReady()) return null;
  return parseLine((o.props as unknown as LineProps).text, paramsOf(o, ctx));
}

export function conicOf(o: BoardObject, ctx: ResolveContext): Conic | { error: string } | null {
  if (!mathReady()) return null;
  const q = parseQuadratic((o.props as unknown as ConicProps).text, paramsOf(o, ctx));
  return 'error' in q ? q : analyzeConic(q);
}

function LineView({ o, ctx }: { o: BoardObject<LineProps>; ctx: RenderContext }) {
  useMathReady();
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  const l = lineOf(o, ctx);
  if (!fr || !l) return null;
  const c = ctx.resolveColor(o.props.color);
  if ('error' in l) return <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + 6 }} text={`${o.props.text}: ${l.error}`} fill={ctx.resolveColor('accent-1')} ctx={ctx} fr={fr} />;
  const g = lineGeometry(l);
  const pts = fullLine(fr, g.p, g.dir);
  const labelAt = fr.toWorld(g.p.x, g.p.y);
  const vec = (d: Point, name: string, k: string, col: string) => {
    const len = Math.hypot(d.x, d.y) || 1;
    // Вектор единичной длины в масштабе графика (2 единицы), от ближайшей к началу точки.
    const s = 2 / len;
    const a = fr.toWorld(g.p.x, g.p.y);
    const b = fr.toWorld(g.p.x + d.x * s, g.p.y + d.y * s);
    return (
      <Group key={k}>
        <Arrow points={[a.x, a.y, b.x, b.y]} stroke={col} fill={col} strokeWidth={2} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />
        <Text x={b.x + 4} y={b.y - 16} text={`${name}(${fmtNum(d.x, 3)}; ${fmtNum(d.y, 3)})`} fontSize={13} fill={col} listening={false} />
      </Group>
    );
  };
  return (
    <Clip fr={fr}>
      <Line points={pts.flatMap((p) => [p.x, p.y])} stroke={c} strokeWidth={o.props.width} strokeScaleEnabled={false} dash={o.props.dash === 'dashed' ? [10, 6] : o.props.dash === 'dotted' ? [2, 5] : undefined} listening={false} />
      {o.props.showVectors && vec(g.normal, 'n', 'n', '#d13a3a')}
      {o.props.showVectors && vec(g.dir, 'a', 'a', '#2a7de1')}
      {o.props.showEq && <Label at={{ x: labelAt.x + 10, y: labelAt.y + 10 }} text={lineText(l)} fill={c} ctx={ctx} fr={fr} />}
    </Clip>
  );
}

function ConicView({ o, ctx }: { o: BoardObject<ConicProps>; ctx: RenderContext }) {
  useMathReady();
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  const k = conicOf(o, ctx);
  if (!fr || !k) return null;
  const c = ctx.resolveColor(o.props.color);
  if ('error' in k) return <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + 6 }} text={`${o.props.text}: ${k.error}`} fill={ctx.resolveColor('accent-1')} ctx={ctx} fr={fr} />;
  const R = Math.max(fr.xMax - fr.xMin, fr.yMax - fr.yMin);
  const branches = conicBranches(k, R).map((b) => b.map((p) => fr.toWorld(p.x, p.y)));
  const el = conicElements(k);
  const thin = [6 / zoom, 5 / zoom];
  return (
    <Clip fr={fr}>
      {o.props.showAsymptotes &&
        el.asymptotes.map((a, i) => <Line key={`as${i}`} points={fullLine(fr, a.p, a.d).flatMap((p) => [p.x, p.y])} stroke={c} strokeWidth={1} dash={thin} strokeScaleEnabled={false} listening={false} />)}
      {o.props.showDirectrices &&
        el.directrices.map((d, i) => <Line key={`d${i}`} points={fullLine(fr, d.p, d.d).flatMap((p) => [p.x, p.y])} stroke="#2a7de1" strokeWidth={1} dash={thin} strokeScaleEnabled={false} listening={false} />)}
      <Polylines lines={branches} stroke={c} width={o.props.width} dash={o.props.dash === 'dashed' ? [10, 6] : o.props.dash === 'dotted' ? [2, 5] : undefined} />
      {o.props.showFoci &&
        el.foci.map((f, i) => {
          const p = fr.toWorld(f.x, f.y);
          return (
            <Group key={`f${i}`}>
              <Circle x={p.x} y={p.y} radius={4.5 / zoom} fill={c} listening={false} />
              <Text x={p.x + 6} y={p.y + 4} text={k.kind === 'circle' ? 'O' : `F${el.foci.length > 1 ? ['₁', '₂'][i] : ''}`} fontSize={14} fontStyle="italic" fill={c} listening={false} />
            </Group>
          );
        })}
      {o.props.showEq && <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + fr.rect.height - 28 }} text={conicText(k)} fill={c} ctx={ctx} fr={fr} />}
    </Clip>
  );
}

const equationModule = <P extends { text: string },>(
  type: string,
  title: string,
  schema: z.ZodType<P>,
  defaults: P,
  view: (o: BoardObject<P>, ctx: RenderContext) => ReactNode,
  near: (o: BoardObject<P>, ctx: ResolveContext, fr: Frame, p: Point, tol: number) => boolean,
  inspector: InspectorField[],
  editor: string,
): ObjectModule<P, ReactNode> => ({
  type,
  title,
  version: 1,
  propsSchema: schema,
  createProps: () => ({ ...defaults }),
  serialize: (o) => o as never,
  deserialize: (r) => r as unknown as BoardObject<P>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, p, tol, ctx) => {
    const fr = frameFor(o, ctx);
    return !!fr && inside(fr.rect, p) && near(o, ctx, fr, p, tol + 3);
  },
  hitTestRect: () => false,
  getHandles: () => [],
  render: (o, ctx) => view(o, ctx),
  inspector,
  editor,
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: (o) => o.deps.slice(0, 1),
});

const STYLE: InspectorField[] = [
  { kind: 'color', key: 'color', label: 'Цвет' },
  { kind: 'stroke-width', key: 'width', label: 'Толщина' },
  { kind: 'line-style', key: 'dash', label: 'Линия' },
  { kind: 'toggle', key: 'showEq', label: 'Уравнение' },
];

export const LINE_EDITOR = 'analytic.line';
export const CONIC_EDITOR = 'analytic.conic';

export const lineModule = equationModule<LineProps>(
  LINE_TYPE,
  'Прямая по уравнению',
  linePropsSchema,
  { text: '2x - 3y + 6 = 0', color: 'accent-2', width: 2, dash: 'solid', showEq: true, showVectors: false },
  (o, ctx) => <LineView o={o} ctx={ctx} />,
  (o, ctx, fr, p, tol) => {
    const l = lineOf(o, ctx);
    if (!l || 'error' in l) return false;
    const g = lineGeometry(l);
    return nearLines([fullLine(fr, g.p, g.dir)], p, tol);
  },
  [...STYLE, { kind: 'toggle', key: 'showVectors', label: 'Векторы n и a' }],
  LINE_EDITOR,
);

export const conicModule = equationModule<ConicProps>(
  CONIC_TYPE,
  'Кривая второго порядка',
  conicPropsSchema,
  { text: 'x^2/25 + y^2/9 = 1', color: 'accent-3', width: 2.5, dash: 'solid', showEq: true, showFoci: true, showDirectrices: false, showAsymptotes: true },
  (o, ctx) => <ConicView o={o} ctx={ctx} />,
  (o, ctx, fr, p, tol) => {
    const k = conicOf(o, ctx);
    if (!k || 'error' in k) return false;
    const R = Math.max(fr.xMax - fr.xMin, fr.yMax - fr.yMin);
    return nearLines(conicBranches(k, R).map((b) => b.map((q) => fr.toWorld(q.x, q.y))), p, tol);
  },
  [...STYLE, { kind: 'toggle', key: 'showFoci', label: 'Фокусы' }, { kind: 'toggle', key: 'showDirectrices', label: 'Директрисы' }, { kind: 'toggle', key: 'showAsymptotes', label: 'Асимптоты' }],
  CONIC_EDITOR,
);

// =====================================================================
//  Точка и вектор с координатами
// =====================================================================

export const apointPropsSchema = z.object({ X: z.number().finite(), Y: z.number().finite(), label: z.string().max(20), color });
export type APointProps = z.infer<typeof apointPropsSchema>;

function APointView({ o, ctx }: { o: BoardObject<APointProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  if (!fr) return null;
  const p = fr.toWorld(o.props.X, o.props.Y);
  const c = ctx.resolveColor(o.props.color);
  return (
    <Clip fr={fr}>
      <Circle x={p.x} y={p.y} radius={5 / zoom} fill={c} stroke={SURFACE_COLORS[ctx.theme].paper} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Label at={{ x: p.x + 8, y: p.y - 26 }} text={`${o.props.label}${coords(o.props.X, o.props.Y)}`} fill={c} ctx={ctx} fr={fr} />
    </Clip>
  );
}

export const apointModule: ObjectModule<APointProps, ReactNode> = {
  type: APOINT_TYPE,
  title: 'Точка с координатами',
  version: 1,
  propsSchema: apointPropsSchema,
  createProps: () => ({ X: 0, Y: 0, label: 'M', color: 'accent-1' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<APointProps>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, p, tol, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return false;
    const q = fr.toWorld(o.props.X, o.props.Y);
    return Math.hypot(q.x - p.x, q.y - p.y) <= tol + 6;
  },
  hitTestRect: () => false,
  getHandles: (o, ctx) => {
    const fr = frameFor(o, ctx);
    return fr ? [{ id: 'p', kind: 'point', position: fr.toWorld(o.props.X, o.props.Y), label: 'Точка (координаты — по половинам клетки)', snap: false }] : [];
  },
  dragHandle: (o, _h, to, m, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return null;
    const q = fr.toMath(to);
    const X = m.alt ? Math.round(q.X * 100) / 100 : snapHalf(q.X);
    const Y = m.alt ? Math.round(q.Y * 100) / 100 : snapHalf(q.Y);
    return X === o.props.X && Y === o.props.Y ? null : { props: { X, Y } };
  },
  render: (o, ctx) => <APointView o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'label', label: 'Имя', maxLength: 20 },
    { kind: 'number', key: 'X', label: 'x', step: 0.5 },
    { kind: 'number', key: 'Y', label: 'y', step: 0.5 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: () => [],
  hitPriority: 10,
};

export const vectorPropsSchema = z.object({
  /** Начало вектора (координаты графика). */
  X0: z.number().finite(),
  Y0: z.number().finite(),
  /** Координаты вектора. */
  X: z.number().finite(),
  Y: z.number().finite(),
  name: z.string().max(20),
  color,
  showCoords: z.boolean(),
});
export type VectorProps = z.infer<typeof vectorPropsSchema>;

/** Подпись вектора: «a(3; 4), |a| = 5». */
export const vectorText = (name: string, v: Point) => `${name}(${fmtNum(v.x, 3)}; ${fmtNum(v.y, 3)}), |${name}| = ${fmtNum(vlen(v), 3)}`;

function ArrowW({ fr, from, v, stroke, zoom, dash }: { fr: Frame; from: Point; v: Point; stroke: string; zoom: number; dash?: number[] }) {
  const a = fr.toWorld(from.x, from.y);
  const b = fr.toWorld(from.x + v.x, from.y + v.y);
  return <Arrow points={[a.x, a.y, b.x, b.y]} stroke={stroke} fill={stroke} strokeWidth={2.5} strokeScaleEnabled={false} pointerLength={11 / zoom} pointerWidth={8 / zoom} dash={dash} listening={false} />;
}

function VectorView({ o, ctx }: { o: BoardObject<VectorProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  if (!fr) return null;
  const p = o.props;
  const c = ctx.resolveColor(p.color);
  const mid = fr.toWorld(p.X0 + p.X / 2, p.Y0 + p.Y / 2);
  return (
    <Clip fr={fr}>
      <ArrowW fr={fr} from={{ x: p.X0, y: p.Y0 }} v={{ x: p.X, y: p.Y }} stroke={c} zoom={zoom} />
      {p.showCoords ? (
        <Label at={{ x: mid.x + 8, y: mid.y - 24 }} text={vectorText(p.name, { x: p.X, y: p.Y })} fill={c} ctx={ctx} fr={fr} />
      ) : (
        <Text x={mid.x + 6} y={mid.y - 20} text={`${p.name}⃗`} fontSize={16} fontStyle="italic" fill={c} listening={false} />
      )}
    </Clip>
  );
}

export const vectorModule: ObjectModule<VectorProps, ReactNode> = {
  type: VECTOR_TYPE,
  title: 'Вектор с координатами',
  version: 1,
  propsSchema: vectorPropsSchema,
  createProps: () => ({ X0: 0, Y0: 0, X: 3, Y: 2, name: 'a', color: 'accent-2', showCoords: true }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<VectorProps>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, p, tol, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return false;
    const a = fr.toWorld(o.props.X0, o.props.Y0);
    const b = fr.toWorld(o.props.X0 + o.props.X, o.props.Y0 + o.props.Y);
    return distSeg(p, a, b) <= tol + 4;
  },
  hitTestRect: () => false,
  // Конец — меняет координаты вектора, начало — переносит вектор целиком.
  getHandles: (o, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return [];
    return [
      { id: 'head', kind: 'point', position: fr.toWorld(o.props.X0 + o.props.X, o.props.Y0 + o.props.Y), label: 'Конец вектора', snap: false },
      { id: 'tail', kind: 'point', position: fr.toWorld(o.props.X0, o.props.Y0), label: 'Начало: перенести вектор', snap: false },
    ];
  },
  dragHandle: (o, h, to, m, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return null;
    const q = fr.toMath(to);
    const s = (v: number) => (m.alt ? Math.round(v * 100) / 100 : snapHalf(v));
    if (h === 'tail') return { props: { X0: s(q.X), Y0: s(q.Y) } };
    return { props: { X: s(q.X - o.props.X0) + 0, Y: s(q.Y - o.props.Y0) + 0 } };
  },
  render: (o, ctx) => <VectorView o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'name', label: 'Имя', maxLength: 20 },
    { kind: 'number', key: 'X', label: 'x', step: 0.5 },
    { kind: 'number', key: 'Y', label: 'y', step: 0.5 },
    { kind: 'toggle', key: 'showCoords', label: 'Координаты' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: () => [],
  hitPriority: 10,
};

// =====================================================================
//  Действия с векторами
// =====================================================================

export const VEC_OPS = ['sum', 'diff', 'scale', 'dot'] as const;
export type VecOp = (typeof VEC_OPS)[number];

export const vecopPropsSchema = z.object({
  op: z.enum(VEC_OPS),
  /** Множитель для «умножения на число». */
  k: z.number().finite().min(-100).max(100),
  /** Сумма: правило треугольника или параллелограмма. */
  rule: z.enum(['triangle', 'parallelogram']),
  color,
});
export type VecOpProps = z.infer<typeof vecopPropsSchema>;

const vecOf = (o: BoardObject | undefined): VectorProps | null => (o?.type === VECTOR_TYPE ? (o.props as unknown as VectorProps) : null);

/** Результат действия: вектор (от начала первого) и подпись. */
export function vecResult(op: VecOp, a: VectorProps, b: VectorProps | null, k: number): { v: Point | null; text: string } {
  const A = { x: a.X, y: a.Y };
  const B = b ? { x: b.X, y: b.Y } : null;
  switch (op) {
    case 'sum':
      return B ? { v: { x: A.x + B.x, y: A.y + B.y }, text: vectorText(`${a.name} + ${b!.name}`, { x: A.x + B.x, y: A.y + B.y }) } : { v: null, text: '' };
    case 'diff':
      return B ? { v: { x: A.x - B.x, y: A.y - B.y }, text: `${a.name} − ${b!.name}(${fmtNum(A.x - B.x, 3)}; ${fmtNum(A.y - B.y, 3)})` } : { v: null, text: '' };
    case 'scale':
      return { v: { x: A.x * k, y: A.y * k }, text: `${fmtNum(k, 3)}${a.name}(${fmtNum(A.x * k, 3)}; ${fmtNum(A.y * k, 3)})` };
    case 'dot': {
      if (!B) return { v: null, text: '' };
      const d = vdot(A, B);
      const ang = vangle(A, B);
      return { v: null, text: `${a.name}·${b!.name} = ${par(A.x)}·${par(B.x)} + ${par(A.y)}·${par(B.y)} = ${fmtNum(d, 4)};  φ = ${ok(ang) ? fmtNum(ang, 4) : '—'}°` };
    }
  }
}

function VecOpView({ o, ctx }: { o: BoardObject<VecOpProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  const a = vecOf(ctx.getObject(o.deps[1] ?? ''));
  const b = vecOf(ctx.getObject(o.deps[2] ?? ''));
  if (!fr || !a || (o.props.op !== 'scale' && !b)) return null;
  const c = ctx.resolveColor(o.props.color);
  const r = vecResult(o.props.op, a, b, o.props.k);
  const start = { x: a.X0, y: a.Y0 };
  const thin = [6 / zoom, 4 / zoom];
  const els: ReactNode[] = [];
  const ac = ctx.resolveColor(a.color);
  const bc = b ? ctx.resolveColor(b.color) : c;
  if (o.props.op === 'sum' && b) {
    // Треугольник: b от конца a; параллелограмм: ещё a от конца b.
    els.push(<ArrowW key="b1" fr={fr} from={{ x: a.X0 + a.X, y: a.Y0 + a.Y }} v={{ x: b.X, y: b.Y }} stroke={bc} zoom={zoom} dash={thin} />);
    if (o.props.rule === 'parallelogram') {
      els.push(<ArrowW key="b0" fr={fr} from={start} v={{ x: b.X, y: b.Y }} stroke={bc} zoom={zoom} dash={thin} />);
      els.push(<ArrowW key="a1" fr={fr} from={{ x: a.X0 + b.X, y: a.Y0 + b.Y }} v={{ x: a.X, y: a.Y }} stroke={ac} zoom={zoom} dash={thin} />);
    }
  }
  if (o.props.op === 'diff' && b) {
    // a − b: от конца b (отложенного от начала a) к концу a.
    els.push(<ArrowW key="b0" fr={fr} from={start} v={{ x: b.X, y: b.Y }} stroke={bc} zoom={zoom} dash={thin} />);
    els.push(<ArrowW key="d" fr={fr} from={{ x: a.X0 + b.X, y: a.Y0 + b.Y }} v={r.v!} stroke={c} zoom={zoom} />);
  }
  if (o.props.op === 'dot' && b) {
    els.push(<ArrowW key="b0" fr={fr} from={start} v={{ x: b.X, y: b.Y }} stroke={bc} zoom={zoom} dash={thin} />);
    const a0 = Math.atan2(a.Y, a.X);
    const b0 = Math.atan2(b.Y, b.X);
    let d = b0 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const rr = 0.8;
    const arc = Array.from({ length: 31 }, (_, i) => fr.toWorld(a.X0 + rr * Math.cos(a0 + (d * i) / 30), a.Y0 + rr * Math.sin(a0 + (d * i) / 30)));
    els.push(<Line key="arc" points={arc.flatMap((p) => [p.x, p.y])} stroke={c} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />);
  }
  if (r.v && o.props.op !== 'diff') els.push(<ArrowW key="r" fr={fr} from={start} v={r.v} stroke={c} zoom={zoom} />);
  const end = r.v ? fr.toWorld(a.X0 + (o.props.op === 'diff' ? b!.X + r.v.x : r.v.x), a.Y0 + (o.props.op === 'diff' ? b!.Y + r.v.y : r.v.y)) : fr.toWorld(a.X0, a.Y0);
  return (
    <Clip fr={fr}>
      {els}
      <Label at={{ x: end.x + 8, y: end.y + 6 }} text={r.text} fill={c} ctx={ctx} fr={fr} />
    </Clip>
  );
}

export const vecopModule: ObjectModule<VecOpProps, ReactNode> = {
  type: VECOP_TYPE,
  title: 'Действие с векторами',
  version: 1,
  propsSchema: vecopPropsSchema,
  createProps: () => ({ op: 'sum', k: 2, rule: 'parallelogram', color: 'accent-5' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<VecOpProps>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, p, tol, ctx) => {
    const fr = frameFor(o, ctx);
    const a = vecOf(ctx.getObject(o.deps[1] ?? ''));
    const b = vecOf(ctx.getObject(o.deps[2] ?? ''));
    if (!fr || !a) return false;
    const r = vecResult(o.props.op, a, b, o.props.k);
    if (!r.v) return false;
    const from = o.props.op === 'diff' && b ? { x: a.X0 + b.X, y: a.Y0 + b.Y } : { x: a.X0, y: a.Y0 };
    return distSeg(p, fr.toWorld(from.x, from.y), fr.toWorld(from.x + r.v.x, from.y + r.v.y)) <= tol + 4;
  },
  hitTestRect: () => false,
  getHandles: () => [],
  render: (o, ctx) => <VecOpView o={o} ctx={ctx} />,
  inspector: [
    { kind: 'select', key: 'op', label: 'Действие', options: [{ value: 'sum', label: 'Сумма' }, { value: 'diff', label: 'Разность' }, { value: 'scale', label: 'Умножение на число' }, { value: 'dot', label: 'Скалярное произведение' }] },
    { kind: 'select', key: 'rule', label: 'Правило', options: [{ value: 'triangle', label: 'треугольника' }, { value: 'parallelogram', label: 'параллелограмма' }] },
    { kind: 'number', key: 'k', label: 'k', step: 0.5, slider: true, min: -5, max: 5 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: () => [],
};

// =====================================================================
//  Измерения: расстояние от точки до прямой, угол между прямыми
// =====================================================================

export const measurePropsSchema = z.object({ kind: z.enum(['dist', 'angle']), color });
export type MeasureProps = z.infer<typeof measurePropsSchema>;

/** Значение и геометрия измерения в координатах графика. */
export function measureOf(o: BoardObject<MeasureProps>, ctx: ResolveContext): { text: string; seg?: [Point, Point]; at: Point | null } | null {
  const A = ctx.getObject(o.deps[1] ?? '');
  const B = ctx.getObject(o.deps[2] ?? '');
  if (!A || !B) return null;
  if (o.props.kind === 'dist') {
    const l = lineOf(B, ctx);
    if (!l || 'error' in l || A.type !== APOINT_TYPE) return null;
    const P = { x: (A.props as unknown as APointProps).X, y: (A.props as unknown as APointProps).Y };
    const f = footOnLine(l, P);
    const d = distanceToLine(l, P);
    return { text: `d = |${par(l.A)}·${par(P.x)} + ${par(l.B)}·${par(P.y)} + ${fmtNum(l.C, 3)}| / √(${par(l.A)}² + ${par(l.B)}²) = ${fmtNum(d, 4)}`.replace(/\+ −/g, '− '), seg: [P, f], at: f };
  }
  const la = lineOf(A, ctx);
  const lb = lineOf(B, ctx);
  if (!la || !lb || 'error' in la || 'error' in lb) return null;
  const r = angleBetween(la, lb);
  return { text: `φ = ${fmtNum(r.deg, 4)}°${r.at ? `, пересечение ${coords(r.at.x, r.at.y)}` : ' (прямые параллельны)'}`, at: r.at };
}

function MeasureView({ o, ctx }: { o: BoardObject<MeasureProps>; ctx: RenderContext }) {
  useMathReady();
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  const m = fr ? measureOf(o, ctx) : null;
  if (!fr || !m) return null;
  const c = ctx.resolveColor(o.props.color);
  const at = m.at ? fr.toWorld(m.at.x, m.at.y) : { x: fr.rect.x + 6, y: fr.rect.y + 6 };
  return (
    <Clip fr={fr}>
      {m.seg && (
        <Line points={m.seg.flatMap((p) => { const w = fr.toWorld(p.x, p.y); return [w.x, w.y]; })} stroke={c} strokeWidth={2} dash={[6 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      )}
      {m.at && <Circle x={at.x} y={at.y} radius={4 / zoom} fill={c} listening={false} />}
      <Label at={{ x: at.x + 8, y: at.y + 8 }} text={m.text} fill={c} ctx={ctx} fr={fr} />
    </Clip>
  );
}

export const measureModule: ObjectModule<MeasureProps, ReactNode> = {
  type: MEASURE_TYPE,
  title: 'Измерение',
  version: 1,
  propsSchema: measurePropsSchema,
  createProps: () => ({ kind: 'dist', color: 'accent-6' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<MeasureProps>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, p, tol, ctx) => {
    const fr = frameFor(o, ctx);
    const m = fr ? measureOf(o, ctx) : null;
    if (!fr || !m) return false;
    if (m.seg) return distSeg(p, fr.toWorld(m.seg[0].x, m.seg[0].y), fr.toWorld(m.seg[1].x, m.seg[1].y)) <= tol + 4;
    return !!m.at && Math.hypot(fr.toWorld(m.at.x, m.at.y).x - p.x, fr.toWorld(m.at.x, m.at.y).y - p.y) <= tol + 8;
  },
  hitTestRect: () => false,
  getHandles: () => [],
  render: (o, ctx) => <MeasureView o={o} ctx={ctx} />,
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: () => [],
};

export const analyticModules = [lineModule, conicModule, apointModule, vectorModule, vecopModule, measureModule];
export type { Conic };
