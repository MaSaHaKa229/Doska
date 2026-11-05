import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { ActionContext, BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { differentiate, getMath, loadMath, useMathReady } from '../../math/analysis/expr';
import { fmt } from '../common/quantities';
import { VecLabel } from '../common/vectors';
import { insertGraph, planGraph, type GraphInput } from '../common/graph';
import { compileLaw, numText, prepareLaw, sample, throwInfo, tickStep, velocity, type Law, type ThrowInfo } from './kinematics';
import { PLAY0, playAction, playSchema, usePlayTime, type Play } from './playback';

export const PLUGIN_ID = 'physics.mechanics';
export const MOTION_TYPE = `${PLUGIN_ID}.motion`;
export const THROW_TYPE = `${PLUGIN_ID}.throw`;
export const MOTION_EDITOR = 'physics.motion';

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
/** Стрелка скорости — перемещение за 0,5 с в масштабе чертежа. */
const ARROW_S = 0.5;
const INFO = 15;

type P2 = { x: number; y: number };

// =====================================================================
//  Общее: оси с делениями, путь, тело, скорость
// =====================================================================

/** Оси от (x0..x1, y0..y1) в метрах; scale — пикселей на метр, y вверх. */
function AxesM({ x0, x1, y0, y1, scale, color, ground }: { x0: number; x1: number; y0: number; y1: number; scale: number; color: string; ground?: boolean }) {
  const zoom = useZoom();
  const step = tickStep(scale);
  const els: ReactNode[] = [];
  const head = { pointerLength: 9 / zoom, pointerWidth: 7 / zoom };
  els.push(<Arrow key="ax" points={[x0 * scale - 10, 0, x1 * scale + 24, 0]} stroke={color} fill={color} strokeWidth={1.3} strokeScaleEnabled={false} {...head} listening={false} />);
  els.push(<Text key="axl" x={x1 * scale + 14} y={6} text="x, м" fontSize={14} {...italic} fill={color} listening={false} />);
  if (y1 - y0 > 1e-9) {
    els.push(<Arrow key="ay" points={[0, -y0 * scale + 10, 0, -y1 * scale - 24]} stroke={color} fill={color} strokeWidth={1.3} strokeScaleEnabled={false} {...head} listening={false} />);
    els.push(<Text key="ayl" x={8} y={-y1 * scale - 30} text="y, м" fontSize={14} {...italic} fill={color} listening={false} />);
    for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
      if (Math.abs(v) < 1e-9) continue;
      els.push(<Line key={`ty${v}`} points={[-4, -v * scale, 4, -v * scale]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
      els.push(<Text key={`tyl${v}`} x={-48} y={-v * scale - 6} width={42} align="right" text={fmt(v)} fontSize={11} fill={color} listening={false} />);
    }
  }
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    els.push(<Line key={`tx${v}`} points={[v * scale, -4, v * scale, 4]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key={`txl${v}`} x={v * scale - 20} y={ground ? 16 : 7} width={40} align="center" text={fmt(v)} fontSize={11} fill={color} listening={false} />);
  }
  els.push(<Text key="o" x={-14} y={4} text="O" fontSize={13} {...italic} fill={color} listening={false} />);
  if (ground)
    els.push(
      <Shape
        key="ground"
        sceneFunc={(c, shape) => {
          const g = raw(c);
          g.beginPath();
          for (let x = x0 * scale - 10; x <= x1 * scale + 10; x += 10) {
            g.moveTo(x + 10, 0);
            g.lineTo(x, 10);
          }
          c.strokeShape(shape);
        }}
        stroke={color}
        strokeWidth={0.8}
        strokeScaleEnabled={false}
        listening={false}
      />,
    );
  return <Group listening={false}>{els}</Group>;
}

/** Путь: вся траектория пунктиром, пройденная часть — сплошной; тело; скорость. */
function Track({ pts, done, at, v, scale, color, label, trail, showV, comps }: { pts: P2[]; done: P2[]; at: P2; v: { vx: number; vy: number }; scale: number; color: string; label: string; trail: boolean; showV: boolean; comps?: boolean }) {
  const zoom = useZoom();
  const flat = (a: P2[]) => a.flatMap((q) => [q.x * scale, -q.y * scale]);
  const bx = at.x * scale;
  const by = -at.y * scale;
  const ax = v.vx * ARROW_S * scale;
  const ay = -v.vy * ARROW_S * scale;
  const head = { pointerLength: 11 / zoom, pointerWidth: 8 / zoom };
  const dash = [6 / zoom, 5 / zoom];
  const vcol = '#2563eb';
  return (
    <Group listening={false}>
      {trail && <Line points={flat(pts)} stroke={color} opacity={0.45} strokeWidth={1.3} dash={dash} strokeScaleEnabled={false} listening={false} />}
      {done.length > 1 && <Line points={flat(done)} stroke={color} strokeWidth={2.2} lineCap="round" lineJoin="round" strokeScaleEnabled={false} listening={false} />}
      {showV && comps && Math.abs(ax) > 2 && <Arrow points={[bx, by, bx + ax, by]} stroke={vcol} fill={vcol} opacity={0.7} strokeWidth={1.4} dash={dash} strokeScaleEnabled={false} {...head} listening={false} />}
      {showV && comps && Math.abs(ay) > 2 && <Arrow points={[bx, by, bx, by + ay]} stroke={vcol} fill={vcol} opacity={0.7} strokeWidth={1.4} dash={dash} strokeScaleEnabled={false} {...head} listening={false} />}
      {showV && comps && Math.abs(ax) > 2 && <VecLabel x={bx + ax + 4} y={by + 4} label="v_x" color={vcol} size={15} />}
      {showV && comps && Math.abs(ay) > 2 && <VecLabel x={bx - 22} y={by + ay - 4} label="v_y" color={vcol} size={15} />}
      {showV && Math.hypot(ax, ay) > 2 && <Arrow points={[bx, by, bx + ax, by + ay]} stroke={vcol} fill={vcol} strokeWidth={2.4} strokeScaleEnabled={false} {...head} listening={false} />}
      {showV && Math.hypot(ax, ay) > 2 && <VecLabel x={bx + ax + 6} y={by + ay - 22} label="v" color={vcol} size={17} />}
      <Circle x={bx} y={by} radius={8} fill={color} stroke="#ffffff" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      {label && <Text x={bx - 22} y={by - 26} text={label} fontSize={17} {...italic} fill={color} listening={false} />}
    </Group>
  );
}

// Сверху — две строки сведений над подписью оси y.
const PAD = { left: 56, right: 60, top: 84, bottom: 40 };

/** Габарит чертежа в локальных координатах по пределам в метрах. */
function boxOf(x0: number, x1: number, y0: number, y1: number, scale: number): Rect {
  const x = x0 * scale - PAD.left;
  const y = -y1 * scale - PAD.top;
  return { x, y, width: (x1 - x0) * scale + PAD.left + PAD.right, height: (y1 - y0) * scale + PAD.top + PAD.bottom };
}

// «⏸» в шрифте холста часто нет — пауза обозначается «‖».
export const playText = (p: Play) => (p.running ? '▶' : '‖');

/** Кнопки панели свойств: пуск, сначала, графики. */
export const PLAY_FIELDS = [
  { kind: 'action', key: 'toggle', label: '▶ Пуск / пауза' },
  { kind: 'action', key: 'reset', label: '⟲ Сначала' },
  { kind: 'action', key: 'graphs', label: 'Графики' },
  { kind: 'number', key: 'speed', label: 'Скорость показа', min: 0.1, max: 10, step: 0.1 },
] as const;

/** Графики — справа от чертежа, друг под другом, одним шагом отмены (действие уже в транзакции). */
export function placeGraphs(o: BoardObject, box: Rect, list: GraphInput[], ctx: ActionContext): void {
  const run = () => {
    const math = getMath()!;
    list.forEach((g, i) => {
      const plan = planGraph(math, g);
      if ('error' in plan) {
        toast.info(plan.error);
        return;
      }
      insertGraph(ctx, plan, { x: o.x + box.x + box.width + 250, y: o.y + box.y + 150 + i * 360 });
    });
  };
  if (getMath()) run();
  // math.js ещё не загружен (у объекта нет записей): графики появятся сразу после загрузки — тоже одним шагом.
  else void loadMath().then(() => ctx.transact(run));
}

// =====================================================================
//  Движение по закону x(t), y(t)
// =====================================================================

export const motionPropsSchema = z.object({
  /** Закон движения, м: «5 + 2t», «0,5t²», «3cos(2t)». */
  x: z.string().max(120),
  y: z.string().max(120),
  tEnd: z.number().finite().min(0.1).max(1000),
  /** Пикселей на метр. */
  scale: z.number().finite().min(0.5).max(1000),
  label: z.string().max(8),
  color: z.string().max(32),
  trail: z.boolean(),
  showVelocity: z.boolean(),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type MotionProps = z.infer<typeof motionPropsSchema>;
type MotionObject = BoardObject<MotionProps>;

interface MotionGeom {
  law: Law;
  pts: P2[];
  box: Rect;
  lim: { x0: number; x1: number; y0: number; y1: number };
}

const motionCache = new WeakMap<MotionProps, MotionGeom | { error: string }>();
export function motionGeom(p: MotionProps): MotionGeom | { error: string } | null {
  const math = getMath();
  if (!math) return null;
  let g = motionCache.get(p);
  if (!g) {
    const law = compileLaw(math, p.x, p.y);
    if ('error' in law) g = law;
    else {
      const pts = sample(law, p.tEnd);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const lim = { x0: Math.min(0, ...xs), x1: Math.max(0, ...xs), y0: Math.min(0, ...ys), y1: Math.max(0, ...ys) };
      g = { law, pts, lim, box: boxOf(lim.x0, lim.x1, lim.y0, lim.y1, p.scale) };
    }
    motionCache.set(p, g);
  }
  return g;
}

function MotionShape({ o, ctx }: { o: MotionObject; ctx: RenderContext }) {
  useMathReady();
  const p = o.props;
  const t = usePlayTime(p.play, p.tEnd, p.speed);
  const c = ctx.resolveColor(p.color);
  const ink = ctx.resolveColor('ink');
  const g = motionGeom(p);
  if (!g) return <Text text="Загрузка вычислений…" fontSize={INFO} fill={ctx.resolveColor('muted')} listening={false} />;
  if ('error' in g) return <Text text={`Движение: ${g.error}`} fontSize={INFO} fill="#d13a3a" listening={false} />;
  const at = { x: g.law.x(t), y: g.law.y(t) };
  const v = velocity(g.law, t);
  const n = Math.max(1, Math.round((t / p.tEnd) * (g.pts.length - 1)));
  const info = `${playText(p.play)} t = ${fmt(t)} с   x = ${fmt(at.x)} м${g.lim.y1 - g.lim.y0 > 1e-9 ? `   y = ${fmt(at.y)} м` : ''}   v = ${fmt(Math.hypot(v.vx, v.vy))} м/с`;
  return (
    <Group listening={false}>
      <AxesM {...g.lim} scale={p.scale} color={ink} />
      <Track pts={g.pts} done={[...g.pts.slice(0, n), at]} at={at} v={v} scale={p.scale} color={c} label={p.label} trail={p.trail} showV={p.showVelocity} />
      <Text x={g.box.x + 4} y={g.box.y + 4} text={info} fontSize={INFO} fill={ink} listening={false} />
    </Group>
  );
}

const FALLBACK_BOX: Rect = { x: -60, y: -60, width: 320, height: 120 };

export const motionModule: ObjectModule<MotionProps, ReactNode> = {
  type: MOTION_TYPE,
  title: 'Движение по закону',
  version: 1,
  propsSchema: motionPropsSchema,
  createProps: () => ({ x: '2 + 3t', y: '0', tEnd: 5, scale: 20, label: 'A', color: 'accent-1', trail: true, showVelocity: true, speed: 1, play: PLAY0 }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as MotionObject,
  getLocalBounds: (o) => {
    const g = motionGeom(o.props);
    return g && !('error' in g) ? g.box : FALLBACK_BOX;
  },
  hitTest: (o, point, tol) => {
    const g = motionGeom(o.props);
    const b = g && !('error' in g) ? g.box : FALLBACK_BOX;
    const q = toLocal(o, point);
    return q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <MotionShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_FIELDS,
    { kind: 'text', key: 'x', label: 'x(t), м', maxLength: 120 },
    { kind: 'text', key: 'y', label: 'y(t), м', maxLength: 120 },
    { kind: 'number', key: 'tEnd', label: 'До t, с', min: 0.1, max: 1000, step: 0.5 },
    { kind: 'toggle', key: 'trail', label: 'Траектория' },
    { kind: 'toggle', key: 'showVelocity', label: 'Скорость' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  editor: MOTION_EDITOR,
  runAction: (o, key, ctx) => {
    const p = o.props;
    if (key === 'graphs') {
      const g = motionGeom(p);
      const box = g && !('error' in g) ? g.box : FALLBACK_BOX;
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(p.tEnd) };
      const moving = (s: string) => /(?<![A-Za-z_])t(?![A-Za-z0-9_])/.test(s);
      const vx = differentiate(prepareLaw(p.x), 't');
      const list: GraphInput[] = [{ ...base, ySym: 'x', yUnit: 'м', expr: p.x }];
      if (moving(p.y)) list.push({ ...base, ySym: 'y', yUnit: 'м', expr: p.y });
      else if (vx) list.push({ ...base, ySym: 'v_x', yUnit: 'м/с', expr: vx });
      placeGraphs(o, box, list, ctx);
      return;
    }
    const play = playAction(key, p.play, p.tEnd, p.speed, ctx.now);
    if (play) ctx.updateObject<MotionProps>(o.id, { props: { play } });
  },
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Бросок под углом к горизонту
// =====================================================================

export const throwPropsSchema = z.object({
  v0: z.number().finite().min(0.1).max(10000),
  angle: z.number().finite().min(-89).max(90),
  h0: z.number().finite().min(0).max(100000),
  g: z.number().finite().min(0.1).max(1000),
  scale: z.number().finite().min(0.05).max(1000),
  color: z.string().max(32),
  showVelocity: z.boolean(),
  /** Проекции скорости vₓ, v_y. */
  components: z.boolean(),
  /** Наибольшая высота H и дальность L на чертеже. */
  marks: z.boolean(),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type ThrowProps = z.infer<typeof throwPropsSchema>;
type ThrowObject = BoardObject<ThrowProps>;

const throwCache = new WeakMap<ThrowProps, { info: ThrowInfo; pts: P2[]; box: Rect }>();
export function throwGeom(p: ThrowProps): { info: ThrowInfo; pts: P2[]; box: Rect } {
  let g = throwCache.get(p);
  if (!g) {
    const info = throwInfo(p);
    const pts = sample(info.law, info.T, 200);
    g = { info, pts, box: boxOf(Math.min(0, info.L), Math.max(0, info.L), 0, info.H, p.scale) };
    throwCache.set(p, g);
  }
  return g;
}

function ThrowShape({ o, ctx }: { o: ThrowObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const { info, pts, box } = throwGeom(p);
  const t = usePlayTime(p.play, info.T, p.speed);
  const c = ctx.resolveColor(p.color);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const at = { x: info.law.x(t), y: info.law.y(t) };
  const v = { vx: info.vx, vy: info.vy0 - p.g * t };
  const n = Math.max(1, Math.round((t / info.T) * (pts.length - 1)));
  const s = p.scale;
  const dash = [4 / zoom, 4 / zoom];
  const top = { x: info.law.x(info.tTop), y: info.H };
  const info1 = `${playText(p.play)} t = ${fmt(t)} с   v = ${fmt(Math.hypot(v.vx, v.vy))} м/с   (vx = ${fmt(v.vx)}, vy = ${fmt(v.vy)} м/с)`;
  const info2 = `v₀ = ${fmt(p.v0)} м/с, α = ${fmt(p.angle)}°${p.h0 ? `, h₀ = ${fmt(p.h0)} м` : ''}:   T = ${fmt(info.T)} с,  H = ${fmt(info.H)} м,  L = ${fmt(info.L)} м`;
  return (
    <Group listening={false}>
      <AxesM x0={Math.min(0, info.L)} x1={Math.max(0, info.L)} y0={0} y1={info.H} scale={s} color={ink} ground />
      {p.marks && info.vy0 > 0 && (
        <>
          <Line points={[top.x * s, -top.y * s, top.x * s, 0]} stroke={muted} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />
          <Text x={top.x * s + 6} y={-top.y * s / 2 - 8} text={`H = ${fmt(info.H)} м`} fontSize={14} fill={muted} listening={false} />
        </>
      )}
      {p.marks && <Text x={info.L * s - 40} y={-24} width={80} align="center" text={`L = ${fmt(info.L)} м`} fontSize={14} fill={muted} listening={false} />}
      <Track pts={pts} done={[...pts.slice(0, n), at]} at={at} v={v} scale={s} color={c} label="" trail showV={p.showVelocity} comps={p.components} />
      <Text x={box.x + 4} y={box.y + 4} text={info1} fontSize={INFO} fill={ink} listening={false} />
      <Text x={box.x + 4} y={box.y + 4 + INFO * 1.4} text={info2} fontSize={INFO * 0.9} fill={muted} listening={false} />
    </Group>
  );
}

export const throwModule: ObjectModule<ThrowProps, ReactNode> = {
  type: THROW_TYPE,
  title: 'Бросок под углом',
  version: 1,
  propsSchema: throwPropsSchema,
  createProps: () => ({ v0: 15, angle: 45, h0: 0, g: 9.8, scale: 20, color: 'accent-4', showVelocity: true, components: true, marks: true, speed: 1, play: PLAY0 }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as ThrowObject,
  getLocalBounds: (o) => throwGeom(o.props).box,
  hitTest: (o, point, tol) => {
    const b = throwGeom(o.props).box;
    const q = toLocal(o, point);
    return q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <ThrowShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_FIELDS,
    { kind: 'number', key: 'v0', label: 'v₀, м/с', min: 0.1, max: 10000, step: 1 },
    { kind: 'number', key: 'angle', label: 'α, °', min: -89, max: 90, step: 5, slider: true },
    { kind: 'number', key: 'h0', label: 'h₀, м', min: 0, max: 100000, step: 1 },
    { kind: 'number', key: 'g', label: 'g, м/с²', min: 0.1, max: 1000, step: 0.1 },
    { kind: 'number', key: 'scale', label: 'Пикс./м', min: 0.05, max: 1000, step: 1 },
    { kind: 'toggle', key: 'components', label: 'Проекции v' },
    { kind: 'toggle', key: 'marks', label: 'H и L' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  runAction: (o, key, ctx) => {
    const p = o.props;
    const { info, box } = throwGeom(p);
    if (key === 'graphs') {
      const base = { xSym: 't', xUnit: 'с', from: '0', to: numText(info.T).replace(',', '.') };
      placeGraphs(
        o,
        box,
        [
          { ...base, ySym: 'y', yUnit: 'м', expr: `${numText(p.h0)} + ${numText(info.vy0)}t − ${numText(p.g / 2)}t²` },
          { ...base, ySym: 'v_y', yUnit: 'м/с', expr: `${numText(info.vy0)} − ${numText(p.g)}t` },
        ],
        ctx,
      );
      return;
    }
    const play = playAction(key, p.play, info.T, p.speed, ctx.now);
    if (play) ctx.updateObject<ThrowProps>(o.id, { props: { play } });
  },
  transform: { rotatable: false, resize: 'none' },
};

export const mechanicsModules = [motionModule, throwModule];
