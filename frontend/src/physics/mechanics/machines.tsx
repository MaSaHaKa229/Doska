import type { ReactNode } from 'react';
import { Arc, Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { fmt } from '../common/quantities';
import { VecLabel } from '../common/vectors';
import { atwood, collision, incline, lever, spring, X1, X2 } from './dynamics';
import { numText } from './kinematics';
import { PLAY0, playAction, playSchema, usePlayTime } from './playback';
import { PLAY_FIELDS, PLUGIN_ID, placeGraphs, playText } from './objects';

export const INCLINE_TYPE = `${PLUGIN_ID}.incline`;
export const PULLEY_TYPE = `${PLUGIN_ID}.pulley`;
export const SPRING_TYPE = `${PLUGIN_ID}.spring`;
export const COLLISION_TYPE = `${PLUGIN_ID}.collision`;
export const LEVER_TYPE = `${PLUGIN_ID}.lever`;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const INFO = 15;
const FORCE = '#d13a3a';
const VEL = '#2563eb';
/** Кнопки без «Графиков» — для объектов, у которых графиков нет. */
const PLAY_ONLY = PLAY_FIELDS.filter((f) => f.key !== 'graphs');
const num = (key: string, label: string, min: number, max: number, step: number, slider = false) => ({ kind: 'number' as const, key, label, min, max, step, ...(slider ? { slider } : {}) });
const common = { scale: z.number().finite().min(1).max(1000), color: z.string().max(32), speed: z.number().finite().min(0.1).max(10), play: playSchema };

// =====================================================================
//  Общие части чертежей
// =====================================================================

/** Сила или скорость: стрелка с подписью у конца. */
function Vec({ x, y, dx, dy, label, color }: { x: number; y: number; dx: number; dy: number; label: string; color: string }) {
  const zoom = useZoom();
  const l = Math.hypot(dx, dy);
  if (l < 2) return null;
  return (
    <Group listening={false}>
      <Arrow points={[x, y, x + dx, y + dy]} stroke={color} fill={color} strokeWidth={2.4} strokeScaleEnabled={false} pointerLength={11 / zoom} pointerWidth={8 / zoom} listening={false} />
      <VecLabel x={x + dx + (dy / l) * 10 + (dx >= 0 ? 4 : -26)} y={y + dy + (dy >= 0 ? 0 : -22)} label={label} color={color} size={16} />
    </Group>
  );
}

/** Линия опоры со штриховкой с правой стороны направления a→b. */
function Hatch({ a, b, color }: { a: { x: number; y: number }; b: { x: number; y: number }; color: string }) {
  return (
    <Shape
      sceneFunc={(c, shape) => {
        const g = raw(c);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / l;
        const uy = (b.y - a.y) / l;
        // Нормаль вправо от направления (на доске y вниз) и штрихи под 45°.
        const nx = -uy;
        const ny = ux;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        for (let s = 0; s <= l; s += 10) {
          g.moveTo(a.x + ux * s, a.y + uy * s);
          g.lineTo(a.x + ux * (s - 8) + nx * 9, a.y + uy * (s - 8) + ny * 9);
        }
        c.strokeShape(shape);
      }}
      stroke={color}
      strokeWidth={1}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

function Info({ x, y, lines, color, muted }: { x: number; y: number; lines: string[]; color: string; muted: string }) {
  return (
    <Group listening={false}>
      {lines.map((l, i) => (
        <Text key={i} x={x} y={y + i * INFO * 1.35} text={l} fontSize={i ? INFO * 0.9 : INFO} fill={i ? muted : color} listening={false} />
      ))}
    </Group>
  );
}

/** Столбчатая диаграмма энергий: высота — доля от max. */
function Bars({ x, y, h, items, max, color }: { x: number; y: number; h: number; items: { label: string; value: number; fill: string }[]; max: number; color: string }) {
  return (
    <Group x={x} y={y} listening={false}>
      <Line points={[0, 0, 0, h, items.length * 44 + 6, h]} stroke={color} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      {items.map((it, i) => {
        const bh = max > 0 ? Math.max(0, (it.value / max) * (h - 16)) : 0;
        return (
          <Group key={it.label} x={8 + i * 44}>
            <KRect x={0} y={h - bh} width={30} height={bh} fill={it.fill} listening={false} />
            <Text x={-6} y={h + 4} width={42} align="center" text={it.label} fontSize={13} {...italic} fill={color} listening={false} />
            <Text x={-10} y={h - bh - 16} width={50} align="center" text={fmt(it.value, 1)} fontSize={11} fill={color} listening={false} />
          </Group>
        );
      })}
    </Group>
  );
}

const inBox = (b: Rect, q: { x: number; y: number }, tol: number) => q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;

/** Общая часть модуля: габарит, попадание, без ручек и рамки. */
function frame<P>(box: (p: P) => Rect) {
  return {
    serialize: (o: BoardObject<P>) => o as unknown as BoardObject<Record<string, never>>,
    getLocalBounds: (o: BoardObject<P>) => box(o.props),
    hitTest: (o: BoardObject<P>, point: { x: number; y: number }, tol: number) => inBox(box(o.props), toLocal(o, point), tol),
    getHandles: () => [],
    transform: { rotatable: false, resize: 'none' as const },
  };
}

// =====================================================================
//  Наклонная плоскость
// =====================================================================

export const inclinePropsSchema = z.object({ alpha: z.number().finite().min(5).max(80), m: z.number().finite().min(0.01).max(1e6), mu: z.number().finite().min(0).max(5), g: z.number().finite().min(0.1).max(1000), len: z.number().finite().min(0.5).max(1000), forces: z.boolean(), ...common });
export type InclineProps = z.infer<typeof inclinePropsSchema>;
type InclineObject = BoardObject<InclineProps>;

const BW = 56;
const BH = 34;

/** Вершины: верх T = (0, −H), прямой угол C = (0, 0), низ B = (W, 0). */
function inclineGeom(p: InclineProps) {
  const al = (p.alpha * Math.PI) / 180;
  const W = p.len * Math.cos(al) * p.scale;
  const H = p.len * Math.sin(al) * p.scale;
  return { al, W, H, u: { x: Math.cos(al), y: Math.sin(al) }, n: { x: Math.sin(al), y: -Math.cos(al) } };
}
const inclineBox = (p: InclineProps): Rect => {
  const { W, H } = inclineGeom(p);
  return { x: -20, y: -H - 90, width: W + 60, height: H + 110 };
};

function InclineShape({ o, ctx }: { o: InclineObject; ctx: RenderContext }) {
  const p = o.props;
  const info = incline(p);
  const t = usePlayTime(p.play, info.tEnd, p.speed);
  const { W, H, u, n } = inclineGeom(p);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const c = ctx.resolveColor(p.color);
  const d = (p.len * 0.08 + info.s(t)) * p.scale;
  const cx = u.x * (d + BW / 2) + n.x * (BH / 2);
  const cy = -H + u.y * (d + BW / 2) + n.y * (BH / 2);
  const k = 70 / (p.m * p.g);
  const v = info.v(t);
  return (
    <Group listening={false}>
      <Line points={[0, -H, W, 0, 0, 0]} closed stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Hatch a={{ x: -10, y: 0 }} b={{ x: W + 20, y: 0 }} color={ink} />
      <Arc x={W} y={0} innerRadius={0} outerRadius={34} angle={p.alpha} rotation={180} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text x={W - 58} y={-20} text="α" fontSize={16} {...italic} fill={ink} listening={false} />
      <KRect x={cx} y={cy} offsetX={BW / 2} offsetY={BH / 2} width={BW} height={BH} rotation={p.alpha} fill={c} opacity={0.85} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text x={cx - 10} y={cy - 8} text="m" fontSize={15} {...italic} fill="#ffffff" listening={false} />
      {p.forces && (
        <>
          <Vec x={cx} y={cy} dx={0} dy={p.m * p.g * k} label="mg" color={FORCE} />
          <Vec x={cx} y={cy} dx={n.x * info.N * k} dy={n.y * info.N * k} label="N" color={FORCE} />
          <Vec x={cx} y={cy} dx={-u.x * info.Ffr * k} dy={-u.y * info.Ffr * k} label="F_тр" color={FORCE} />
          {v > 0.01 && <Vec x={cx + n.x * 30} y={cy + n.y * 30} dx={u.x * v * 0.5 * p.scale} dy={u.y * v * 0.5 * p.scale} label="v" color={VEL} />}
        </>
      )}
      <Info
        x={-10}
        y={-H - 84}
        color={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} t = ${fmt(t)} с   v = ${fmt(v)} м/с`,
          `α = ${fmt(p.alpha)}°, μ = ${fmt(p.mu)}, m = ${fmt(p.m)} кг:  N = ${fmt(info.N)} Н,  Fтр = ${fmt(info.Ffr)} Н`,
          info.slides ? `a = g(sin α − μ cos α) = ${fmt(info.a)} м/с²` : `tg α ≤ μ — брусок покоится (трение покоя ${fmt(info.Ffr)} Н)`,
        ]}
      />
    </Group>
  );
}

export const inclineModule: ObjectModule<InclineProps, ReactNode> = {
  type: INCLINE_TYPE,
  title: 'Наклонная плоскость',
  version: 1,
  propsSchema: inclinePropsSchema,
  createProps: () => ({ alpha: 30, m: 2, mu: 0.2, g: 9.8, len: 4, forces: true, scale: 60, color: 'accent-2', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as InclineObject,
  ...frame(inclineBox),
  render: (o, ctx) => <InclineShape o={o} ctx={ctx} />,
  inspector: [...PLAY_FIELDS, num('alpha', 'α, °', 5, 80, 1, true), num('m', 'm, кг', 0.01, 1e6, 0.5), num('mu', 'μ', 0, 5, 0.05, true), num('len', 'Длина, м', 0.5, 1000, 0.5), { kind: 'toggle', key: 'forces', label: 'Силы' }, { kind: 'color', key: 'color', label: 'Цвет' }],
  runAction: (o, key, ctx) => {
    const p = o.props;
    const info = incline(p);
    if (key === 'graphs') {
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(Math.max(0.1, info.tEnd)) };
      placeGraphs(o, inclineBox(p), [{ ...base, ySym: 's', yUnit: 'м', expr: `${numText(info.a / 2)}t²` }, { ...base, ySym: 'v', yUnit: 'м/с', expr: `${numText(info.a)}t` }], ctx);
      return;
    }
    const play = playAction(key, p.play, info.tEnd, p.speed, ctx.now);
    if (play) ctx.updateObject<InclineProps>(o.id, { props: { play } });
  },
} as ObjectModule<InclineProps, ReactNode>;

// =====================================================================
//  Блок с двумя грузами
// =====================================================================

export const pulleyPropsSchema = z.object({ m1: z.number().finite().min(0.01).max(1e6), m2: z.number().finite().min(0.01).max(1e6), g: z.number().finite().min(0.1).max(1000), forces: z.boolean(), ...common });
export type PulleyProps = z.infer<typeof pulleyPropsSchema>;
type PulleyObject = BoardObject<PulleyProps>;

const R = 24;
const L0 = 2;
const side = (m: number) => 26 + 10 * Math.cbrt(m);
const pulleyBox = (p: PulleyProps): Rect => ({ x: -R - 140, y: -R - 110, width: 2 * R + 280, height: R + 110 + (L0 + 1.2) * p.scale + 120 });

function PulleyShape({ o, ctx }: { o: PulleyObject; ctx: RenderContext }) {
  const p = o.props;
  const info = atwood(p.m1, p.m2, p.g);
  const t = usePlayTime(p.play, info.tEnd, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const c = ctx.resolveColor(p.color);
  const s = info.s(t);
  const y1 = (L0 - s) * p.scale;
  const y2 = (L0 + s) * p.scale;
  const s1 = side(p.m1);
  const s2 = side(p.m2);
  const k = 55 / (Math.max(p.m1, p.m2) * p.g);
  const box = (x: number, y: number, sz: number, label: string) => (
    <Group>
      <KRect x={x - sz / 2} y={y} width={sz} height={sz} fill={c} opacity={0.85} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text x={x - sz / 2} y={y + sz / 2 - 8} width={sz} align="center" text={label} fontSize={15} {...italic} fill="#ffffff" listening={false} />
    </Group>
  );
  return (
    <Group listening={false}>
      <Hatch a={{ x: 50, y: -R - 34 }} b={{ x: -50, y: -R - 34 }} color={ink} />
      <Line points={[0, -R - 34, 0, 0]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Circle radius={R} stroke={ink} strokeWidth={2} fill={ctx.resolveColor('muted')} opacity={0.25} strokeScaleEnabled={false} listening={false} />
      <Circle radius={3} fill={ink} listening={false} />
      <Line points={[-R, 0, -R, y1]} stroke={ink} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />
      <Line points={[R, 0, R, y2]} stroke={ink} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />
      {box(-R, y1, s1, 'm₁')}
      {box(R, y2, s2, 'm₂')}
      {p.forces && (
        <>
          <Vec x={-R} y={y1} dx={0} dy={-info.T * k} label="T" color={FORCE} />
          <Vec x={R} y={y2} dx={0} dy={-info.T * k} label="T" color={FORCE} />
          <Vec x={-R} y={y1 + s1} dx={0} dy={p.m1 * p.g * k} label="m_1g" color={FORCE} />
          <Vec x={R} y={y2 + s2} dx={0} dy={p.m2 * p.g * k} label="m_2g" color={FORCE} />
        </>
      )}
      <Info
        x={-R - 130}
        y={-R - 104}
        color={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} t = ${fmt(t)} с   v = ${fmt(Math.abs(info.a) * Math.min(t, info.tEnd))} м/с`,
          `m₁ = ${fmt(p.m1)} кг, m₂ = ${fmt(p.m2)} кг:  a = (m₂ − m₁)g/(m₁ + m₂) = ${fmt(Math.abs(info.a))} м/с²`,
          `T = 2m₁m₂g/(m₁ + m₂) = ${fmt(info.T)} Н${info.a === 0 ? ' — равновесие' : ''}`,
        ]}
      />
    </Group>
  );
}

export const pulleyModule: ObjectModule<PulleyProps, ReactNode> = {
  type: PULLEY_TYPE,
  title: 'Блок с грузами',
  version: 1,
  propsSchema: pulleyPropsSchema,
  createProps: () => ({ m1: 1, m2: 1.5, g: 9.8, forces: true, scale: 60, color: 'accent-5', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as PulleyObject,
  ...frame(pulleyBox),
  render: (o, ctx) => <PulleyShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('m1', 'm₁, кг', 0.01, 1e6, 0.5), num('m2', 'm₂, кг', 0.01, 1e6, 0.5), { kind: 'toggle', key: 'forces', label: 'Силы' }, { kind: 'color', key: 'color', label: 'Цвет' }],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, atwood(o.props.m1, o.props.m2, o.props.g).tEnd, o.props.speed, ctx.now);
    if (play) ctx.updateObject<PulleyProps>(o.id, { props: { play } });
  },
} as ObjectModule<PulleyProps, ReactNode>;

// =====================================================================
//  Пружинный маятник
// =====================================================================

export const springPropsSchema = z.object({ k: z.number().finite().min(0.01).max(1e7), m: z.number().finite().min(0.001).max(1e6), A: z.number().finite().min(0.01).max(100), energy: z.boolean(), forces: z.boolean(), ...common });
export type SpringProps = z.infer<typeof springPropsSchema>;
type SpringObject = BoardObject<SpringProps>;

/** Длина недеформированной пружины, м. */
const SL = 1.2;
const springBox = (p: SpringProps): Rect => ({ x: -20, y: -110, width: (SL + p.A) * p.scale + (p.energy ? 240 : 90), height: 190 });

function SpringShape({ o, ctx }: { o: SpringObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const info = spring(p.k, p.m, p.A);
  const t = usePlayTime(p.play, info.tEnd, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const c = ctx.resolveColor(p.color);
  const x = info.x(t);
  const v = info.v(t);
  const left = (SL + x) * p.scale;
  const coils = 12;
  const zig: number[] = [0, 0];
  for (let i = 1; i < coils * 2; i++) zig.push((left * i) / (coils * 2), i % 2 ? -10 : 10);
  zig.push(left, 0);
  const e = info.energy(t);
  const kf = 60 / (p.k * p.A);
  return (
    <Group listening={false}>
      <Hatch a={{ x: 0, y: 30 }} b={{ x: 0, y: -40 }} color={ink} />
      <Hatch a={{ x: 0, y: 22 }} b={{ x: (SL + p.A) * p.scale + 70, y: 22 }} color={ink} />
      <Line points={zig} stroke={ink} strokeWidth={1.6} strokeScaleEnabled={false} lineJoin="round" listening={false} />
      <Line points={[SL * p.scale, -50, SL * p.scale, 30]} stroke={muted} strokeWidth={1} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Text x={SL * p.scale - 16} y={-66} text="x = 0" fontSize={13} {...italic} fill={muted} listening={false} />
      <KRect x={left} y={-20} width={44} height={40} fill={c} opacity={0.85} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text x={left + 14} y={-8} text="m" fontSize={15} {...italic} fill="#ffffff" listening={false} />
      {p.forces && <Vec x={left + 22} y={-30} dx={-p.k * x * kf} dy={0} label="F_упр" color={FORCE} />}
      {p.forces && <Vec x={left + 22} y={34} dx={v * 0.3 * p.scale} dy={0} label="v" color={VEL} />}
      {p.energy && (
        <Bars
          x={(SL + p.A) * p.scale + 90}
          y={-70}
          h={90}
          max={e.e}
          color={ink}
          items={[
            { label: 'Eк', value: e.ek, fill: VEL },
            { label: 'Eп', value: e.ep, fill: '#16a34a' },
            { label: 'E', value: e.e, fill: muted },
          ]}
        />
      )}
      <Info
        x={-10}
        y={-104}
        color={ink}
        muted={muted}
        lines={[`${playText(p.play)} t = ${fmt(t)} с   x = ${fmt(x)} м   v = ${fmt(v)} м/с   F = −kx = ${fmt(-p.k * x)} Н`, `k = ${fmt(p.k)} Н/м, m = ${fmt(p.m)} кг, A = ${fmt(p.A)} м:  T = 2π√(m/k) = ${fmt(info.period)} с`]}
      />
    </Group>
  );
}

export const springModule: ObjectModule<SpringProps, ReactNode> = {
  type: SPRING_TYPE,
  title: 'Пружинный маятник',
  version: 1,
  propsSchema: springPropsSchema,
  createProps: () => ({ k: 40, m: 1, A: 0.5, energy: true, forces: true, scale: 150, color: 'accent-3', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as SpringObject,
  ...frame(springBox),
  render: (o, ctx) => <SpringShape o={o} ctx={ctx} />,
  inspector: [...PLAY_FIELDS, num('k', 'k, Н/м', 0.01, 1e7, 5), num('m', 'm, кг', 0.001, 1e6, 0.1), num('A', 'A, м', 0.01, 100, 0.05), { kind: 'toggle', key: 'energy', label: 'Энергия' }, { kind: 'toggle', key: 'forces', label: 'Сила и скорость' }, { kind: 'color', key: 'color', label: 'Цвет' }],
  runAction: (o, key, ctx) => {
    const p = o.props;
    const info = spring(p.k, p.m, p.A);
    if (key === 'graphs') {
      const w = numText(info.omega);
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(info.tEnd) };
      placeGraphs(o, springBox(p), [{ ...base, ySym: 'x', yUnit: 'м', expr: `${numText(p.A)}cos(${w}t)` }, { ...base, ySym: 'v', yUnit: 'м/с', expr: `−${numText(p.A * info.omega)}sin(${w}t)` }], ctx);
      return;
    }
    const play = playAction(key, p.play, info.tEnd, p.speed, ctx.now);
    if (play) ctx.updateObject<SpringProps>(o.id, { props: { play } });
  },
} as ObjectModule<SpringProps, ReactNode>;

// =====================================================================
//  Столкновение шаров
// =====================================================================

export const collisionPropsSchema = z.object({ m1: z.number().finite().min(0.01).max(1e6), v1: z.number().finite().min(-1000).max(1000), m2: z.number().finite().min(0.01).max(1e6), v2: z.number().finite().min(-1000).max(1000), elastic: z.boolean(), ...common });
export type CollisionProps = z.infer<typeof collisionPropsSchema>;
type CollisionObject = BoardObject<CollisionProps>;

function collisionRange(p: CollisionProps) {
  const c = collision(p);
  let lo = X1 - c.r1;
  let hi = X2 + c.r2;
  for (let i = 0; i <= 40; i++) {
    const t = (c.tEnd * i) / 40;
    lo = Math.min(lo, c.x1(t) - c.r1, c.x2(t) - c.r2);
    hi = Math.max(hi, c.x1(t) + c.r1, c.x2(t) + c.r2);
  }
  return { c, lo, hi };
}
const collisionBox = (p: CollisionProps): Rect => {
  const { lo, hi } = collisionRange(p);
  return { x: lo * p.scale - 20, y: -130, width: (hi - lo) * p.scale + 40, height: 160 };
};

function CollisionShape({ o, ctx }: { o: CollisionObject; ctx: RenderContext }) {
  const p = o.props;
  const { c, lo, hi } = collisionRange(p);
  const t = usePlayTime(p.play, c.tEnd, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const col = ctx.resolveColor(p.color);
  const after = c.tc !== null && t > c.tc;
  const ball = (x: number, r: number, v: number, label: string, i: number) => (
    <Group key={i}>
      <Circle x={x * p.scale} y={-r * p.scale} radius={r * p.scale} fill={i ? ctx.resolveColor('accent-4') : col} opacity={0.85} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text x={x * p.scale - 14} y={-r * p.scale - 8} width={28} align="center" text={label} fontSize={14} {...italic} fill="#ffffff" listening={false} />
      <Vec x={x * p.scale} y={-2 * r * p.scale - 12} dx={v * 0.4 * p.scale} dy={0} label={i ? 'v_2' : 'v_1'} color={VEL} />
    </Group>
  );
  const lost = c.ek - c.ekAfter;
  return (
    <Group listening={false}>
      <Hatch a={{ x: lo * p.scale - 10, y: 0 }} b={{ x: hi * p.scale + 10, y: 0 }} color={ink} />
      {ball(c.x1(t), c.r1, after ? c.u1 : p.v1, 'm₁', 0)}
      {ball(c.x2(t), c.r2, after ? c.u2 : p.v2, 'm₂', 1)}
      <Info
        x={lo * p.scale - 10}
        y={-124}
        color={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} t = ${fmt(t)} с   ${p.elastic ? 'упругий удар' : 'неупругий удар (шары слипаются)'}${c.tc === null ? ' — шары не сближаются' : ''}`,
          `до: p = m₁v₁ + m₂v₂ = ${fmt(c.p)} кг·м/с,  Eк = ${fmt(c.ek)} Дж`,
          `после: v₁′ = ${fmt(c.u1)}, v₂′ = ${fmt(c.u2)} м/с,  p′ = ${fmt(c.pAfter)} кг·м/с,  Eк′ = ${fmt(c.ekAfter)} Дж${lost > 1e-9 ? ` (в тепло ${fmt(lost)} Дж)` : ''}`,
        ]}
      />
    </Group>
  );
}

export const collisionModule: ObjectModule<CollisionProps, ReactNode> = {
  type: COLLISION_TYPE,
  title: 'Столкновение шаров',
  version: 1,
  propsSchema: collisionPropsSchema,
  createProps: () => ({ m1: 2, v1: 3, m2: 1, v2: -1, elastic: true, scale: 60, color: 'accent-2', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as CollisionObject,
  ...frame(collisionBox),
  render: (o, ctx) => <CollisionShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('m1', 'm₁, кг', 0.01, 1e6, 0.5), num('v1', 'v₁, м/с', -1000, 1000, 0.5), num('m2', 'm₂, кг', 0.01, 1e6, 0.5), num('v2', 'v₂, м/с', -1000, 1000, 0.5), { kind: 'toggle', key: 'elastic', label: 'Упругий' }, { kind: 'color', key: 'color', label: 'Цвет' }],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, collision(o.props).tEnd, o.props.speed, ctx.now);
    if (play) ctx.updateObject<CollisionProps>(o.id, { props: { play } });
  },
} as ObjectModule<CollisionProps, ReactNode>;

// =====================================================================
//  Рычаг
// =====================================================================

export const leverPropsSchema = z.object({ m1: z.number().finite().min(0).max(1e6), l1: z.number().finite().min(0.05).max(100), m2: z.number().finite().min(0).max(1e6), l2: z.number().finite().min(0.05).max(100), g: z.number().finite().min(0.1).max(1000), scale: z.number().finite().min(1).max(1000), color: z.string().max(32) });
export type LeverProps = z.infer<typeof leverPropsSchema>;
type LeverObject = BoardObject<LeverProps>;

const TILT = 8;
const leverBox = (p: LeverProps): Rect => ({ x: -p.l1 * p.scale - 50, y: -110, width: (p.l1 + p.l2) * p.scale + 100, height: 230 });

function LeverShape({ o, ctx }: { o: LeverObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const info = lever(p.m1, p.l1, p.m2, p.l2, p.g);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const c = ctx.resolveColor(p.color);
  // Неуравновешенный рычаг наклонён к перевешивающему плечу.
  const tilt = (info.side * TILT * Math.PI) / 180;
  const end = (l: number) => ({ x: l * p.scale * Math.cos(tilt), y: l * p.scale * Math.sin(tilt) });
  const a = end(-p.l1);
  const b = end(p.l2);
  const kf = 60 / Math.max(p.m1 * p.g, p.m2 * p.g, 1e-9);
  const load = (q: { x: number; y: number }, m: number, label: string) => {
    const sz = 22 + 8 * Math.cbrt(m);
    return m > 0 ? (
      <Group>
        <Line points={[q.x, q.y, q.x, q.y + 30]} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
        <KRect x={q.x - sz / 2} y={q.y + 30} width={sz} height={sz} fill={c} opacity={0.85} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        <Text x={q.x - sz / 2} y={q.y + 30 + sz / 2 - 8} width={sz} align="center" text={label} fontSize={14} {...italic} fill="#ffffff" listening={false} />
      </Group>
    ) : null;
  };
  const dash = [4 / zoom, 4 / zoom];
  return (
    <Group listening={false}>
      <Line points={[0, 0, -16, 30, 16, 30]} closed fill={muted} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Hatch a={{ x: -40, y: 30 }} b={{ x: 40, y: 30 }} color={ink} />
      <Line points={[a.x, a.y, b.x, b.y]} stroke={ink} strokeWidth={5} lineCap="round" strokeScaleEnabled={false} listening={false} />
      <Circle radius={3.5} fill="#ffffff" stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {load(a, p.m1, 'm₁')}
      {load(b, p.m2, 'm₂')}
      <Vec x={a.x - 14} y={a.y} dx={0} dy={p.m1 * p.g * kf} label="F_1" color={FORCE} />
      <Vec x={b.x + 14} y={b.y} dx={0} dy={p.m2 * p.g * kf} label="F_2" color={FORCE} />
      <Line points={[a.x, -26, 0, -26]} stroke={muted} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />
      <Line points={[0, -26, b.x, -26]} stroke={muted} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />
      <Text x={a.x / 2 - 30} y={-46} width={60} align="center" text={`l₁ = ${fmt(p.l1)} м`} fontSize={13} fill={muted} listening={false} />
      <Text x={b.x / 2 - 30} y={-46} width={60} align="center" text={`l₂ = ${fmt(p.l2)} м`} fontSize={13} fill={muted} listening={false} />
      <Info
        x={-p.l1 * p.scale - 40}
        y={-104}
        color={ink}
        muted={muted}
        lines={[
          info.side === 0 ? 'M₁ = M₂ — рычаг в равновесии' : `перевешивает ${info.side < 0 ? 'левое' : 'правое'} плечо`,
          `M₁ = m₁g·l₁ = ${fmt(info.M1)} Н·м,   M₂ = m₂g·l₂ = ${fmt(info.M2)} Н·м`,
        ]}
      />
    </Group>
  );
}

export const leverModule: ObjectModule<LeverProps, ReactNode> = {
  type: LEVER_TYPE,
  title: 'Рычаг',
  version: 1,
  propsSchema: leverPropsSchema,
  createProps: () => ({ m1: 2, l1: 1.5, m2: 3, l2: 1, g: 9.8, scale: 80, color: 'accent-5' }),
  deserialize: (r) => r as unknown as LeverObject,
  ...frame(leverBox),
  // Плечи меняются ручками на концах рычага (шаг 0,05 м).
  // Ручки — на концах (с учётом наклона); шаг 0,05 м задаёт сама ручка, сетка не привязывает.
  getHandles: (o) => {
    const p = o.props;
    const tilt = (lever(p.m1, p.l1, p.m2, p.l2, p.g).side * TILT * Math.PI) / 180;
    const end = (l: number) => toWorld(o, { x: l * p.scale * Math.cos(tilt), y: l * p.scale * Math.sin(tilt) });
    return [
      { id: 'l1', kind: 'param', position: end(-p.l1), label: 'Плечо l₁', snap: false },
      { id: 'l2', kind: 'param', position: end(p.l2), label: 'Плечо l₂', snap: false },
    ];
  },
  dragHandle: (o, id, to) => {
    const q = toLocal(o, to);
    const l = Math.max(0.05, Math.min(100, Math.round((Math.abs(q.x) / o.props.scale) * 20) / 20));
    return id === 'l1' ? { props: { l1: l } } : id === 'l2' ? { props: { l2: l } } : null;
  },
  render: (o, ctx) => <LeverShape o={o} ctx={ctx} />,
  inspector: [num('m1', 'm₁, кг', 0, 1e6, 0.5), num('l1', 'l₁, м', 0.05, 100, 0.05), num('m2', 'm₂, кг', 0, 1e6, 0.5), num('l2', 'l₂, м', 0.05, 100, 0.05), { kind: 'color', key: 'color', label: 'Цвет' }],
} as ObjectModule<LeverProps, ReactNode>;

export const dynamicsModules = [inclineModule, pulleyModule, springModule, collisionModule, leverModule];
