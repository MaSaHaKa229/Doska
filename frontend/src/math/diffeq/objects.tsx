import { type ReactNode, useMemo } from 'react';
import { Arrow, Circle, Group, Line, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { niceStep } from '../analysis/expr';
import { type Compiled, type Range2, num, pretty } from '../multivar/multivar';
import { Lines, PH, PW, PlaneFrame, RANGE_FIELDS, Status, badRange, boxed, map2, rangeSchema, useCompiled, useZoom } from '../multivar/objects';
import { POINT_TITLE, type Equilibrium, type Method, equilibria, second, solveAt, solveCurve, trajectory } from './diffeq';

export const PLUGIN_ID = 'math.diffeq';
export const SLOPE_TYPE = `${PLUGIN_ID}.slope`;
export const PHASE_TYPE = `${PLUGIN_ID}.phase`;
export const SECOND_TYPE = `${PLUGIN_ID}.second`;

const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const COLORS = ['#d13a3a', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#65a30d'];
const NAMES = 'ABCDEFGH';
const BOX: Rect = { x: -50, y: -100, width: PW + 70, height: PH + 120 };

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
type Pt = z.infer<typeof pointSchema>;

/** Перенос i-й начальной точки: в пределах области, с округлением до «круглого» шага. */
function dragPoints(o: BoardObject<Range2 & { points: Pt[] }>, id: string, to: { x: number; y: number }) {
  const i = Number(id.slice(2));
  const p = o.props;
  if (!id.startsWith('p:') || !p.points[i]) return null;
  const q = toLocal(o, to);
  const v = map2(p).inv(Math.max(0, Math.min(PW, q.x)), Math.max(0, Math.min(PH, q.y)));
  const s = niceStep(((p.xMax - p.xMin) / PW) * 4);
  const round = (t: number) => Number((Math.round(t / s) * s).toPrecision(6));
  return { props: { points: p.points.map((pt, k) => (k === i ? { x: round(v.x), y: round(v.y) } : pt)) } };
}

const pointHandles = (o: BoardObject<Range2 & { points: Pt[] }>) => {
  const m = map2(o.props);
  return o.props.points.map((pt, i) => ({ id: `p:${i}`, kind: 'point' as const, position: toWorld(o, { x: m.X(pt.x), y: m.Y(pt.y) }), label: `Точка ${NAMES[i]}`, snap: false }));
};

/** «Добавить точку» / «Убрать точку»: новая — в свободном месте у центра области. */
function pointsAction(o: BoardObject<Range2 & { points: Pt[] }>, key: string): Pt[] | null {
  const p = o.props;
  if (key === 'remove') return p.points.length ? p.points.slice(0, -1) : null;
  if (key !== 'add' || p.points.length >= 8) return null;
  const k = p.points.length;
  const cx = (p.xMin + p.xMax) / 2;
  const cy = (p.yMin + p.yMax) / 2;
  const s = niceStep((p.yMax - p.yMin) / 8);
  return [...p.points, { x: Number(cx.toPrecision(6)), y: Number((cy + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * s).toPrecision(6)) }];
}

const POINT_ACTIONS = [
  { kind: 'action' as const, key: 'add', label: '＋ Точка' },
  { kind: 'action' as const, key: 'remove', label: '− Точка' },
];

function Points({ points, m, ink }: { points: Pt[]; m: ReturnType<typeof map2>; ink: string }) {
  return (
    <Group listening={false}>
      {points.map((pt, i) => (
        <Group key={i}>
          <Circle x={m.X(pt.x)} y={m.Y(pt.y)} radius={5} fill="#ffffff" stroke={COLORS[i]} strokeWidth={2.2} strokeScaleEnabled={false} listening={false} />
          <Text x={m.X(pt.x) + 7} y={m.Y(pt.y) + 3} text={NAMES[i]} fontSize={14} {...italic} fill={ink} listening={false} />
        </Group>
      ))}
    </Group>
  );
}

const pathOf = (pts: [number, number][], m: ReturnType<typeof map2>) => pts.flatMap(([x, y]) => [m.X(x), m.Y(y)]);

// =====================================================================
//  Поле направлений y′ = f(x, y)
// =====================================================================

export const slopePropsSchema = z.object({
  f: z.string().max(200),
  ...rangeSchema,
  density: z.number().int().min(6).max(36),
  method: z.enum(['rk4', 'euler', 'both']),
  h: z.number().finite().min(0.001).max(2),
  points: z.array(pointSchema).max(8),
});
export type SlopeProps = z.infer<typeof slopePropsSchema>;

function SlopeShape({ o, ctx }: { o: BoardObject<SlopeProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const cs = useCompiled([p.f]);
  const r: Range2 = { xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax };
  const curves = useMemo(() => {
    if (!cs || 'error' in cs || badRange(r)) return null;
    const f = cs[0]!.f;
    const methods: Method[] = p.method === 'both' ? ['rk4', 'euler'] : [p.method];
    return p.points.map((pt) => methods.map((mt) => ({ mt, pts: solveCurve(f, pt.x, pt.y, r, p.h, mt) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, p.xMin, p.xMax, p.yMin, p.yMax, p.method, p.h, JSON.stringify(p.points)]);
  if (badRange(r)) return <Status state={{ error: 'пределы: «от» должно быть меньше «до»' }} ink={ink} />;
  if (!cs || 'error' in cs || !curves) return <Status state={cs && 'error' in cs ? cs : null} ink={ink} />;
  const f = cs[0]!.f;
  const m = map2(r);
  const kx = PW / (r.xMax - r.xMin);
  const ky = PH / (r.yMax - r.yMin);
  const n = p.density;
  const L = (PW / n) * 0.36;
  const A = p.points[0];
  return (
    <Group listening={false}>
      <PlaneFrame r={r} ink={ink} muted={muted} />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        <Shape
          sceneFunc={(c, shape) => {
            const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
            g.beginPath();
            for (let i = 0; i < n; i++)
              for (let j = 0; j < n; j++) {
                const x = r.xMin + ((i + 0.5) / n) * (r.xMax - r.xMin);
                const y = r.yMin + ((j + 0.5) / n) * (r.yMax - r.yMin);
                const s = f(x, y);
                if (!Number.isFinite(s)) continue;
                // Наклон в пикселях: (kx, −s·ky).
                const dx = kx;
                const dy = -s * ky;
                const l = Math.hypot(dx, dy);
                g.moveTo(m.X(x) - (dx / l) * L, m.Y(y) - (dy / l) * L);
                g.lineTo(m.X(x) + (dx / l) * L, m.Y(y) + (dy / l) * L);
              }
            c.strokeShape(shape);
          }}
          stroke={muted}
          strokeWidth={1.2}
          strokeScaleEnabled={false}
          listening={false}
        />
        {curves.map((list, i) =>
          list.map(({ mt, pts }) => <Line key={`${i}${mt}`} points={pathOf(pts, m)} stroke={COLORS[i]} strokeWidth={mt === 'rk4' ? 2.2 : 1.6} dash={mt === 'euler' && p.method === 'both' ? [6 / zoom, 4 / zoom] : undefined} strokeScaleEnabled={false} listening={false} />),
        )}
      </Group>
      <Points points={p.points} m={m} ink={ink} />
      <Lines
        x={-40}
        y={-96}
        ink={ink}
        muted={muted}
        lines={[
          `Поле направлений y′ = ${p.f}`,
          A ? `Задача Коши: y(${num(A.x)}) = ${num(A.y)} (точка A)` : 'Начальных точек нет — «＋ Точка» на панели свойств',
          A ? `y(${num(A.x + 1)}) ≈ ${num(solveAt(f, A.x, A.y, A.x + 1, p.h, 'rk4'), 6)} (Рунге — Кутта),  ≈ ${num(solveAt(f, A.x, A.y, A.x + 1, p.h, 'euler'), 6)} (Эйлер),  шаг h = ${num(p.h)}` : '',
          p.method === 'both' ? 'Сплошная — Рунге — Кутта, пунктир — Эйлер: уменьшайте шаг, чтобы они сблизились' : 'Через каждую точку проходит единственная интегральная кривая',
        ].filter(Boolean)}
      />
    </Group>
  );
}

export const slopeModule: ObjectModule<SlopeProps, ReactNode> = {
  type: SLOPE_TYPE,
  title: 'Поле направлений',
  version: 1,
  propsSchema: slopePropsSchema,
  createProps: () => ({ f: 'x - y', xMin: -4, xMax: 4, yMin: -4, yMax: 4, density: 18, method: 'rk4', h: 0.1, points: [{ x: -3, y: 2 }, { x: -3, y: -3 }] }),
  deserialize: (r) => r as unknown as BoardObject<SlopeProps>,
  ...boxed(() => BOX),
  hitPriority: 1,
  getHandles: (o) => pointHandles(o),
  dragHandle: (o, id, to) => dragPoints(o, id, to),
  render: (o, ctx) => <SlopeShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'f', label: 'y′ =', maxLength: 200 },
    ...POINT_ACTIONS,
    { kind: 'select', key: 'method', label: 'Метод', options: [{ value: 'rk4', label: 'Рунге — Кутта' }, { value: 'euler', label: 'Эйлер' }, { value: 'both', label: 'Сравнить оба' }] },
    { kind: 'number', key: 'h', label: 'Шаг h', min: 0.001, max: 2, step: 0.05 },
    { kind: 'number', key: 'density', label: 'Штрихов в ряду', min: 6, max: 36, step: 1, slider: true },
    ...RANGE_FIELDS,
  ],
  runAction: (o, key, ctx) => {
    const points = pointsAction(o, key);
    if (points) ctx.updateObject<SlopeProps>(o.id, { props: { points } });
  },
} as ObjectModule<SlopeProps, ReactNode>;

// =====================================================================
//  Фазовая плоскость x′ = P(x, y), y′ = Q(x, y)
// =====================================================================

export const phasePropsSchema = z.object({
  P: z.string().max(200),
  Q: z.string().max(200),
  ...rangeSchema,
  density: z.number().int().min(6).max(30),
  tMax: z.number().finite().min(0.5).max(100),
  points: z.array(pointSchema).max(8),
});
export type PhaseProps = z.infer<typeof phasePropsSchema>;

function eqText(e: Equilibrium): string {
  const l = e.im > 0 ? `λ = ${num(e.l1)} ± ${num(e.im)}i` : `λ₁ = ${num(e.l1)}, λ₂ = ${num(e.l2)}`;
  return `(${num(e.x)}; ${num(e.y)}) — ${POINT_TITLE[e.kind]}, ${l}`;
}

function EqMark({ e, m, ink }: { e: Equilibrium; m: ReturnType<typeof map2>; ink: string }) {
  const x = m.X(e.x);
  const y = m.Y(e.y);
  const stable = e.kind === 'node-stable' || e.kind === 'focus-stable';
  return (
    <Group listening={false}>
      {e.kind === 'saddle' ? (
        <Group>
          <Line points={[x - 6, y - 6, x + 6, y + 6]} stroke={ink} strokeWidth={2.4} strokeScaleEnabled={false} listening={false} />
          <Line points={[x - 6, y + 6, x + 6, y - 6]} stroke={ink} strokeWidth={2.4} strokeScaleEnabled={false} listening={false} />
        </Group>
      ) : (
        <Circle x={x} y={y} radius={e.kind === 'center' ? 7 : 6} fill={stable ? ink : '#ffffff'} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      )}
    </Group>
  );
}

function PhaseShape({ o, ctx }: { o: BoardObject<PhaseProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const cs = useCompiled([p.P, p.Q]);
  const r: Range2 = { xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax };
  const data = useMemo(() => {
    if (!cs || 'error' in cs || badRange(r)) return null;
    const [P, Q] = cs as [Compiled, Compiled];
    const eq = equilibria({ P: P.f, Q: Q.f, Px: P.fx, Py: P.fy, Qx: Q.fx, Qy: Q.fy }, r);
    const tr = p.points.map((pt) => {
      const pts = trajectory(P.f, Q.f, pt.x, pt.y, r, p.tMax);
      return { pts, start: pts.findIndex(([x, y]) => x === pt.x && y === pt.y) };
    });
    return { eq, tr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, p.xMin, p.xMax, p.yMin, p.yMax, p.tMax, JSON.stringify(p.points)]);
  if (badRange(r)) return <Status state={{ error: 'пределы: «от» должно быть меньше «до»' }} ink={ink} />;
  if (!cs || 'error' in cs || !data) return <Status state={cs && 'error' in cs ? cs : null} ink={ink} />;
  const [P, Q] = cs as [Compiled, Compiled];
  const m = map2(r);
  const kx = PW / (r.xMax - r.xMin);
  const ky = PH / (r.yMax - r.yMin);
  const n = p.density;
  const L = (PW / n) * 0.34;
  return (
    <Group listening={false}>
      <PlaneFrame r={r} ink={ink} muted={muted} />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        {Array.from({ length: n * n }, (_, k) => {
          const x = r.xMin + (((k % n) + 0.5) / n) * (r.xMax - r.xMin);
          const y = r.yMin + ((Math.floor(k / n) + 0.5) / n) * (r.yMax - r.yMin);
          const dx = P.f(x, y) * kx;
          const dy = -Q.f(x, y) * ky;
          const l = Math.hypot(dx, dy);
          if (!(l > 1e-12)) return null;
          return <Arrow key={k} points={[m.X(x) - (dx / l) * L, m.Y(y) - (dy / l) * L, m.X(x) + (dx / l) * L, m.Y(y) + (dy / l) * L]} stroke={muted} fill={muted} opacity={0.7} strokeWidth={1} strokeScaleEnabled={false} pointerLength={4 / zoom} pointerWidth={3.5 / zoom} listening={false} />;
        })}
        {data.tr.map(({ pts, start }, i) => {
          // Стрелка направления движения — чуть дальше начальной точки по времени.
          const a = pts[Math.min(pts.length - 1, start + 25)];
          const b = pts[Math.min(pts.length - 1, start + 28)];
          return (
            <Group key={i}>
              <Line points={pathOf(pts, m)} stroke={COLORS[i]} strokeWidth={2.2} strokeScaleEnabled={false} listening={false} />
              {a && b && (a[0] !== b[0] || a[1] !== b[1]) && <Arrow points={[m.X(a[0]), m.Y(a[1]), m.X(b[0]), m.Y(b[1])]} stroke={COLORS[i]} fill={COLORS[i]} strokeWidth={2.2} strokeScaleEnabled={false} pointerLength={11 / zoom} pointerWidth={9 / zoom} listening={false} />}
            </Group>
          );
        })}
        {data.eq.map((e, i) => (
          <EqMark key={i} e={e} m={m} ink={ink} />
        ))}
      </Group>
      <Points points={p.points} m={m} ink={ink} />
      <Lines
        x={-40}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `Система x′ = ${p.P},  y′ = ${p.Q}`,
          ...(data.eq.length ? data.eq.slice(0, 3).map((e, i) => `${eqText(e)}${i === 2 && data.eq.length > 3 ? `  …и ещё ${data.eq.length - 3}` : ''}`) : ['Особых точек в области нет']),
          '✕ седло, ● устойчивая, ○ неустойчивая или центр (по собственным числам якобиана)',
        ]}
      />
    </Group>
  );
}

export const phaseModule: ObjectModule<PhaseProps, ReactNode> = {
  type: PHASE_TYPE,
  title: 'Фазовая плоскость',
  version: 1,
  propsSchema: phasePropsSchema,
  createProps: () => ({ P: 'y', Q: '-sin(x) - 0.2y', xMin: -7, xMax: 7, yMin: -4, yMax: 4, density: 16, tMax: 30, points: [{ x: -6, y: 3 }, { x: 2, y: 0 }] }),
  deserialize: (r) => r as unknown as BoardObject<PhaseProps>,
  ...boxed(() => ({ ...BOX, y: -122, height: PH + 142 })),
  hitPriority: 1,
  getHandles: (o) => pointHandles(o),
  dragHandle: (o, id, to) => dragPoints(o, id, to),
  render: (o, ctx) => <PhaseShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'P', label: 'x′ =', maxLength: 200 },
    { kind: 'text', key: 'Q', label: 'y′ =', maxLength: 200 },
    ...POINT_ACTIONS,
    { kind: 'number', key: 'tMax', label: 'Время траектории', min: 0.5, max: 100, step: 1 },
    { kind: 'number', key: 'density', label: 'Стрелок в ряду', min: 6, max: 30, step: 1, slider: true },
    ...RANGE_FIELDS,
  ],
  runAction: (o, key, ctx) => {
    const points = pointsAction(o, key);
    if (points) ctx.updateObject<PhaseProps>(o.id, { props: { points } });
  },
} as ObjectModule<PhaseProps, ReactNode>;

// =====================================================================
//  y″ + p·y′ + q·y = 0
// =====================================================================

export const secondPropsSchema = z.object({
  p: z.number().finite().min(-20).max(20),
  q: z.number().finite().min(-50).max(50),
  y0: z.number().finite().min(-1e3).max(1e3),
  v0: z.number().finite().min(-1e3).max(1e3),
  tMax: z.number().finite().min(0.5).max(100),
});
export type SecondProps = z.infer<typeof secondPropsSchema>;

function SecondShape({ o, ctx }: { o: BoardObject<SecondProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const s = second(p.p, p.q, p.y0, p.v0);
  const N = 400;
  const ys = Array.from({ length: N + 1 }, (_, k) => s.y((k / N) * p.tMax));
  const top = Math.max(1, ...ys.filter(Number.isFinite).map(Math.abs).filter((v) => v < 1e6));
  const Y = niceStep(top * 1.2) * Math.ceil((top * 1.2) / niceStep(top * 1.2));
  const r: Range2 = { xMin: 0, xMax: p.tMax, yMin: -Y, yMax: Y };
  const m = map2(r);
  const clamp = (v: number) => Math.max(-3 * Y, Math.min(3 * Y, v));
  const amp = Math.hypot(s.C1, s.C2);
  const env = s.kind === 'complex' && Math.abs(s.alpha) > 1e-9;
  // Слагаемое уравнения: «+ 4y», «− 0,5y′», нулевое — не пишется, единица — без множителя.
  const term = (v: number, sym: string) => (Math.abs(v) < 1e-12 ? '' : ` ${v < 0 ? '−' : '+'} ${Math.abs(v) === 1 && sym ? '' : num(Math.abs(v))}${sym}`);
  return (
    <Group listening={false}>
      <PlaneFrame r={r} ink={ink} muted={muted} xLabel="t" yLabel="y" />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        {env &&
          [1, -1].map((k) => (
            <Line key={k} points={Array.from({ length: 101 }, (_, i) => { const t = (i / 100) * p.tMax; return [m.X(t), m.Y(clamp(k * amp * Math.exp(s.alpha * t)))]; }).flat()} stroke={muted} strokeWidth={1} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
          ))}
        <Line points={ys.flatMap((v, k) => [m.X((k / N) * p.tMax), m.Y(clamp(v))])} stroke={COLORS[1]} strokeWidth={2.4} strokeScaleEnabled={false} listening={false} />
        <Arrow points={[m.X(0), m.Y(p.y0), m.X(0) + 40, m.Y(p.y0) - (40 * p.v0 * (PH / (2 * Y))) / (PW / p.tMax)]} stroke={COLORS[0]} fill={COLORS[0]} strokeWidth={1.6} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
      </Group>
      <Circle x={m.X(0)} y={m.Y(p.y0)} radius={5} fill="#ffffff" stroke={COLORS[0]} strokeWidth={2.2} strokeScaleEnabled={false} listening={false} />
      <Lines
        x={-40}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `y″${term(p.p, 'y′')}${term(p.q, 'y')} = 0,   y(0) = ${num(p.y0)},  y′(0) = ${num(p.v0)}`,
          `Характеристическое уравнение r²${term(p.p, 'r')}${term(p.q, '')} = 0:  D = ${num(s.D)},  ${s.kind === 'complex' ? `r = ${Math.abs(s.alpha) < 1e-12 ? '' : num(s.alpha) + ' '}± ${num(s.beta)}i` : s.kind === 'double' ? `r₁ = r₂ = ${num(s.r1)}` : `r₁ = ${num(s.r1)}, r₂ = ${num(s.r2)}`}`,
          `Общее решение: ${s.general}`,
          `C₁ = ${num(s.C1)},  C₂ = ${num(s.C2)} — из начальных условий`,
          `Поведение: ${s.behaviour}`,
        ]}
      />
    </Group>
  );
}

export const secondModule: ObjectModule<SecondProps, ReactNode> = {
  type: SECOND_TYPE,
  title: 'Уравнение y″ + py′ + qy = 0',
  version: 1,
  propsSchema: secondPropsSchema,
  createProps: () => ({ p: 0.5, q: 4, y0: 2, v0: 0, tMax: 12 }),
  deserialize: (r) => r as unknown as BoardObject<SecondProps>,
  ...boxed(() => ({ x: -50, y: -122, width: PW + 70, height: PH + 142 })),
  getHandles: () => [],
  render: (o, ctx) => <SecondShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'number', key: 'p', label: 'p', min: -20, max: 20, step: 0.1, slider: true },
    { kind: 'number', key: 'q', label: 'q', min: -50, max: 50, step: 0.5, slider: true },
    { kind: 'number', key: 'y0', label: 'y(0)', min: -1e3, max: 1e3, step: 0.5 },
    { kind: 'number', key: 'v0', label: 'y′(0)', min: -1e3, max: 1e3, step: 0.5 },
    { kind: 'number', key: 'tMax', label: 't до', min: 0.5, max: 100, step: 1 },
  ],
} as ObjectModule<SecondProps, ReactNode>;

export const diffeqModules = [slopeModule, phaseModule, secondModule];
