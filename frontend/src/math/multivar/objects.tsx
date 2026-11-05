import { type ReactNode, useMemo } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { getMath, niceStep, useMathReady } from '../analysis/expr';
import { type Compiled, type F2, type Range2, compile2, contour, fieldAt, fieldMeaning, heightColor, levels, num, pretty, project, sampleGrid, streamline, zRange } from './multivar';

export const PLUGIN_ID = 'math.multivar';
export const SURFACE_TYPE = `${PLUGIN_ID}.surface`;
export const CONTOURS_TYPE = `${PLUGIN_ID}.contours`;
export const FIELD_TYPE = `${PLUGIN_ID}.field`;

export const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const GRAD = '#d13a3a';
const LINE = '#2563eb';
const INFO = 14;

export const rangeSchema = {
  xMin: z.number().finite().min(-1e6).max(1e6),
  xMax: z.number().finite().min(-1e6).max(1e6),
  yMin: z.number().finite().min(-1e6).max(1e6),
  yMax: z.number().finite().min(-1e6).max(1e6),
};
export const RANGE_FIELDS = [
  { kind: 'number' as const, key: 'xMin', label: 'x от', min: -1e6, max: 1e6, step: 1 },
  { kind: 'number' as const, key: 'xMax', label: 'x до', min: -1e6, max: 1e6, step: 1 },
  { kind: 'number' as const, key: 'yMin', label: 'y от', min: -1e6, max: 1e6, step: 1 },
  { kind: 'number' as const, key: 'yMax', label: 'y до', min: -1e6, max: 1e6, step: 1 },
];
export const badRange = (r: Range2) => !(r.xMax > r.xMin && r.yMax > r.yMin);

export function Lines({ x, y, lines, ink, muted }: { x: number; y: number; lines: string[]; ink: string; muted: string }) {
  return (
    <Group listening={false}>
      {lines.map((l, i) => (
        <Text key={i} x={x} y={y + i * INFO * 1.35} text={l} fontSize={i ? INFO * 0.92 : INFO} fill={i ? muted : ink} listening={false} />
      ))}
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
    transform: { rotatable: false, resize: 'none' as const },
  };
}

/** Разбор нескольких записей сразу: функции или первая ошибка. */
export function useCompiled(srcs: string[]): Compiled[] | { error: string } | null {
  const ready = useMathReady();
  return useMemo(() => {
    if (!ready) return null;
    const out: Compiled[] = [];
    for (const s of srcs) {
      const c = compile2(getMath()!, s);
      if ('error' in c) return c;
      out.push(c);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ...srcs]);
}

export function Status({ state, ink }: { state: { error: string } | null; ink: string }) {
  return <Text x={0} y={0} text={state ? `Ошибка: ${state.error}` : 'Загрузка вычислений…'} fontSize={15} fill={state ? GRAD : ink} listening={false} />;
}

// =====================================================================
//  Плоская картинка: координатная область W × H
// =====================================================================

export const PW = 380;
export const PH = 380;

export interface Map2 {
  X: (x: number) => number;
  Y: (y: number) => number;
  inv: (px: number, py: number) => { x: number; y: number };
}

export const map2 = (r: Range2): Map2 => ({
  X: (x) => ((x - r.xMin) / (r.xMax - r.xMin)) * PW,
  Y: (y) => PH - ((y - r.yMin) / (r.yMax - r.yMin)) * PH,
  inv: (px, py) => ({ x: r.xMin + (px / PW) * (r.xMax - r.xMin), y: r.yMin + ((PH - py) / PH) * (r.yMax - r.yMin) }),
});

/** Сетка, оси через ноль и подписи делений. */
export function PlaneFrame({ r, ink, muted, xLabel = 'x', yLabel = 'y' }: { r: Range2; ink: string; muted: string; xLabel?: string; yLabel?: string }) {
  const zoom = useZoom();
  const m = map2(r);
  const sx = niceStep(((r.xMax - r.xMin) / PW) * 40);
  const sy = niceStep(((r.yMax - r.yMin) / PH) * 40);
  const xs: number[] = [];
  for (let v = Math.ceil(r.xMin / sx) * sx; v <= r.xMax + 1e-9; v += sx) xs.push(Math.round(v / sx) * sx);
  const ys: number[] = [];
  for (let v = Math.ceil(r.yMin / sy) * sy; v <= r.yMax + 1e-9; v += sy) ys.push(Math.round(v / sy) * sy);
  const ax = r.yMin <= 0 && r.yMax >= 0 ? m.Y(0) : PH;
  const ay = r.xMin <= 0 && r.xMax >= 0 ? m.X(0) : 0;
  return (
    <Group listening={false}>
      <KRect width={PW} height={PH} stroke={muted} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {xs.map((v) => (
        <Group key={`x${v}`}>
          <Line points={[m.X(v), 0, m.X(v), PH]} stroke={muted} opacity={0.25} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          {Math.abs(v) > 1e-12 && <Text x={m.X(v) - 20} y={ax + 3} width={40} align="center" text={num(v)} fontSize={11} fill={muted} listening={false} />}
        </Group>
      ))}
      {ys.map((v) => (
        <Group key={`y${v}`}>
          <Line points={[0, m.Y(v), PW, m.Y(v)]} stroke={muted} opacity={0.25} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          {Math.abs(v) > 1e-12 && <Text x={ay - 44} y={m.Y(v) - 6} width={40} align="right" text={num(v)} fontSize={11} fill={muted} listening={false} />}
        </Group>
      ))}
      <Arrow points={[0, ax, PW + 14, ax]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
      <Arrow points={[ay, PH, ay, -14]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
      <Text x={PW + 6} y={ax + 4} text={xLabel} fontSize={15} {...italic} fill={ink} listening={false} />
      <Text x={ay + 7} y={-18} text={yLabel} fontSize={15} {...italic} fill={ink} listening={false} />
    </Group>
  );
}

/** Точка M в координатах функции — ручка «point» без привязки к сетке. */
export function pointHandle(o: BoardObject<Range2 & { x0: number; y0: number }>, label: string) {
  const m = map2(o.props);
  return { id: 'M', kind: 'point' as const, position: toWorld(o, { x: m.X(o.props.x0), y: m.Y(o.props.y0) }), label, snap: false };
}

function dragPoint(o: BoardObject<Range2 & { x0: number; y0: number }>, to: { x: number; y: number }) {
  const p = o.props;
  const q = toLocal(o, to);
  const v = map2(p).inv(Math.max(0, Math.min(PW, q.x)), Math.max(0, Math.min(PH, q.y)));
  const step = niceStep(((p.xMax - p.xMin) / PW) * 4);
  const round = (t: number) => Math.round(t / step) * step;
  return { props: { x0: Number(round(v.x).toPrecision(6)), y0: Number(round(v.y).toPrecision(6)) } };
}

// =====================================================================
//  Линии уровня и градиент
// =====================================================================

export const contoursPropsSchema = z.object({
  f: z.string().max(200),
  ...rangeSchema,
  /** Примерное число линий уровня. */
  count: z.number().int().min(2).max(40),
  heat: z.boolean(),
  grads: z.boolean(),
  x0: z.number().finite(),
  y0: z.number().finite(),
});
export type ContoursProps = z.infer<typeof contoursPropsSchema>;
const CONT_BOX: Rect = { x: -50, y: -100, width: PW + 70, height: PH + 120 };

function ContoursShape({ o, ctx }: { o: BoardObject<ContoursProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const cs = useCompiled([p.f]);
  const r: Range2 = { xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax };
  const data = useMemo(() => {
    if (!cs || 'error' in cs || badRange(r)) return null;
    const g = sampleGrid(cs[0]!.f, r, 80);
    const lv = levels(g.min, g.max, p.count);
    return { g, lv, segs: lv.map((c) => ({ c, s: contour(g, r, c) })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, p.xMin, p.xMax, p.yMin, p.yMax, p.count]);
  if (badRange(r)) return <Status state={{ error: 'пределы: «от» должно быть меньше «до»' }} ink={ink} />;
  if (!cs || 'error' in cs || !data) return <Status state={cs && 'error' in cs ? cs : null} ink={ink} />;
  const c = cs[0]!;
  const m = map2(r);
  const z0 = c.f(p.x0, p.y0);
  const gx = c.fx(p.x0, p.y0);
  const gy = c.fy(p.x0, p.y0);
  const gl = Math.hypot(gx, gy);
  // Стрелка градиента в пикселях: направление (gx; gy) с учётом масштабов осей, длина 70.
  const kx = PW / (r.xMax - r.xMin);
  const ky = PH / (r.yMax - r.yMin);
  const vx = gx * kx;
  const vy = -gy * ky;
  const vl = Math.hypot(vx, vy) || 1;
  const Mx = m.X(p.x0);
  const My = m.Y(p.y0);
  const span = data.g.max - data.g.min || 1;
  return (
    <Group listening={false}>
      {p.heat && (
        <Shape
          sceneFunc={(cx) => {
            const g = raw(cx);
            const n = data.g.n;
            for (let i = 0; i < n; i++)
              for (let j = 0; j < n; j++) {
                const v = data.g.v[i]![j]!;
                if (!Number.isFinite(v)) continue;
                g.fillStyle = heightColor((v - data.g.min) / span, 0.9);
                g.globalAlpha = 0.45;
                g.fillRect((i / n) * PW, PH - ((j + 1) / n) * PH, PW / n + 0.5, PH / n + 0.5);
              }
            g.globalAlpha = 1;
          }}
          listening={false}
        />
      )}
      <PlaneFrame r={r} ink={ink} muted={muted} />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        {data.segs.map(({ c: lv, s }) => (
          <Shape
            key={lv}
            sceneFunc={(cx, shape) => {
              const g = raw(cx);
              g.beginPath();
              for (let i = 0; i < s.length; i += 4) {
                g.moveTo(m.X(s[i]!), m.Y(s[i + 1]!));
                g.lineTo(m.X(s[i + 2]!), m.Y(s[i + 3]!));
              }
              cx.strokeShape(shape);
            }}
            stroke={p.heat ? ink : heightColor((lv - data.g.min) / span, 0.6)}
            strokeWidth={1.4}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
        {data.segs.map(({ c: lv, s }) => {
          if (s.length < 8) return null;
          // Подпись — в самой «правой верхней» точке линии: у вложенных линий подписи расходятся по диагонали.
          let k = 0;
          for (let i = 0; i < s.length; i += 2) if (m.X(s[i]!) - m.Y(s[i + 1]!) > m.X(s[k]!) - m.Y(s[k + 1]!)) k = i;
          return <Text key={`l${lv}`} x={m.X(s[k]!) + 2} y={m.Y(s[k + 1]!) - 13} text={num(lv)} fontSize={11} fill={ink} listening={false} />;
        })}
        {p.grads &&
          Array.from({ length: 11 * 11 }, (_, idx) => {
            const i = idx % 11;
            const j = Math.floor(idx / 11);
            const x = r.xMin + ((i + 0.5) / 11) * (r.xMax - r.xMin);
            const y = r.yMin + ((j + 0.5) / 11) * (r.yMax - r.yMin);
            const ax = c.fx(x, y) * kx;
            const ay = -c.fy(x, y) * ky;
            const l = Math.hypot(ax, ay);
            if (!(l > 1e-12)) return null;
            const L = 13;
            return <Arrow key={idx} points={[m.X(x), m.Y(y), m.X(x) + (ax / l) * L, m.Y(y) + (ay / l) * L]} stroke={muted} fill={muted} strokeWidth={1} strokeScaleEnabled={false} pointerLength={4 / zoom} pointerWidth={4 / zoom} listening={false} />;
          })}
        {gl > 1e-12 && <Line points={[Mx - (vy / vl) * 90, My + (vx / vl) * 90, Mx + (vy / vl) * 90, My - (vx / vl) * 90]} stroke={ink} strokeWidth={1.2} dash={[6 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />}
        {gl > 1e-12 && <Arrow points={[Mx, My, Mx + (vx / vl) * 70, My + (vy / vl) * 70]} stroke={GRAD} fill={GRAD} strokeWidth={2.5} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />}
      </Group>
      <Circle x={Mx} y={My} radius={5} fill="#ffffff" stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Text x={Mx + 8} y={My + 4} text="M" fontSize={15} {...italic} fill={ink} listening={false} />
      {gl > 1e-12 && <Text x={Mx + (vx / vl) * 74} y={My + (vy / vl) * 74 - 8} text="grad f" fontSize={13} {...italic} fill={GRAD} listening={false} />}
      <Lines
        x={-40}
        y={-96}
        ink={ink}
        muted={muted}
        lines={[
          `Линии уровня f(x, y) = c,  f = ${p.f}`,
          `M(${num(p.x0)}; ${num(p.y0)}):  f = ${num(z0)};  ∂f/∂x = ${pretty(c.dxText)} = ${num(gx)},  ∂f/∂y = ${pretty(c.dyText)} = ${num(gy)}`,
          gl > 1e-12 ? `grad f = (${num(gx)}; ${num(gy)}),  |grad f| = ${num(gl)} — наибольшая скорость роста` : 'grad f = 0 — стационарная точка (экстремум или седло)',
          'Градиент перпендикулярен линии уровня (пунктир — касательная к ней)',
        ]}
      />
    </Group>
  );
}

export const contoursModule: ObjectModule<ContoursProps, ReactNode> = {
  type: CONTOURS_TYPE,
  title: 'Линии уровня и градиент',
  version: 1,
  propsSchema: contoursPropsSchema,
  createProps: () => ({ f: 'x^2 + 2y^2', xMin: -4, xMax: 4, yMin: -4, yMax: 4, count: 8, heat: true, grads: false, x0: 2, y0: 1 }),
  deserialize: (r) => r as unknown as BoardObject<ContoursProps>,
  ...boxed(() => CONT_BOX),
  // Точку M тянут без выделения.
  hitPriority: 1,
  getHandles: (o) => [pointHandle(o, 'Точка M')],
  dragHandle: (o, id, to) => (id === 'M' ? dragPoint(o, to) : null),
  render: (o, ctx) => <ContoursShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'f', label: 'f(x, y) =', maxLength: 200 },
    { kind: 'number', key: 'count', label: 'Линий уровня', min: 2, max: 40, step: 1, slider: true },
    { kind: 'toggle', key: 'heat', label: 'Заливка по высоте' },
    { kind: 'toggle', key: 'grads', label: 'Поле градиентов' },
    { kind: 'number', key: 'x0', label: 'M: x', min: -1e6, max: 1e6, step: 0.5 },
    { kind: 'number', key: 'y0', label: 'M: y', min: -1e6, max: 1e6, step: 0.5 },
    ...RANGE_FIELDS,
  ],
} as ObjectModule<ContoursProps, ReactNode>;

// =====================================================================
//  Векторное поле: линии тока, дивергенция, ротор
// =====================================================================

export const fieldPropsSchema = z.object({
  P: z.string().max(200),
  Q: z.string().max(200),
  ...rangeSchema,
  density: z.number().int().min(5).max(30),
  lines: z.boolean(),
  x0: z.number().finite(),
  y0: z.number().finite(),
});
export type FieldProps = z.infer<typeof fieldPropsSchema>;
const FIELD_BOX: Rect = { x: -50, y: -100, width: PW + 70, height: PH + 120 };

function FieldShape({ o, ctx }: { o: BoardObject<FieldProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const cs = useCompiled([p.P, p.Q]);
  const r: Range2 = { xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax };
  const data = useMemo(() => {
    if (!cs || 'error' in cs || badRange(r)) return null;
    const [P, Q] = cs as [Compiled, Compiled];
    const n = p.density;
    const arrows: { x: number; y: number; vx: number; vy: number; mag: number }[] = [];
    let maxMag = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = r.xMin + ((i + 0.5) / n) * (r.xMax - r.xMin);
        const y = r.yMin + ((j + 0.5) / n) * (r.yMax - r.yMin);
        const vx = P.f(x, y);
        const vy = Q.f(x, y);
        const mag = Math.hypot(vx, vy);
        if (Number.isFinite(mag)) {
          arrows.push({ x, y, vx, vy, mag });
          maxMag = Math.max(maxMag, mag);
        }
      }
    const h = (r.xMax - r.xMin) / 160;
    const seeds = 5;
    const lines = p.lines
      ? Array.from({ length: seeds * seeds }, (_, k) => {
          const x = r.xMin + (((k % seeds) + 0.5) / seeds) * (r.xMax - r.xMin);
          const y = r.yMin + ((Math.floor(k / seeds) + 0.5) / seeds) * (r.yMax - r.yMin);
          return streamline(P.f as F2, Q.f as F2, x, y, r, h, 300);
        })
      : [];
    return { arrows, maxMag, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, p.xMin, p.xMax, p.yMin, p.yMax, p.density, p.lines]);
  if (badRange(r)) return <Status state={{ error: 'пределы: «от» должно быть меньше «до»' }} ink={ink} />;
  if (!cs || 'error' in cs || !data) return <Status state={cs && 'error' in cs ? cs : null} ink={ink} />;
  const [P, Q] = cs as [Compiled, Compiled];
  const m = map2(r);
  const cell = PW / p.density;
  const at = fieldAt(P, Q, p.x0, p.y0);
  const kx = PW / (r.xMax - r.xMin);
  const ky = PH / (r.yMax - r.yMin);
  const Mx = m.X(p.x0);
  const My = m.Y(p.y0);
  const ml = Math.hypot(at.P * kx, at.Q * ky) || 1;
  const big = Math.hypot(at.P, at.Q) > 1e-12;
  const rotSign = Math.abs(at.rot) < 1e-6 ? 0 : Math.sign(at.rot);
  const divSign = Math.abs(at.div) < 1e-6 ? 0 : Math.sign(at.div);
  return (
    <Group listening={false}>
      <PlaneFrame r={r} ink={ink} muted={muted} />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        {data.lines.map((pts, i) => (
          <Line key={i} points={pts.flatMap(([x, y]) => [m.X(x), m.Y(y)])} stroke={LINE} opacity={0.55} strokeWidth={1.3} strokeScaleEnabled={false} listening={false} />
        ))}
        {data.arrows.map((a, i) => {
          const px = a.vx * kx;
          const py = -a.vy * ky;
          const l = Math.hypot(px, py);
          if (!(l > 1e-12)) return null;
          const L = cell * 0.75;
          const col = heightColor(data.maxMag > 0 ? a.mag / data.maxMag : 0, 0.55);
          return <Arrow key={i} points={[m.X(a.x) - (px / l) * L * 0.5, m.Y(a.y) - (py / l) * L * 0.5, m.X(a.x) + (px / l) * L * 0.5, m.Y(a.y) + (py / l) * L * 0.5]} stroke={col} fill={col} strokeWidth={1.3} strokeScaleEnabled={false} pointerLength={5 / zoom} pointerWidth={4 / zoom} listening={false} />;
        })}
        {big && <Arrow points={[Mx, My, Mx + ((at.P * kx) / ml) * 60, My - ((at.Q * ky) / ml) * 60]} stroke={GRAD} fill={GRAD} strokeWidth={2.6} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />}
        {/* Малый контур вокруг M: вращение (ротор) и поток наружу/внутрь (дивергенция). */}
        <Circle x={Mx} y={My} radius={24} stroke={ink} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
        {rotSign !== 0 && (
          <Shape
            sceneFunc={(cx, shape) => {
              const g = raw(cx);
              // На экране y вниз: «против часовой» — убывание угла.
              const a0 = -Math.PI / 2;
              const a1 = a0 - rotSign * Math.PI * 1.2;
              g.beginPath();
              g.arc(Mx, My, 24, a0, a1, rotSign > 0);
              const ex = Mx + 24 * Math.cos(a1);
              const ey = My + 24 * Math.sin(a1);
              const tx = -Math.sin(a1) * -rotSign;
              const ty = Math.cos(a1) * -rotSign;
              g.moveTo(ex + tx * 7 - ty * 4, ey + ty * 7 + tx * 4);
              g.lineTo(ex, ey);
              g.lineTo(ex + tx * 7 + ty * 4, ey + ty * 7 - tx * 4);
              cx.strokeShape(shape);
            }}
            stroke="#7c3aed"
            strokeWidth={2.2}
            strokeScaleEnabled={false}
            listening={false}
          />
        )}
        {divSign !== 0 &&
          [0, 1, 2, 3].map((k) => {
            const a = (k * Math.PI) / 2 + Math.PI / 4;
            const r1 = divSign > 0 ? 26 : 40;
            const r2 = divSign > 0 ? 40 : 26;
            return <Arrow key={k} points={[Mx + Math.cos(a) * r1, My + Math.sin(a) * r1, Mx + Math.cos(a) * r2, My + Math.sin(a) * r2]} stroke="#16a34a" fill="#16a34a" strokeWidth={1.8} strokeScaleEnabled={false} pointerLength={6 / zoom} pointerWidth={5 / zoom} listening={false} />;
          })}
      </Group>
      <Circle x={Mx} y={My} radius={5} fill="#ffffff" stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Text x={Mx + 8} y={My + 4} text="M" fontSize={15} {...italic} fill={ink} listening={false} />
      <Lines
        x={-40}
        y={-96}
        ink={ink}
        muted={muted}
        lines={[
          `Векторное поле F = (P; Q) = (${p.P}; ${p.Q})`,
          `M(${num(p.x0)}; ${num(p.y0)}):  F = (${num(at.P)}; ${num(at.Q)}),  |F| = ${num(Math.hypot(at.P, at.Q))}`,
          `div F = ∂P/∂x + ∂Q/∂y = ${num(at.div)},   rot F = ∂Q/∂x − ∂P/∂y = ${num(at.rot)}`,
          fieldMeaning(at.div, at.rot),
        ]}
      />
    </Group>
  );
}

export const fieldModule: ObjectModule<FieldProps, ReactNode> = {
  type: FIELD_TYPE,
  title: 'Векторное поле',
  version: 1,
  propsSchema: fieldPropsSchema,
  createProps: () => ({ P: '-y', Q: 'x', xMin: -4, xMax: 4, yMin: -4, yMax: 4, density: 15, lines: true, x0: 2, y0: 1 }),
  deserialize: (r) => r as unknown as BoardObject<FieldProps>,
  ...boxed(() => FIELD_BOX),
  hitPriority: 1,
  getHandles: (o) => [pointHandle(o, 'Точка M')],
  dragHandle: (o, id, to) => (id === 'M' ? dragPoint(o, to) : null),
  render: (o, ctx) => <FieldShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'P', label: 'P(x, y) =', maxLength: 200 },
    { kind: 'text', key: 'Q', label: 'Q(x, y) =', maxLength: 200 },
    { kind: 'toggle', key: 'lines', label: 'Линии тока' },
    { kind: 'number', key: 'density', label: 'Стрелок в ряду', min: 5, max: 30, step: 1, slider: true },
    { kind: 'number', key: 'x0', label: 'M: x', min: -1e6, max: 1e6, step: 0.5 },
    { kind: 'number', key: 'y0', label: 'M: y', min: -1e6, max: 1e6, step: 0.5 },
    ...RANGE_FIELDS,
  ],
} as ObjectModule<FieldProps, ReactNode>;

// =====================================================================
//  Поверхность z = f(x, y)
// =====================================================================

export const surfacePropsSchema = z.object({
  f: z.string().max(200),
  ...rangeSchema,
  /** Число клеток сетки по каждой оси. */
  n: z.number().int().min(6).max(48),
  yaw: z.number().finite().min(-180).max(180),
  pitch: z.number().finite().min(5).max(90),
  floor: z.boolean(),
  tangent: z.boolean(),
  x0: z.number().finite(),
  y0: z.number().finite(),
});
export type SurfaceProps = z.infer<typeof surfacePropsSchema>;
/** Половина ребра куба на рисунке, пикс. */
const S = 150;
const YAW_Y = 330;
const PITCH_X = 300;
const pitchY = (p: number) => 150 - p * 3;
const SURF_BOX: Rect = { x: -260, y: -400, width: 600, height: 760 };

/** Рисунок поверхности: клетки от дальних к ближним, освещение по нормали. */
export function surfaceQuads(f: F2, r: Range2, n: number, yaw: number, pitch: number) {
  const g = sampleGrid(f, r, n);
  const [lo, hi] = zRange(g);
  const nz = (v: number) => Math.max(-1, Math.min(1, ((v - lo) / (hi - lo)) * 2 - 1));
  const P = (i: number, j: number) => {
    const x = (i / n) * 2 - 1;
    const y = (j / n) * 2 - 1;
    const v = g.v[i]![j]!;
    return { x, y, z: Number.isFinite(v) ? nz(v) : NaN };
  };
  const view = { yaw, pitch };
  const L = [-0.4, -0.5, 0.77];
  const quads: { pts: number[]; depth: number; color: string }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const c = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      if (c.some((q) => !Number.isFinite(q.z))) continue;
      const pr = c.map((q) => project(view, q.x, q.y, q.z));
      // Нормаль клетки по диагоналям.
      const ax = c[2]!.x - c[0]!.x;
      const ay = c[2]!.y - c[0]!.y;
      const az = c[2]!.z - c[0]!.z;
      const bx = c[3]!.x - c[1]!.x;
      const by = c[3]!.y - c[1]!.y;
      const bz = c[3]!.z - c[1]!.z;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nzv = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nzv) || 1;
      const light = 0.35 + 0.65 * Math.abs((nx * L[0]! + ny * L[1]! + nzv * L[2]!) / nl);
      const zm = (c[0]!.z + c[1]!.z + c[2]!.z + c[3]!.z) / 4;
      quads.push({ pts: pr.flatMap((q) => [q.u * S, -q.up * S]), depth: pr.reduce((s, q) => s + q.depth, 0) / 4, color: heightColor((zm + 1) / 2, light) });
    }
  quads.sort((a, b) => b.depth - a.depth);
  return { quads, g, lo, hi, nz };
}

function SurfaceShape({ o, ctx }: { o: BoardObject<SurfaceProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const cs = useCompiled([p.f]);
  const r: Range2 = { xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax };
  const data = useMemo(() => {
    if (!cs || 'error' in cs || badRange(r)) return null;
    const s = surfaceQuads(cs[0]!.f, r, p.n, p.yaw, p.pitch);
    const lv = p.floor ? levels(s.g.min, s.g.max, 8).map((c) => ({ c, seg: contour(s.g, r, c) })) : [];
    return { ...s, lv };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, p.xMin, p.xMax, p.yMin, p.yMax, p.n, p.yaw, p.pitch, p.floor]);
  if (badRange(r)) return <Status state={{ error: 'пределы: «от» должно быть меньше «до»' }} ink={ink} />;
  if (!cs || 'error' in cs || !data) return <Status state={cs && 'error' in cs ? cs : null} ink={ink} />;
  const c = cs[0]!;
  const view = { yaw: p.yaw, pitch: p.pitch };
  const nx = (x: number) => ((x - r.xMin) / (r.xMax - r.xMin)) * 2 - 1;
  const ny = (y: number) => ((y - r.yMin) / (r.yMax - r.yMin)) * 2 - 1;
  const at = (x: number, y: number, z: number) => {
    const q = project(view, x, y, z);
    return [q.u * S, -q.up * S] as [number, number];
  };
  const O = at(-1, -1, -1);
  const z0 = c.f(p.x0, p.y0);
  const gx = c.fx(p.x0, p.y0);
  const gy = c.fy(p.x0, p.y0);
  const inside = p.x0 >= r.xMin && p.x0 <= r.xMax && p.y0 >= r.yMin && p.y0 <= r.yMax && Number.isFinite(z0);
  const M = at(nx(p.x0), ny(p.y0), data.nz(z0));
  const Mf = at(nx(p.x0), ny(p.y0), -1);
  // Касательная плоскость: z = z₀ + fx(x − x₀) + fy(y − y₀) на квадрате ±15 % пределов.
  const dx = (r.xMax - r.xMin) * 0.15;
  const dy = (r.yMax - r.yMin) * 0.15;
  const plane = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const x = p.x0 + sx! * dx;
    const y = p.y0 + sy! * dy;
    return at(nx(x), ny(y), (((z0 + gx * (x - p.x0) + gy * (y - p.y0)) - data.lo) / (data.hi - data.lo)) * 2 - 1);
  });
  const gl = Math.hypot(gx / (r.xMax - r.xMin), gy / (r.yMax - r.yMin));
  const G = gl > 1e-12 ? at(nx(p.x0) + (gx / (r.xMax - r.xMin) / gl) * 0.45, ny(p.y0) + (gy / (r.yMax - r.yMin) / gl) * 0.45, -1) : Mf;
  const axis = (to: [number, number, number], label: string) => {
    const e = at(...to);
    return (
      <Group key={label}>
        <Arrow points={[O[0], O[1], e[0], e[1]]} stroke={ink} fill={ink} strokeWidth={1.3} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
        <Text x={e[0] + 4} y={e[1] - 16} text={label} fontSize={16} {...italic} fill={ink} listening={false} />
      </Group>
    );
  };
  const floorPts = [at(-1, -1, -1), at(1, -1, -1), at(1, 1, -1), at(-1, 1, -1)];
  return (
    <Group listening={false}>
      <Line points={floorPts.flat()} closed stroke={muted} strokeWidth={1} fill={muted} opacity={0.12} strokeScaleEnabled={false} listening={false} />
      {data.lv.map(({ c: lv, seg }) => (
        <Shape
          key={lv}
          sceneFunc={(cx, shape) => {
            const g = raw(cx);
            g.beginPath();
            for (let i = 0; i < seg.length; i += 4) {
              const a = at(nx(seg[i]!), ny(seg[i + 1]!), -1);
              const b = at(nx(seg[i + 2]!), ny(seg[i + 3]!), -1);
              g.moveTo(a[0], a[1]);
              g.lineTo(b[0], b[1]);
            }
            cx.strokeShape(shape);
          }}
          stroke={heightColor((lv - data.g.min) / (data.g.max - data.g.min || 1), 0.6)}
          strokeWidth={1.2}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {p.tangent && inside && gl > 1e-12 && <Arrow points={[Mf[0], Mf[1], G[0], G[1]]} stroke={GRAD} fill={GRAD} strokeWidth={2.4} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />}
      {axis([1.25, -1, -1], 'x')}
      {axis([-1, 1.25, -1], 'y')}
      {axis([-1, -1, 1.25], 'z')}
      <Shape
        sceneFunc={(cx) => {
          const g = raw(cx);
          g.lineWidth = 0.6 / zoom;
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          for (const q of data.quads) {
            g.beginPath();
            g.moveTo(q.pts[0]!, q.pts[1]!);
            for (let k = 2; k < 8; k += 2) g.lineTo(q.pts[k]!, q.pts[k + 1]!);
            g.closePath();
            g.fillStyle = q.color;
            g.fill();
            g.stroke();
          }
        }}
        listening={false}
      />
      {p.tangent && inside && (
        <Group listening={false}>
          <Line points={plane.flat()} closed fill="#facc15" opacity={0.55} stroke="#a16207" strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
          <Line points={[Mf[0], Mf[1], M[0], M[1]]} stroke={ink} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
          <Circle x={M[0]} y={M[1]} radius={5} fill="#ffffff" stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
          <Text x={M[0] + 8} y={M[1] - 18} text="M" fontSize={15} {...italic} fill={ink} listening={false} />
        </Group>
      )}
      {/* Ползунки поворота: по горизонтали — вокруг оси z, по вертикали — наклон. */}
      <Line points={[-180, YAW_Y, 180, YAW_Y]} stroke={muted} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Circle x={p.yaw} y={YAW_Y} radius={8} fill={ctx.resolveColor('accent-1')} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text x={-180} y={YAW_Y + 10} text={`поворот ${num(p.yaw)}°`} fontSize={11} fill={muted} listening={false} />
      <Line points={[PITCH_X, pitchY(0), PITCH_X, pitchY(90)]} stroke={muted} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Circle x={PITCH_X} y={pitchY(p.pitch)} radius={8} fill={ctx.resolveColor('accent-1')} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text x={PITCH_X - 30} y={pitchY(0) + 12} width={60} align="center" text={`наклон ${num(p.pitch)}°`} fontSize={11} fill={muted} listening={false} />
      <Lines
        x={-250}
        y={-396}
        ink={ink}
        muted={muted}
        lines={[
          `z = ${p.f},  x ∈ [${num(r.xMin)}; ${num(r.xMax)}], y ∈ [${num(r.yMin)}; ${num(r.yMax)}], z от ${num(data.g.min)} до ${num(data.g.max)}`,
          inside ? `M(${num(p.x0)}; ${num(p.y0)}; ${num(z0)}):  ∂z/∂x = ${num(gx)},  ∂z/∂y = ${num(gy)}` : 'Точка M вне области',
          inside && p.tangent ? `Касательная плоскость: z = ${num(z0)} ${gx < 0 ? '−' : '+'} ${num(Math.abs(gx))}(x − ${num(p.x0)}) ${gy < 0 ? '−' : '+'} ${num(Math.abs(gy))}(y − ${num(p.y0)})` : '',
          p.floor ? 'На «полу» — линии уровня, красная стрелка — градиент' : '',
        ].filter(Boolean)}
      />
    </Group>
  );
}

export const surfaceModule: ObjectModule<SurfaceProps, ReactNode> = {
  type: SURFACE_TYPE,
  title: 'Поверхность z = f(x, y)',
  version: 1,
  propsSchema: surfacePropsSchema,
  createProps: () => ({ f: 'x^2 - y^2', xMin: -2, xMax: 2, yMin: -2, yMax: 2, n: 24, yaw: 35, pitch: 30, floor: true, tangent: true, x0: 1, y0: 0.5 }),
  deserialize: (r) => r as unknown as BoardObject<SurfaceProps>,
  ...boxed(() => SURF_BOX),
  // Поворот — ползунками на рисунке, без выделения.
  hitPriority: 1,
  getHandles: (o) => [
    { id: 'yaw', kind: 'param', position: toWorld(o, { x: o.props.yaw, y: YAW_Y }), label: 'Поворот', snap: false },
    { id: 'pitch', kind: 'param', position: toWorld(o, { x: PITCH_X, y: pitchY(o.props.pitch) }), label: 'Наклон', snap: false },
  ],
  dragHandle: (o, id, to) => {
    const q = toLocal(o, to);
    if (id === 'yaw') return { props: { yaw: Math.round(Math.max(-180, Math.min(180, q.x))) } };
    if (id === 'pitch') return { props: { pitch: Math.round(Math.max(5, Math.min(90, (150 - q.y) / 3))) } };
    return null;
  },
  render: (o, ctx) => <SurfaceShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'f', label: 'z = f(x, y) =', maxLength: 200 },
    { kind: 'toggle', key: 'tangent', label: 'Касательная плоскость в M' },
    { kind: 'toggle', key: 'floor', label: 'Линии уровня внизу' },
    { kind: 'number', key: 'x0', label: 'M: x', min: -1e6, max: 1e6, step: 0.25 },
    { kind: 'number', key: 'y0', label: 'M: y', min: -1e6, max: 1e6, step: 0.25 },
    { kind: 'number', key: 'n', label: 'Сетка', min: 6, max: 48, step: 2, slider: true },
    { kind: 'number', key: 'yaw', label: 'Поворот, °', min: -180, max: 180, step: 5, slider: true },
    { kind: 'number', key: 'pitch', label: 'Наклон, °', min: 5, max: 90, step: 5, slider: true },
    ...RANGE_FIELDS,
  ],
} as ObjectModule<SurfaceProps, ReactNode>;

export const multivarModules = [surfaceModule, contoursModule, fieldModule];
