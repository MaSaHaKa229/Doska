import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { useBoard } from '../../store/board';
import { fmt } from '../common/quantities';
import { VecLabel } from '../common/vectors';
import { withPrefix } from '../electricity/field';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { PLAY_FIELDS, placeGraphs, playText } from '../mechanics/objects';
import { numText } from '../mechanics/kinematics';
import { beats, lc, oscillator, pendulum } from './osc';

export const PLUGIN_ID = 'physics.waves';
export const PENDULUM_TYPE = `${PLUGIN_ID}.pendulum`;
export const OSC_TYPE = `${PLUGIN_ID}.oscillator`;
export const BEATS_TYPE = `${PLUGIN_ID}.beats`;
export const LC_TYPE = `${PLUGIN_ID}.lc`;

export const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const INFO = 14;
const FORCE = '#d13a3a';
const VEL = '#2563eb';
const C1 = '#2563eb';
const C2 = '#16a34a';
const C3 = '#d13a3a';
export const PLAY_ONLY = PLAY_FIELDS.filter((f) => f.key !== 'graphs');
export const num = (key: string, label: string, min: number, max: number, step: number, slider = false) => ({ kind: 'number' as const, key, label, min, max, step, ...(slider ? { slider } : {}) });

// =====================================================================
//  Общие части
// =====================================================================

export function Info({ x, y, lines, ink, muted }: { x: number; y: number; lines: string[]; ink: string; muted: string }) {
  return (
    <Group listening={false}>
      {lines.map((l, i) => (
        <Text key={i} x={x} y={y + i * INFO * 1.35} text={l} fontSize={i ? INFO * 0.92 : INFO} fill={i ? muted : ink} listening={false} />
      ))}
    </Group>
  );
}

function Vec({ x, y, dx, dy, label, color }: { x: number; y: number; dx: number; dy: number; label: string; color: string }) {
  const zoom = useZoom();
  if (Math.hypot(dx, dy) < 2) return null;
  return (
    <Group listening={false}>
      <Arrow points={[x, y, x + dx, y + dy]} stroke={color} fill={color} strokeWidth={2.2} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />
      <VecLabel x={x + dx + (dx >= 0 ? 4 : -26)} y={y + dy + (dy >= 0 ? 0 : -22)} label={label} color={color} size={15} />
    </Group>
  );
}

interface Curve {
  f: (x: number) => number;
  color: string;
  dash?: boolean;
}

/** Небольшой график: оси, кривые на [x0, x1], пределы по y ±yMax (или 0…yMax), курсор. */
export function MiniPlot({ x, y, w, h, x0, x1, yMax, curves, cursor, xLabel, yLabel, positive, ink }: { x: number; y: number; w: number; h: number; x0: number; x1: number; yMax: number; curves: Curve[]; cursor?: number; xLabel: string; yLabel: string; positive?: boolean; ink: string }) {
  const zoom = useZoom();
  const Y = (v: number) => (positive ? h - (v / yMax) * (h - 6) : h / 2 - (v / yMax) * (h / 2 - 4));
  const X = (v: number) => ((v - x0) / (x1 - x0)) * w;
  const axisY = positive ? h : h / 2;
  return (
    <Group x={x} y={y} listening={false}>
      <Arrow points={[0, axisY, w + 12, axisY]} stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={5 / zoom} listening={false} />
      <Arrow points={[0, h, 0, -8]} stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={5 / zoom} listening={false} />
      <Text x={w + 4} y={axisY + 4} text={xLabel} fontSize={12} {...italic} fill={ink} listening={false} />
      <Text x={6} y={-12} text={yLabel} fontSize={12} {...italic} fill={ink} listening={false} />
      {curves.map((c, i) => (
        <Shape
          key={i}
          sceneFunc={(cx, shape) => {
            const g = raw(cx);
            g.beginPath();
            for (let k = 0; k <= 300; k++) {
              const t = x0 + ((x1 - x0) * k) / 300;
              const v = Math.max(-yMax * 1.05, Math.min(yMax * 1.05, c.f(t)));
              if (k) g.lineTo(X(t), Y(v));
              else g.moveTo(X(t), Y(v));
            }
            cx.strokeShape(shape);
          }}
          stroke={c.color}
          strokeWidth={c.dash ? 1 : 1.8}
          dash={c.dash ? [5 / zoom, 4 / zoom] : undefined}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {cursor !== undefined && cursor >= x0 && cursor <= x1 && <Line points={[X(cursor), 0, X(cursor), h]} stroke={ink} opacity={0.5} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
    </Group>
  );
}

/** Столбики энергий. */
function Bars({ x, y, h, items, max, ink }: { x: number; y: number; h: number; items: { label: string; value: number; fill: string }[]; max: number; ink: string }) {
  return (
    <Group x={x} y={y} listening={false}>
      <Line points={[0, 0, 0, h, items.length * 46 + 6, h]} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      {items.map((it, i) => {
        const bh = max > 0 ? Math.max(0, (it.value / max) * (h - 16)) : 0;
        return (
          <Group key={it.label} x={8 + i * 46}>
            <KRect y={h - bh} width={32} height={bh} fill={it.fill} listening={false} />
            <Text x={-6} y={h + 4} width={44} align="center" text={it.label} fontSize={13} {...italic} fill={ink} listening={false} />
          </Group>
        );
      })}
    </Group>
  );
}

/** Модуль с прямоугольной областью: габарит и попадание. */
export function boxed<P>(box: (p: P) => Rect) {
  return {
    serialize: (o: BoardObject<P>) => o as unknown as BoardObject<Record<string, never>>,
    getLocalBounds: (o: BoardObject<P>) => box(o.props),
    hitTest: (o: BoardObject<P>, point: { x: number; y: number }, tol: number) => {
      const b = box(o.props);
      const q = toLocal(o, point);
      return q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;
    },
    getHandles: () => [],
    transform: { rotatable: false, resize: 'none' as const },
  };
}

/** Показ: быстрые колебания (период меньше секунды) замедляются до 4 с на период. */
const shownPeriod = (T: number) => (T < 1 ? 4 : T);

// =====================================================================
//  Математический маятник
// =====================================================================

export const pendulumPropsSchema = z.object({ l: z.number().finite().min(0.01).max(1000), g: z.number().finite().min(0.1).max(1000), A: z.number().finite().min(1).max(30), m: z.number().finite().min(0.001).max(1e6), forces: z.boolean(), scale: z.number().finite().min(1).max(1000), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type PendulumProps = z.infer<typeof pendulumPropsSchema>;

const pendTEnd = (p: PendulumProps) => pendulum(p.l, p.g, p.A, p.m).T * 4;
const pendBox = (p: PendulumProps): Rect => {
  const L = p.l * p.scale;
  const half = L * Math.sin((p.A * Math.PI) / 180) + 80;
  return { x: -Math.max(half, 230), y: -80, width: 2 * Math.max(half, 230), height: L + 130 };
};

function PendulumShape({ o, ctx }: { o: BoardObject<PendulumProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const pd = pendulum(p.l, p.g, p.A, p.m);
  const t = usePlayTime(p.play, pendTEnd(p), p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const L = p.l * p.scale;
  const th = pd.theta(t);
  const bx = L * Math.sin(th);
  const by = L * Math.cos(th);
  const v = pd.dtheta(t) * p.l;
  const k = 55 / (p.m * p.g);
  const a = (p.A * Math.PI) / 180;
  return (
    <Group listening={false}>
      <Shape
        sceneFunc={(c, shape) => {
          const g = raw(c);
          g.beginPath();
          g.moveTo(-50, 0);
          g.lineTo(50, 0);
          for (let x = -50; x <= 50; x += 10) {
            g.moveTo(x, 0);
            g.lineTo(x + 8, -9);
          }
          c.strokeShape(shape);
        }}
        stroke={ink}
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Line points={[0, 0, 0, L + 20]} stroke={muted} strokeWidth={1} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Shape
        sceneFunc={(c, shape) => {
          const g = raw(c);
          g.beginPath();
          g.arc(0, 0, L, Math.PI / 2 - a, Math.PI / 2 + a);
          c.strokeShape(shape);
        }}
        stroke={muted}
        strokeWidth={1}
        dash={[2 / zoom, 4 / zoom]}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Line points={[0, 0, bx, by]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Circle x={bx} y={by} radius={14} fill={ctx.resolveColor('accent-4')} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      {p.forces && <Vec x={bx} y={by} dx={0} dy={p.m * p.g * k} label="mg" color={FORCE} />}
      {p.forces && <Vec x={bx} y={by} dx={(-bx / L) * pd.tension(t) * k} dy={(-by / L) * pd.tension(t) * k} label="T" color={FORCE} />}
      {p.forces && <Vec x={bx} y={by} dx={Math.cos(th) * v * 0.4 * p.scale} dy={-Math.sin(th) * v * 0.4 * p.scale} label="v" color={VEL} />}
      <Info
        x={pendBox(p).x}
        y={-76}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} t = ${fmt(t)} с   φ = ${fmt((th * 180) / Math.PI, 1)}°   x = ${fmt(p.l * Math.sin(th))} м   v = ${fmt(v)} м/с`,
          `l = ${fmt(p.l)} м, g = ${fmt(p.g)} м/с²:  T = 2π√(l/g) = ${fmt(pd.T)} с,  ν = ${fmt(1 / pd.T)} Гц`,
        ]}
      />
    </Group>
  );
}

export const pendulumModule: ObjectModule<PendulumProps, ReactNode> = {
  type: PENDULUM_TYPE,
  title: 'Математический маятник',
  version: 1,
  propsSchema: pendulumPropsSchema,
  createProps: () => ({ l: 1, g: 9.8, A: 15, m: 0.5, forces: true, scale: 220, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<PendulumProps>,
  ...boxed(pendBox),
  render: (o, ctx) => <PendulumShape o={o} ctx={ctx} />,
  inspector: [...PLAY_FIELDS, num('l', 'l, м', 0.01, 1000, 0.1), num('A', 'Размах, °', 1, 30, 1, true), num('g', 'g, м/с²', 0.1, 1000, 0.1), { kind: 'toggle', key: 'forces', label: 'Силы' }],
  runAction: (o, key, ctx) => {
    const p = o.props;
    const pd = pendulum(p.l, p.g, p.A, p.m);
    if (key === 'graphs') {
      const xa = p.l * Math.sin((p.A * Math.PI) / 180);
      const w = numText(pd.omega);
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(Math.round(pd.T * 3 * 1000) / 1000) };
      placeGraphs(o, pendBox(p), [{ ...base, ySym: 'x', yUnit: 'м', expr: `${numText(xa)}cos(${w}t)` }, { ...base, ySym: 'v', yUnit: 'м/с', expr: `−${numText(xa * pd.omega)}sin(${w}t)` }], ctx);
      return;
    }
    const play = playAction(key, p.play, pendTEnd(p), p.speed, ctx.now);
    if (play) ctx.updateObject<PendulumProps>(o.id, { props: { play } });
  },
} as ObjectModule<PendulumProps, ReactNode>;

// =====================================================================
//  Затухающие и вынужденные колебания
// =====================================================================

export const oscPropsSchema = z.object({ k: z.number().finite().min(0.01).max(1e7), m: z.number().finite().min(0.001).max(1e6), b: z.number().finite().min(0).max(1e6), A0: z.number().finite().min(0.001).max(100), forced: z.boolean(), F0: z.number().finite().min(0).max(1e6), ratio: z.number().finite().min(0.05).max(3), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type OscProps = z.infer<typeof oscPropsSchema>;
const OW = 420;
const OH = 150;

const oscOf = (p: OscProps) => oscillator(p.k, p.m, p.b, p.A0, p.F0);
const oscTEnd = (p: OscProps) => (8 * 2 * Math.PI) / oscOf(p).omega0;

function OscShape({ o, ctx }: { o: BoardObject<OscProps>; ctx: RenderContext }) {
  const p = o.props;
  const os = oscOf(p);
  const tEnd = oscTEnd(p);
  const t = usePlayTime(p.play, tEnd, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const w = p.ratio * os.omega0;
  const A = os.amplitude(w);
  const phi = os.phase(w);
  const x = p.forced ? A * Math.cos(w * t - phi) : os.free(t);
  const xMax = p.forced ? Math.max(A, os.amplitude(os.resonance || os.omega0)) : p.A0;
  const px = (v: number) => 150 + (v / Math.max(xMax, 1e-12)) * 90;
  const zig: number[] = [0, -10];
  const right = px(x) - 20;
  for (let i = 1; i < 20; i++) zig.push((right * i) / 20, -10 + (i % 2 ? -8 : 8));
  zig.push(right, -10);
  return (
    <Group listening={false}>
      <Line points={[0, -40, 0, 14, 300, 14]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Line points={zig} stroke={ink} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />
      <KRect x={right} y={-26} width={40} height={32} fill={ctx.resolveColor('accent-3')} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      <Line points={[150, -40, 150, 14]} stroke={muted} strokeWidth={1} dash={[4, 4]} strokeScaleEnabled={false} listening={false} />
      {p.forced ? (
        <MiniPlot
          x={0}
          y={50}
          w={OW}
          h={OH}
          x0={0}
          x1={3 * os.omega0}
          yMax={os.amplitude(os.resonance || os.omega0) * 1.1 || 1}
          positive
          curves={[{ f: (v) => os.amplitude(v), color: C3 }]}
          cursor={w}
          xLabel="ω"
          yLabel="A"
          ink={ink}
        />
      ) : (
        <MiniPlot x={0} y={50} w={OW} h={OH} x0={0} x1={tEnd} yMax={p.A0 * 1.05} curves={[{ f: os.free, color: C1 }, { f: os.envelope, color: muted, dash: true }, { f: (v) => -os.envelope(v), color: muted, dash: true }]} cursor={t} xLabel="t" yLabel="x" ink={ink} />
      )}
      <Info
        x={0}
        y={-96}
        ink={ink}
        muted={muted}
        lines={
          p.forced
            ? [`${playText(p.play)} Вынужденные: ω = ${fmt(p.ratio)}ω₀ = ${fmt(w)} рад/с,  A = ${withPrefix(A, 'м')}`, `ω₀ = √(k/m) = ${fmt(os.omega0)} рад/с, β = b/(2m) = ${fmt(os.beta)} с⁻¹; резонанс при ω = ${fmt(os.resonance)} рад/с`, 'Резонанс: амплитуда наибольшая, когда частота силы близка к собственной']
            : [`${playText(p.play)} Затухающие: t = ${fmt(t)} с,  x = ${withPrefix(x, 'м')}`, `ω₀ = ${fmt(os.omega0)} рад/с, β = ${fmt(os.beta)} с⁻¹: x = A₀e^(−βt)cos ωt${os.omegaD ? `, T = ${fmt((2 * Math.PI) / os.omegaD)} с` : ' — без колебаний (сильное затухание)'}`]
        }
      />
    </Group>
  );
}

export const oscModule: ObjectModule<OscProps, ReactNode> = {
  type: OSC_TYPE,
  title: 'Затухающие и вынужденные колебания',
  version: 1,
  propsSchema: oscPropsSchema,
  createProps: () => ({ k: 40, m: 1, b: 1, A0: 0.2, forced: false, F0: 2, ratio: 0.8, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<OscProps>,
  ...boxed(() => ({ x: -10, y: -100, width: OW + 40, height: OH + 170 })),
  render: (o, ctx) => <OscShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, { kind: 'toggle', key: 'forced', label: 'Вынужденные' }, num('b', 'b, кг/с', 0, 1e6, 0.5), num('ratio', 'ω/ω₀', 0.05, 3, 0.05, true), num('k', 'k, Н/м', 0.01, 1e7, 5), num('m', 'm, кг', 0.001, 1e6, 0.1)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, oscTEnd(o.props), o.props.speed, ctx.now);
    if (play) ctx.updateObject<OscProps>(o.id, { props: { play } });
  },
} as ObjectModule<OscProps, ReactNode>;

// =====================================================================
//  Сложение колебаний (биения)
// =====================================================================

export const beatsPropsSchema = z.object({ A1: z.number().finite().min(0).max(1000), f1: z.number().finite().min(0.01).max(1000), A2: z.number().finite().min(0).max(1000), f2: z.number().finite().min(0.01).max(1000), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type BeatsProps = z.infer<typeof beatsPropsSchema>;
const BW = 460;
const BH = 70;
/** Окно графиков: два периода биений или десять периодов первого колебания. */
const beatsWin = (p: BeatsProps) => {
  const fb = Math.abs(p.f1 - p.f2);
  return fb > 1e-9 ? Math.min(2 / fb, 60 / Math.min(p.f1, p.f2)) : 10 / p.f1;
};

function BeatsShape({ o, ctx }: { o: BoardObject<BeatsProps>; ctx: RenderContext }) {
  const p = o.props;
  const b = beats(p.A1, p.f1, p.A2, p.f2);
  const win = beatsWin(p);
  const t = usePlayTime(p.play, win, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const am = Math.max(p.A1, p.A2, 1e-9);
  return (
    <Group listening={false}>
      <MiniPlot x={0} y={0} w={BW} h={BH} x0={0} x1={win} yMax={am * 1.1} curves={[{ f: b.x1, color: C1 }]} cursor={t} xLabel="t" yLabel="x₁" ink={ink} />
      <MiniPlot x={0} y={BH + 30} w={BW} h={BH} x0={0} x1={win} yMax={am * 1.1} curves={[{ f: b.x2, color: C2 }]} cursor={t} xLabel="t" yLabel="x₂" ink={ink} />
      <MiniPlot x={0} y={2 * BH + 60} w={BW} h={BH * 1.4} x0={0} x1={win} yMax={(p.A1 + p.A2) * 1.05 || 1} curves={[{ f: b.sum, color: C3 }]} cursor={t} xLabel="t" yLabel="x₁ + x₂" ink={ink} />
      <Info
        x={0}
        y={-58}
        ink={ink}
        muted={muted}
        lines={[`${playText(p.play)} x = x₁ + x₂ = ${fmt(b.sum(t))} при t = ${fmt(t)} с`, `ν₁ = ${fmt(p.f1)} Гц, ν₂ = ${fmt(p.f2)} Гц:  частота биений |ν₁ − ν₂| = ${fmt(b.fb)} Гц`]}
      />
    </Group>
  );
}

export const beatsModule: ObjectModule<BeatsProps, ReactNode> = {
  type: BEATS_TYPE,
  title: 'Сложение колебаний',
  version: 1,
  propsSchema: beatsPropsSchema,
  createProps: () => ({ A1: 1, f1: 10, A2: 1, f2: 11, speed: 0.5, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<BeatsProps>,
  ...boxed(() => ({ x: -10, y: -62, width: BW + 60, height: 3.4 * BH + 140 })),
  render: (o, ctx) => <BeatsShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('A1', 'A₁', 0, 1000, 0.5), num('f1', 'ν₁, Гц', 0.01, 1000, 0.5), num('A2', 'A₂', 0, 1000, 0.5), num('f2', 'ν₂, Гц', 0.01, 1000, 0.5)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, beatsWin(o.props), o.props.speed, ctx.now);
    if (play) ctx.updateObject<BeatsProps>(o.id, { props: { play } });
  },
} as ObjectModule<BeatsProps, ReactNode>;

// =====================================================================
//  Колебательный контур
// =====================================================================

export const lcPropsSchema = z.object({ L: z.number().finite().min(1e-6).max(1e6), C: z.number().finite().min(1e-6).max(1e9), q0: z.number().finite().min(1e-6).max(1e9), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type LCProps = z.infer<typeof lcPropsSchema>;
/** L — мГн, C — мкФ, q0 — мкКл. */
const lcOf = (p: LCProps) => lc(p.L * 1e-3, p.C * 1e-6, p.q0 * 1e-6);
const lcShow = (p: LCProps) => shownPeriod(lcOf(p).T);
const lcEnd = (p: LCProps) => lcShow(p) * 3;

function LCShape({ o, ctx }: { o: BoardObject<LCProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const c = lcOf(p);
  const ts = usePlayTime(p.play, lcEnd(p), p.speed);
  // Время модели: показ замедлен до lcShow секунд на период.
  const t = (ts / lcShow(p)) * c.T;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const q = c.q(t);
  const i = c.i(t);
  const qn = q / (p.q0 * 1e-6);
  const inorm = i / ((p.q0 * 1e-6) * c.omega);
  const signs = Math.round(Math.abs(qn) * 5);
  const top = qn >= 0 ? '+' : '−';
  const bot = qn >= 0 ? '−' : '+';
  const coil: ReactNode[] = [];
  for (let k = 0; k < 5; k++) coil.push(<Shape key={k} sceneFunc={(cx, shape) => { const g = raw(cx); g.beginPath(); g.arc(200, -50 + k * 20 + 10, 10, -Math.PI / 2, Math.PI / 2); cx.strokeShape(shape); }} stroke={ink} strokeWidth={1.8} strokeScaleEnabled={false} listening={false} />);
  return (
    <Group listening={false}>
      <Line points={[40, -10, 40, -70, 200, -70, 200, -50]} stroke={ink} strokeWidth={1.8} strokeScaleEnabled={false} listening={false} />
      <Line points={[40, 10, 40, 70, 200, 70, 200, 50]} stroke={ink} strokeWidth={1.8} strokeScaleEnabled={false} listening={false} />
      <Line points={[15, -10, 65, -10]} stroke={ink} strokeWidth={3} strokeScaleEnabled={false} listening={false} />
      <Line points={[15, 10, 65, 10]} stroke={ink} strokeWidth={3} strokeScaleEnabled={false} listening={false} />
      {Array.from({ length: signs }, (_, k) => (
        <Group key={k}>
          <Text x={16 + k * 10} y={-26} text={top} fontSize={13} fill={top === '+' ? '#d13a3a' : '#2563eb'} listening={false} />
          <Text x={16 + k * 10} y={13} text={bot} fontSize={13} fill={bot === '+' ? '#d13a3a' : '#2563eb'} listening={false} />
        </Group>
      ))}
      {coil}
      <Text x={-14} y={-8} text="C" fontSize={16} {...italic} fill={ink} listening={false} />
      <Text x={218} y={-8} text="L" fontSize={16} {...italic} fill={ink} listening={false} />
      {Math.abs(inorm) > 0.03 && <Arrow points={inorm > 0 ? [100, -70, 150, -70] : [150, -70, 100, -70]} stroke="#16a34a" fill="#16a34a" strokeWidth={1 + 2.5 * Math.abs(inorm)} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />}
      <Bars
        x={290}
        y={-70}
        h={120}
        max={c.W}
        ink={ink}
        items={[
          { label: 'Wэл', value: c.wc(t), fill: '#2563eb' },
          { label: 'Wмаг', value: c.wl(t), fill: '#ea580c' },
          { label: 'W', value: c.W, fill: muted },
        ]}
      />
      <MiniPlot x={0} y={130} w={380} h={90} x0={0} x1={3 * c.T} yMax={1.1} curves={[{ f: (v) => c.q(v) / (p.q0 * 1e-6), color: '#2563eb' }, { f: (v) => c.i(v) / ((p.q0 * 1e-6) * c.omega), color: '#16a34a' }]} cursor={t} xLabel="t" yLabel="q, i" ink={ink} />
      <Info
        x={0}
        y={-130}
        ink={ink}
        muted={muted}
        lines={[`${playText(p.play)} q = ${withPrefix(q, 'Кл')},  i = ${withPrefix(i, 'А')}`, `L = ${fmt(p.L)} мГн, C = ${fmt(p.C)} мкФ:  T = 2π√(LC) = ${withPrefix(c.T, 'с')},  ν = ${withPrefix(1 / c.T, 'Гц')}${c.T < 1 ? ' (показ замедлен)' : ''}`]}
      />
    </Group>
  );
}

export const lcModule: ObjectModule<LCProps, ReactNode> = {
  type: LC_TYPE,
  title: 'Колебательный контур',
  version: 1,
  propsSchema: lcPropsSchema,
  createProps: () => ({ L: 100, C: 10, q0: 50, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<LCProps>,
  ...boxed(() => ({ x: -20, y: -134, width: 460, height: 370 })),
  render: (o, ctx) => <LCShape o={o} ctx={ctx} />,
  inspector: [...PLAY_FIELDS, num('L', 'L, мГн', 1e-6, 1e6, 10), num('C', 'C, мкФ', 1e-6, 1e9, 1), num('q0', 'q₀, мкКл', 1e-6, 1e9, 10)],
  runAction: (o, key, ctx) => {
    const p = o.props;
    const c = lcOf(p);
    if (key === 'graphs') {
      const w = numText(c.omega);
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(c.T * 2) };
      placeGraphs(o, { x: -20, y: -134, width: 460, height: 370 }, [{ ...base, ySym: 'q', yUnit: 'мкКл', expr: `${numText(p.q0)}cos(${w}t)` }, { ...base, ySym: 'i', yUnit: 'мА', expr: `−${numText(p.q0 * c.omega * 1e-3)}sin(${w}t)` }], ctx);
      return;
    }
    const play = playAction(key, p.play, lcEnd(p), p.speed, ctx.now);
    if (play) ctx.updateObject<LCProps>(o.id, { props: { play } });
  },
} as ObjectModule<LCProps, ReactNode>;

export const wavesModules = [pendulumModule, oscModule, beatsModule, lcModule];
