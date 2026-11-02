import { createContext, useContext, type ReactNode } from 'react';
import { Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { z } from 'zod';
import type { BoardObject, Handle, InspectorField, ObjectModule, Point, Rect, RenderContext, ResolveContext } from '@doska/shared';
import { useBoard } from '../../store/board';
import { SURFACE_COLORS } from '../../objects/colors';
import { fmtNum, mathReady, useMathReady } from './expr';
import { PLUGIN_ID, type Frame } from './plot';
import { derivativeAt, extrema, fourier, graphOf, integrate, riemann, roots, taylor, type Fn, type Graph, type RiemannMethod } from './calculus';

/**
 * Анализ на графике (6.2b): объекты, опирающиеся на график функции (deps —
 * один или два графика). Рисуются в мировых координатах с обрезкой по
 * области осей; положение задают параметры в координатах графика (x, a, b…),
 * которые меняются ручками.
 */

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
type Ctx2D = CanvasRenderingContext2D;
const raw = (c: Konva.Context) => (c as unknown as { _context: Ctx2D })._context;
const ok = Number.isFinite;
const BLUE = '#2a7de1';

/** Точки функции по ширине кадра с разрывами (асимптоты, неопределённость). */
export function sampleFn(f: Fn, fr: Frame, from = fr.xMin, to = fr.xMax): Point[][] {
  const n = Math.max(100, Math.min(1200, Math.round((fr.rect.width * (to - from)) / (fr.xMax - fr.xMin))));
  const R = fr.yMax - fr.yMin;
  const out: Point[][] = [];
  let cur: Point[] = [];
  let prev: number | null = null;
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    const y = f(x);
    const bad = !ok(y) || Math.abs(y - (fr.yMin + fr.yMax) / 2) > R * 10 || (prev !== null && Math.abs(y - prev) > R * 1.5);
    if (bad && cur.length > 1) out.push(cur);
    if (bad) cur = [];
    if (ok(y) && Math.abs(y - (fr.yMin + fr.yMax) / 2) <= R * 10) cur.push(fr.toWorld(x, y));
    prev = ok(y) ? y : null;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function Polylines({ lines, stroke, width, dash }: { lines: Point[][]; stroke: string; width: number; dash?: number[] }) {
  return (
    <Shape
      sceneFunc={(c, shape) => {
        const g = raw(c);
        g.beginPath();
        for (const l of lines) {
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

/** Кадр осей текущего объекта анализа — для подписей. */
const FrameContext = createContext<Frame | null>(null);

/**
 * Подпись-плашка (на подложке, чтобы читалась поверх сетки и графиков).
 * Сдвигается внутрь области осей, чтобы не обрезаться у края.
 */
function Label({ at, text, color, ctx }: { at: Point; text: string; color: string; ctx: RenderContext }) {
  const frame = useContext(FrameContext);
  const w = text.length * 7.2 + 10;
  const r = frame?.rect;
  const x = r ? Math.max(r.x + 4, Math.min(at.x, r.x + r.width - w - 4)) : at.x;
  const y = r ? Math.max(r.y + 4, Math.min(at.y, r.y + r.height - 24)) : at.y;
  return (
    <Group x={x} y={y}>
      <KRect width={w} height={20} fill={SURFACE_COLORS[ctx.theme].paper} opacity={0.85} cornerRadius={4} listening={false} />
      <Text x={5} y={3} text={text} fontSize={13} fill={color} listening={false} />
    </Group>
  );
}

const dot = (p: Point, color: string, zoom: number, k: string, hollow = false) => (
  <Circle key={k} x={p.x} y={p.y} radius={5 / zoom} fill={hollow ? undefined : color} stroke={color} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
);

/** Координаты точки «(x; y)». */
const coords = (x: number, y: number) => `(${fmtNum(x, 3)}; ${fmtNum(y, 3)})`;
const clampX = (fr: Frame, x: number) => Math.min(fr.xMax, Math.max(fr.xMin, x));
/** Ручка на оси x (или у нижнего края, если ось вне кадра). */
const onAxis = (fr: Frame, x: number): Point => fr.toWorld(x, Math.min(fr.yMax, Math.max(fr.yMin, 0)));

// ---------------------------------------------------------------------
//  Конструктор
// ---------------------------------------------------------------------

interface FeatureDef<P> {
  name: string;
  title: string;
  schema: z.ZodType<P>;
  defaults: P;
  inspector: InspectorField[];
  /** Сколько графиков-опор. */
  graphs: 1 | 2;
  draw(g: Graph[], p: P, ctx: RenderContext, zoom: number): ReactNode;
  hit(g: Graph[], p: P, pt: Point, tol: number): boolean;
  handles?(g: Graph[], p: P): Handle[];
  drag?(g: Graph[], p: P, id: string, to: Point): Partial<P> | null;
  /** Точку на графике тянут сразу, без выделения. */
  hitPriority?: number;
}

function resolve<P>(def: FeatureDef<P>, o: BoardObject<P>, ctx: ResolveContext): Graph[] | null {
  if (!mathReady()) return null;
  const gs = o.deps.slice(0, def.graphs).map((id) => graphOf(id, ctx));
  return gs.length === def.graphs && gs.every(Boolean) ? (gs as Graph[]) : null;
}

function FeatureView<P>({ def, o, ctx }: { def: FeatureDef<P>; o: BoardObject<P>; ctx: RenderContext }) {
  useMathReady();
  const zoom = useZoom();
  const gs = resolve(def, o, ctx);
  if (!gs) return null;
  const r = gs[0]!.frame.rect;
  return (
    <FrameContext.Provider value={gs[0]!.frame}>
      <Group clipX={r.x} clipY={r.y} clipWidth={r.width} clipHeight={r.height}>
        {def.draw(gs, o.props, ctx, zoom)}
      </Group>
    </FrameContext.Provider>
  );
}

function featureModule<P>(def: FeatureDef<P>): ObjectModule<P, ReactNode> {
  return {
    type: `${PLUGIN_ID}.${def.name}`,
    title: def.title,
    version: 1,
    propsSchema: def.schema,
    createProps: () => ({ ...def.defaults }),
    serialize: (o) => o as never,
    deserialize: (r) => r as unknown as BoardObject<P>,
    getLocalBounds: (o, ctx): Rect => {
      const c = ctx.getObject(o.deps[0] ?? '');
      const g = c ? graphOf(c.id, ctx) : null;
      return g ? g.frame.rect : { x: 0, y: 0, width: 0, height: 0 };
    },
    hitTest: (o, pt, tol, ctx) => {
      const gs = resolve(def, o, ctx);
      if (!gs) return false;
      const r = gs[0]!.frame.rect;
      if (pt.x < r.x || pt.y < r.y || pt.x > r.x + r.width || pt.y > r.y + r.height) return false;
      return def.hit(gs, o.props, pt, tol + 3);
    },
    hitTestRect: () => false,
    getHandles: (o, ctx) => {
      const gs = resolve(def, o, ctx);
      return gs && def.handles ? def.handles(gs, o.props) : [];
    },
    dragHandle: (o, id, to, _m, ctx) => {
      const gs = resolve(def, o, ctx);
      const patch = gs && def.drag ? def.drag(gs, o.props, id, to) : null;
      return patch ? { props: patch } : null;
    },
    render: (o, ctx) => <FeatureView def={def} o={o} ctx={ctx} />,
    inspector: def.inspector,
    transform: { rotatable: false, resize: 'none' },
    derived: true,
    // Объект анализа сам не двигается: его положение — параметры на графике.
    moveDeps: () => [],
    unbounded: true,
    hitPriority: def.hitPriority,
  };
}

const nearLines = (lines: Point[][], p: Point, tol: number) =>
  lines.some((l) =>
    l.some((q, i) => {
      if (i === 0) return false;
      const a = l[i - 1]!;
      const dx = q.x - a.x;
      const dy = q.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) <= tol;
    }),
  );
const nearPoint = (a: Point, p: Point, tol: number) => Math.hypot(a.x - p.x, a.y - p.y) <= tol + 4;
const color = z.string().max(32);

// ---------------------------------------------------------------------
//  Точка на графике
// ---------------------------------------------------------------------

const xProps = z.object({ x: z.number().finite(), color });
type XProps = z.infer<typeof xProps>;

const graphPoint = featureModule<XProps>({
  name: 'graph-point',
  title: 'Точка на графике',
  schema: xProps,
  defaults: { x: 1, color: 'accent-1' },
  inspector: [
    { kind: 'number', key: 'x', label: 'x', step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    const y = g!.f(p.x);
    if (!ok(y)) return null;
    const at = g!.frame.toWorld(p.x, y);
    const c = ctx.resolveColor(p.color);
    const axis = onAxis(g!.frame, p.x);
    const yAxis = g!.frame.toWorld(Math.min(g!.frame.xMax, Math.max(g!.frame.xMin, 0)), y);
    return (
      <>
        <Line points={[at.x, at.y, axis.x, axis.y]} stroke={c} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
        <Line points={[at.x, at.y, yAxis.x, yAxis.y]} stroke={c} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
        {dot(at, c, zoom, 'p')}
        <Label at={{ x: at.x + 8, y: at.y - 26 }} text={coords(p.x, y)} color={c} ctx={ctx} />
      </>
    );
  },
  hit: ([g], p, pt, tol) => {
    const y = g!.f(p.x);
    return ok(y) && nearPoint(g!.frame.toWorld(p.x, y), pt, tol);
  },
  handles: ([g], p) => {
    const y = g!.f(p.x);
    return ok(y) ? [{ id: 'x', kind: 'point', position: g!.frame.toWorld(p.x, y), label: 'Точка на графике', snap: false }] : [];
  },
  drag: ([g], _p, _id, to) => ({ x: clampX(g!.frame, g!.frame.toMath(to).X) }),
  hitPriority: 10,
});

// ---------------------------------------------------------------------
//  Особые точки: нули, экстремумы, пересечения двух графиков
// ---------------------------------------------------------------------

const specialProps = z.object({ color, labels: z.boolean() });
type SpecialProps = z.infer<typeof specialProps>;

function specialPoints(kind: 'roots' | 'extrema' | 'intersections', gs: Graph[]): { x: number; y: number; note?: string }[] {
  const fr = gs[0]!.frame;
  if (kind === 'roots') return roots(gs[0]!.f, fr.xMin, fr.xMax).map((x) => ({ x, y: 0 }));
  if (kind === 'extrema') return extrema(gs[0]!.f, fr.xMin, fr.xMax).map((e) => ({ x: e.x, y: e.y, note: e.kind === 'max' ? 'max' : 'min' }));
  const f = gs[0]!.f;
  const g = gs[1]!.f;
  return roots((x) => f(x) - g(x), fr.xMin, fr.xMax).map((x) => ({ x, y: f(x) }));
}

function specialModule(kind: 'roots' | 'extrema' | 'intersections', title: string) {
  return featureModule<SpecialProps>({
    name: kind,
    title,
    schema: specialProps,
    defaults: { color: 'accent-1', labels: true },
    inspector: [
      { kind: 'toggle', key: 'labels', label: 'Координаты' },
      { kind: 'color', key: 'color', label: 'Цвет' },
    ],
    graphs: kind === 'intersections' ? 2 : 1,
    draw: (gs, p, ctx, zoom) => {
      const c = ctx.resolveColor(p.color);
      return specialPoints(kind, gs).map((q, i) => {
        const at = gs[0]!.frame.toWorld(q.x, q.y);
        return (
          <Group key={i}>
            {dot(at, c, zoom, 'd')}
            {p.labels && <Label at={{ x: at.x + 8, y: at.y + (q.note === 'min' ? 6 : -26) }} text={`${q.note ? `${q.note} ` : ''}${coords(q.x, q.y)}`} color={c} ctx={ctx} />}
          </Group>
        );
      });
    },
    hit: (gs, _p, pt, tol) => specialPoints(kind, gs).some((q) => nearPoint(gs[0]!.frame.toWorld(q.x, q.y), pt, tol)),
  });
}

// ---------------------------------------------------------------------
//  Касательная и секущая
// ---------------------------------------------------------------------

const tangentProps = z.object({ x: z.number().finite(), color, showEq: z.boolean() });
type TangentProps = z.infer<typeof tangentProps>;

/** Уравнение прямой «y = kx + b» для подписи. */
export function lineEq(k: number, b: number): string {
  const kk = Math.abs(k) < 1e-9 ? '' : `${fmtNum(k, 3) === '1' ? '' : fmtNum(k, 3) === '−1' ? '−' : fmtNum(k, 3)}x`;
  const bb = Math.abs(b) < 1e-9 ? '' : `${b < 0 ? ' − ' : kk ? ' + ' : ''}${fmtNum(Math.abs(b), 3)}`;
  return `y = ${kk}${bb}` + (!kk && !bb ? '0' : '');
}

function tangentLine(g: Graph, x: number): { k: number; b: number; y: number } | null {
  const y = g.f(x);
  const k = derivativeAt(g, x);
  return ok(y) && ok(k) ? { k, b: y - k * x, y } : null;
}

const fullLine = (fr: Frame, k: number, b: number): number[] => {
  const a = fr.toWorld(fr.xMin, k * fr.xMin + b);
  const c = fr.toWorld(fr.xMax, k * fr.xMax + b);
  return [a.x, a.y, c.x, c.y];
};

const tangent = featureModule<TangentProps>({
  name: 'tangent',
  title: 'Касательная к графику',
  schema: tangentProps,
  defaults: { x: 1, color: 'accent-5', showEq: true },
  inspector: [
    { kind: 'number', key: 'x', label: 'x₀', step: 0.1 },
    { kind: 'toggle', key: 'showEq', label: 'Уравнение' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    const t = tangentLine(g!, p.x);
    if (!t) return null;
    const c = ctx.resolveColor(p.color);
    const at = g!.frame.toWorld(p.x, t.y);
    return (
      <>
        <Line points={fullLine(g!.frame, t.k, t.b)} stroke={c} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
        {dot(at, c, zoom, 'p')}
        {p.showEq && <Label at={{ x: at.x + 10, y: at.y + 8 }} text={`${lineEq(t.k, t.b)}   k = f′(${fmtNum(p.x, 3)}) = ${fmtNum(t.k, 3)}`} color={c} ctx={ctx} />}
      </>
    );
  },
  hit: ([g], p, pt, tol) => {
    const t = tangentLine(g!, p.x);
    if (!t) return false;
    const l = fullLine(g!.frame, t.k, t.b);
    return nearLines([[{ x: l[0]!, y: l[1]! }, { x: l[2]!, y: l[3]! }]], pt, tol);
  },
  handles: ([g], p) => {
    const y = g!.f(p.x);
    return ok(y) ? [{ id: 'x', kind: 'point', position: g!.frame.toWorld(p.x, y), label: 'Точка касания', snap: false }] : [];
  },
  drag: ([g], _p, _id, to) => ({ x: clampX(g!.frame, g!.frame.toMath(to).X) }),
});

const secantProps = z.object({ x1: z.number().finite(), x2: z.number().finite(), color });
type SecantProps = z.infer<typeof secantProps>;

const secant = featureModule<SecantProps>({
  name: 'secant',
  title: 'Секущая',
  schema: secantProps,
  defaults: { x1: 0, x2: 2, color: 'accent-7' },
  inspector: [
    { kind: 'number', key: 'x1', label: 'x₁', step: 0.1 },
    { kind: 'number', key: 'x2', label: 'x₂', step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    const y1 = g!.f(p.x1);
    const y2 = g!.f(p.x2);
    if (!ok(y1) || !ok(y2) || p.x1 === p.x2) return null;
    const k = (y2 - y1) / (p.x2 - p.x1);
    const c = ctx.resolveColor(p.color);
    const a = g!.frame.toWorld(p.x1, y1);
    const b = g!.frame.toWorld(p.x2, y2);
    return (
      <>
        <Line points={fullLine(g!.frame, k, y1 - k * p.x1)} stroke={c} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
        {dot(a, c, zoom, 'a')}
        {dot(b, c, zoom, 'b')}
        <Label at={{ x: Math.max(a.x, b.x) + 10, y: Math.min(a.y, b.y) - 24 }} text={`k = Δy/Δx = ${fmtNum(k, 3)}`} color={c} ctx={ctx} />
      </>
    );
  },
  hit: ([g], p, pt, tol) => {
    const y1 = g!.f(p.x1);
    const y2 = g!.f(p.x2);
    if (!ok(y1) || !ok(y2) || p.x1 === p.x2) return false;
    const k = (y2 - y1) / (p.x2 - p.x1);
    const l = fullLine(g!.frame, k, y1 - k * p.x1);
    return nearLines([[{ x: l[0]!, y: l[1]! }, { x: l[2]!, y: l[3]! }]], pt, tol);
  },
  handles: ([g], p) =>
    (['x1', 'x2'] as const).flatMap((id) => {
      const y = g!.f(p[id]);
      return ok(y) ? [{ id, kind: 'point' as const, position: g!.frame.toWorld(p[id], y), label: id === 'x1' ? 'Первая точка' : 'Вторая точка', snap: false }] : [];
    }),
  drag: ([g], _p, id, to) => ({ [id]: clampX(g!.frame, g!.frame.toMath(to).X) }),
});

// ---------------------------------------------------------------------
//  Площадь, суммы Римана
// ---------------------------------------------------------------------

const intervalHandles = (fr: Frame, a: number, b: number): Handle[] => [
  { id: 'a', kind: 'param', position: onAxis(fr, a), label: 'a — нижний предел', snap: false },
  { id: 'b', kind: 'param', position: onAxis(fr, b), label: 'b — верхний предел', snap: false },
];
const dragInterval = (fr: Frame, id: string, to: Point) => ({ [id]: Math.round(clampX(fr, fr.toMath(to).X) * 100) / 100 });

const areaProps = z.object({ a: z.number().finite(), b: z.number().finite(), color });
type AreaProps = z.infer<typeof areaProps>;

/** Многоугольник между f и g (или осью) на [a; b] в мировых координатах. */
function areaPolygon(fr: Frame, f: Fn, g: Fn, a: number, b: number): Point[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const n = 200;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const y = f(x);
    const y0 = g(x);
    if (!ok(y) || !ok(y0)) continue;
    top.push(fr.toWorld(x, y));
    bottom.push(fr.toWorld(x, y0));
  }
  return [...top, ...bottom.reverse()];
}

function areaModule(between: boolean) {
  return featureModule<AreaProps>({
    name: between ? 'area-between' : 'area',
    title: between ? 'Площадь между графиками' : 'Площадь под графиком',
    schema: areaProps,
    defaults: { a: 0, b: 2, color: 'accent-3' },
    inspector: [
      { kind: 'number', key: 'a', label: 'a', step: 0.1 },
      { kind: 'number', key: 'b', label: 'b', step: 0.1 },
      { kind: 'color', key: 'color', label: 'Цвет' },
    ],
    graphs: between ? 2 : 1,
    draw: (gs, p, ctx) => {
      const fr = gs[0]!.frame;
      const f = gs[0]!.f;
      const g: Fn = between ? gs[1]!.f : () => 0;
      const poly = areaPolygon(fr, f, g, p.a, p.b);
      const c = ctx.resolveColor(p.color);
      const v = integrate((x) => f(x) - g(x), p.a, p.b);
      const label = between ? `∫ (f − g) dx = ${fmtNum(v, 4)}` : `∫ f(x) dx = ${fmtNum(v, 4)}`;
      const at = fr.toWorld((p.a + p.b) / 2, Math.max(Math.min(fr.yMax, f((p.a + p.b) / 2)), fr.yMin));
      return (
        <>
          <Line points={poly.flatMap((q) => [q.x, q.y])} closed fill={c} opacity={0.3} listening={false} />
          <Label at={{ x: at.x - 60, y: at.y - 30 }} text={`[${fmtNum(p.a, 3)}; ${fmtNum(p.b, 3)}]  ${label}`} color={c} ctx={ctx} />
        </>
      );
    },
    hit: (gs, p, pt) => {
      const fr = gs[0]!.frame;
      const m = fr.toMath(pt);
      if (m.X < Math.min(p.a, p.b) || m.X > Math.max(p.a, p.b)) return false;
      const y1 = gs[0]!.f(m.X);
      const y0 = between ? gs[1]!.f(m.X) : 0;
      return m.Y >= Math.min(y0, y1) && m.Y <= Math.max(y0, y1);
    },
    handles: (gs, p) => intervalHandles(gs[0]!.frame, p.a, p.b),
    drag: (gs, _p, id, to) => dragInterval(gs[0]!.frame, id, to),
  });
}

const riemannProps = z.object({
  a: z.number().finite(),
  b: z.number().finite(),
  n: z.number().int().min(1).max(200),
  method: z.enum(['left', 'right', 'mid', 'trap']),
  color,
});
type RiemannProps = z.infer<typeof riemannProps>;

const METHOD_NAMES: Record<RiemannMethod, string> = { left: 'левые', right: 'правые', mid: 'средние', trap: 'трапеции' };

const riemannModule = featureModule<RiemannProps>({
  name: 'riemann',
  title: 'Суммы Римана',
  schema: riemannProps,
  defaults: { a: 0, b: 2, n: 8, method: 'left', color: 'accent-2' },
  inspector: [
    { kind: 'number', key: 'n', label: 'Отрезков', min: 1, max: 200, step: 1, slider: true },
    { kind: 'select', key: 'method', label: 'Способ', options: (Object.keys(METHOD_NAMES) as RiemannMethod[]).map((m) => ({ value: m, label: METHOD_NAMES[m] })) },
    { kind: 'number', key: 'a', label: 'a', step: 0.1 },
    { kind: 'number', key: 'b', label: 'b', step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx) => {
    const fr = g!.frame;
    const r = riemann(g!.f, p.a, p.b, p.n, p.method);
    const c = ctx.resolveColor(p.color);
    const shapes = r.parts.map((q, i) => {
      const pts = [fr.toWorld(q.x, 0), fr.toWorld(q.x, q.y0), fr.toWorld(q.x + q.w, q.y1), fr.toWorld(q.x + q.w, 0)];
      return ok(q.y0) && ok(q.y1) ? <Line key={i} points={pts.flatMap((v) => [v.x, v.y])} closed fill={c} opacity={0.25} stroke={c} strokeWidth={1} strokeScaleEnabled={false} listening={false} /> : null;
    });
    const exact = integrate(g!.f, p.a, p.b);
    const at = fr.toWorld(p.a, fr.yMax);
    return (
      <>
        {shapes}
        <Label at={{ x: at.x + 4, y: at.y + 6 }} text={`S${sub(p.n)} (${METHOD_NAMES[p.method]}) = ${fmtNum(r.sum, 4)}   ∫ = ${fmtNum(exact, 4)}`} color={c} ctx={ctx} />
      </>
    );
  },
  hit: ([g], p, pt) => {
    const fr = g!.frame;
    const m = fr.toMath(pt);
    if (m.X < Math.min(p.a, p.b) || m.X > Math.max(p.a, p.b)) return false;
    const r = riemann(g!.f, p.a, p.b, p.n, p.method);
    const part = r.parts.find((q) => m.X >= Math.min(q.x, q.x + q.w) && m.X <= Math.max(q.x, q.x + q.w));
    if (!part) return false;
    const top = Math.max(part.y0, part.y1, 0);
    const bot = Math.min(part.y0, part.y1, 0);
    return m.Y >= bot && m.Y <= top;
  },
  handles: ([g], p) => intervalHandles(g!.frame, p.a, p.b),
  drag: ([g], _p, id, to) => dragInterval(g!.frame, id, to),
});

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUBS[Number(d)]!);

// ---------------------------------------------------------------------
//  ε-δ
// ---------------------------------------------------------------------

const epsProps = z.object({ x0: z.number().finite(), eps: z.number().finite().positive(), delta: z.number().finite().positive(), color });
type EpsProps = z.infer<typeof epsProps>;

/** Предел в точке (среднее односторонних значений рядом) и выполнение условия. */
export function epsDelta(f: Fn, p: EpsProps): { L: number; holds: boolean } | null {
  const h = 1e-7 * Math.max(1, Math.abs(p.x0));
  const L = (f(p.x0 - h) + f(p.x0 + h)) / 2;
  if (!ok(L)) return null;
  let holds = true;
  for (let i = 1; i <= 400 && holds; i++) {
    const d = (p.delta * i) / 401;
    for (const x of [p.x0 - d, p.x0 + d]) {
      const y = f(x);
      if (!ok(y) || Math.abs(y - L) >= p.eps) holds = false;
    }
  }
  return { L, holds };
}

const epsModule = featureModule<EpsProps>({
  name: 'eps-delta',
  title: 'ε-δ',
  schema: epsProps,
  defaults: { x0: 1, eps: 0.5, delta: 0.3, color: 'accent-6' },
  inspector: [
    { kind: 'number', key: 'x0', label: 'x₀', step: 0.1 },
    { kind: 'number', key: 'eps', label: 'ε', min: 0.001, step: 0.05 },
    { kind: 'number', key: 'delta', label: 'δ', min: 0.001, step: 0.05 },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    const fr = g!.frame;
    const r = epsDelta(g!.f, p);
    if (!r) return null;
    const e1 = fr.toWorld(fr.xMin, r.L + p.eps);
    const e2 = fr.toWorld(fr.xMax, r.L - p.eps);
    const d1 = fr.toWorld(p.x0 - p.delta, fr.yMax);
    const d2 = fr.toWorld(p.x0 + p.delta, fr.yMin);
    const inside = sampleFn(g!.f, fr, p.x0 - p.delta, p.x0 + p.delta);
    const c = r.holds ? '#1a9b55' : '#d13a3a';
    const at = fr.toWorld(p.x0, r.L);
    return (
      <>
        <KRect x={e1.x} y={e1.y} width={e2.x - e1.x} height={e2.y - e1.y} fill="#f0a020" opacity={0.18} listening={false} />
        <KRect x={d1.x} y={d1.y} width={d2.x - d1.x} height={d2.y - d1.y} fill={BLUE} opacity={0.14} listening={false} />
        <Polylines lines={inside} stroke={c} width={4} />
        {dot(at, c, zoom, 'L', true)}
        <Label
          at={{ x: fr.rect.x + 6, y: fr.rect.y + 6 }}
          text={`L = ${fmtNum(r.L, 4)}, ε = ${fmtNum(p.eps, 3)}, δ = ${fmtNum(p.delta, 3)}: ${r.holds ? '✓ |f(x) − L| < ε при 0 < |x − x₀| < δ' : '✗ график выходит из полосы ε — уменьшите δ'}`}
          color={c}
          ctx={ctx}
        />
      </>
    );
  },
  hit: ([g], p, pt) => {
    const m = g!.frame.toMath(pt);
    return Math.abs(m.X - p.x0) <= p.delta;
  },
  handles: ([g], p) => {
    const fr = g!.frame;
    const r = epsDelta(g!.f, p);
    if (!r) return [];
    const left = fr.xMin + (fr.xMax - fr.xMin) * 0.04;
    const low = fr.yMin + (fr.yMax - fr.yMin) * 0.04;
    return [
      { id: 'x0', kind: 'point', position: fr.toWorld(p.x0, r.L), label: 'x₀', snap: false },
      { id: 'eps', kind: 'param', position: fr.toWorld(left, r.L + p.eps), label: 'ε — ширина полосы', snap: false },
      { id: 'delta', kind: 'param', position: fr.toWorld(p.x0 + p.delta, low), label: 'δ — окрестность x₀', snap: false },
    ];
  },
  drag: ([g], p, id, to) => {
    const fr = g!.frame;
    const m = fr.toMath(to);
    if (id === 'x0') return { x0: clampX(fr, m.X) };
    const r = epsDelta(g!.f, p);
    if (!r) return null;
    const round = (v: number) => Math.max(0.001, Math.round(v * 1000) / 1000);
    if (id === 'eps') return { eps: round(Math.abs(m.Y - r.L)) };
    return { delta: round(Math.abs(m.X - p.x0)) };
  },
});

// ---------------------------------------------------------------------
//  Тейлор и Фурье
// ---------------------------------------------------------------------

const taylorProps = z.object({ x0: z.number().finite(), n: z.number().int().min(0).max(12), color });
type TaylorProps = z.infer<typeof taylorProps>;

const taylorModule = featureModule<TaylorProps>({
  name: 'taylor',
  title: 'Многочлен Тейлора',
  schema: taylorProps,
  defaults: { x0: 0, n: 3, color: 'accent-1' },
  inspector: [
    { kind: 'number', key: 'n', label: 'Степень', min: 0, max: 12, step: 1, slider: true },
    { kind: 'number', key: 'x0', label: 'x₀', step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    const t = taylor(g!, p.x0, p.n);
    const fr = g!.frame;
    const c = ctx.resolveColor(p.color);
    if (!t) return <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + 6 }} text="Тейлор: производные этой функции не берутся" color={c} ctx={ctx} />;
    const y0 = g!.f(p.x0);
    return (
      <>
        <Polylines lines={sampleFn(t.p, fr)} stroke={c} width={2} dash={[8 / zoom, 5 / zoom]} />
        {ok(y0) && dot(fr.toWorld(p.x0, y0), c, zoom, 'x0')}
        <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + 30 }} text={`T${sub(p.n)}(x) в x₀ = ${fmtNum(p.x0, 3)}: ${taylorText(t.coeffs, p.x0)}`} color={c} ctx={ctx} />
      </>
    );
  },
  hit: ([g], p, pt, tol) => {
    const t = taylor(g!, p.x0, p.n);
    return !!t && nearLines(sampleFn(t.p, g!.frame), pt, tol);
  },
  handles: ([g], p) => {
    const y = g!.f(p.x0);
    return ok(y) ? [{ id: 'x0', kind: 'point', position: g!.frame.toWorld(p.x0, y), label: 'x₀', snap: false }] : [];
  },
  drag: ([g], _p, _id, to) => ({ x0: Math.round(clampX(g!.frame, g!.frame.toMath(to).X) * 100) / 100 }),
});

/** Короткая запись многочлена Тейлора (до 4 членов). */
export function taylorText(coeffs: number[], x0: number): string {
  const xs = Math.abs(x0) < 1e-12 ? 'x' : `(x ${x0 > 0 ? '−' : '+'} ${fmtNum(Math.abs(x0), 3)})`;
  const terms = coeffs
    .map((c, k) => ({ c, k }))
    .filter((t) => Math.abs(t.c) > 1e-10)
    .map(({ c, k }) => {
      const coef = k > 0 && Math.abs(Math.abs(c) - 1) < 1e-10 ? (c < 0 ? '−' : '') : fmtNum(c, 3);
      return `${coef}${k === 0 ? '' : k === 1 ? xs : `${xs}^${k}`}`;
    });
  if (!terms.length) return '0';
  const shown = terms.slice(0, 4).join(' + ').replace(/\+ −/g, '− ');
  return terms.length > 4 ? `${shown} + …` : shown;
}

const fourierProps = z.object({ a: z.number().finite(), b: z.number().finite(), n: z.number().int().min(1).max(60), color });
type FourierProps = z.infer<typeof fourierProps>;

const fourierModule = featureModule<FourierProps>({
  name: 'fourier',
  title: 'Ряд Фурье',
  schema: fourierProps,
  defaults: { a: -Math.round(Math.PI * 1e4) / 1e4, b: Math.round(Math.PI * 1e4) / 1e4, n: 5, color: 'accent-5' },
  inspector: [
    { kind: 'number', key: 'n', label: 'Слагаемых', min: 1, max: 60, step: 1, slider: true },
    { kind: 'number', key: 'a', label: 'Период от', step: 0.1 },
    { kind: 'number', key: 'b', label: 'до', step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  graphs: 1,
  draw: ([g], p, ctx, zoom) => {
    if (p.b <= p.a) return null;
    const fr = g!.frame;
    const s = fourier(g!.f, p.a, p.b, p.n);
    const c = ctx.resolveColor(p.color);
    const a = onAxis(fr, p.a);
    const b = onAxis(fr, p.b);
    return (
      <>
        <Polylines lines={sampleFn(s.s, fr)} stroke={c} width={2} />
        <Line points={[a.x, fr.rect.y, a.x, fr.rect.y + fr.rect.height]} stroke={c} strokeWidth={1} dash={[3 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
        <Line points={[b.x, fr.rect.y, b.x, fr.rect.y + fr.rect.height]} stroke={c} strokeWidth={1} dash={[3 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
        <Label at={{ x: fr.rect.x + 6, y: fr.rect.y + 54 }} text={`S${sub(p.n)}(x) — частичная сумма ряда Фурье, период [${fmtNum(p.a, 3)}; ${fmtNum(p.b, 3)}]`} color={c} ctx={ctx} />
      </>
    );
  },
  hit: ([g], p, pt, tol) => p.b > p.a && nearLines(sampleFn(fourier(g!.f, p.a, p.b, p.n).s, g!.frame), pt, tol),
  handles: ([g], p) => intervalHandles(g!.frame, p.a, p.b),
  drag: ([g], _p, id, to) => dragInterval(g!.frame, id, to),
});

export const calculusModules = [
  graphPoint,
  specialModule('roots', 'Нули функции'),
  specialModule('extrema', 'Экстремумы'),
  specialModule('intersections', 'Точки пересечения графиков'),
  tangent,
  secant,
  areaModule(false),
  areaModule(true),
  riemannModule,
  epsModule,
  taylorModule,
  fourierModule,
];
