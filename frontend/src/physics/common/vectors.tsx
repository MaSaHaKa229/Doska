import type { ReactNode } from 'react';
import { Arrow, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point, RenderContext, ResolveContext } from '@doska/shared';
import { resolveColor, type CanvasTheme } from '../../objects/colors';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { QUANTITIES, QUANTITY_INFO, fmt, plainLabel, splitLabel, vectorValues, type Quantity } from './quantities';

export const PLUGIN_ID = 'physics.common';
export const VECTOR_TYPE = `${PLUGIN_ID}.vector`;
export const SUM_TYPE = `${PLUGIN_ID}.sum`;

const LABEL = 18;
/** Доля длины вектора, у которой стоит подпись. */
const LABEL_AT = 0.85;
const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);

// =====================================================================
//  Подпись вектора: буква со стрелкой сверху и нижним индексом
// =====================================================================

export function VecLabel({ x, y, label, color, size = LABEL, arrow = true }: { x: number; y: number; label: string; color: string; size?: number; arrow?: boolean }) {
  const { main, sub } = splitLabel(label);
  if (!main) return null;
  const w = main.length * size * 0.55;
  return (
    <Group x={x} y={y} listening={false}>
      <Text text={main} fontSize={size} fontStyle="italic" fontFamily="Times New Roman, serif" fill={color} listening={false} />
      {sub && <Text x={w + 1} y={size * 0.55} text={sub} fontSize={size * 0.62} fontFamily="Times New Roman, serif" fill={color} listening={false} />}
      {arrow && <Arrow points={[1, -2, w + 2, -2]} stroke={color} fill={color} strokeWidth={1.1} pointerLength={size * 0.22} pointerWidth={size * 0.18} listening={false} />}
    </Group>
  );
}

const labelSvg = (x: number, y: number, label: string, color: string, size = LABEL) => {
  const { main, sub } = splitLabel(label);
  const w = main.length * size * 0.55;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<text x="${x}" y="${y + size * 0.85}" font-size="${size}" font-style="italic" font-family="Times New Roman, serif" fill="${color}">${esc(main)}${sub ? `<tspan font-size="${size * 0.62}" dy="${size * 0.25}">${esc(sub)}</tspan>` : ''}</text><line x1="${x + 1}" y1="${y - 2}" x2="${x + w + 2}" y2="${y - 2}" stroke="${color}" stroke-width="1.1"/>`;
};

// =====================================================================
//  Вектор величины
// =====================================================================

export const vectorPropsSchema = z.object({
  q: z.enum(QUANTITIES),
  /** Обозначение: «F», «F_тр» (после «_» — нижний индекс), «mg». */
  label: z.string().max(12),
  /** Конец вектора относительно начала (точки приложения). */
  dx: z.number().finite().min(-1e6).max(1e6),
  dy: z.number().finite().min(-1e6).max(1e6),
  color: z.string().max(32),
  width: z.number().finite().min(1).max(8),
  /** Масштаб: сколько единиц величины в одной клетке; 0 — значение не показывается. */
  perCell: z.number().finite().min(0).max(1e9),
  showValue: z.boolean(),
  /** Разложение по осям, повёрнутым на axisAngle градусов против часовой стрелки. */
  decompose: z.boolean(),
  axisAngle: z.number().finite().min(-360).max(360),
});
export type VectorProps = z.infer<typeof vectorPropsSchema>;
type VectorObject = BoardObject<VectorProps>;

export const unitOf = (q: Quantity) => QUANTITY_INFO[q].unit;

/** Подпись значения: «F = 6 Н». */
export function valueText(p: Pick<VectorProps, 'q' | 'label' | 'perCell'>, value: number, extra = ''): string {
  const u = unitOf(p.q);
  return `${plainLabel(p.label, extra)} = ${fmt(value)}${u ? ` ${u}` : ''}`;
}

/** Нормаль к вектору «слева» (на доске) — сторона подписи. */
const leftNormal = (dx: number, dy: number) => {
  const l = Math.hypot(dx, dy) || 1;
  return { x: dy / l, y: -dx / l };
};

/** Составляющие вектора по осям: концы на доске (в локальных координатах вектора). */
export function components(p: VectorProps): { cx: Point; cy: Point } {
  const t = (p.axisAngle * Math.PI) / 180;
  const u = { x: Math.cos(t), y: -Math.sin(t) };
  const w = { x: -Math.sin(t), y: -Math.cos(t) };
  const a = p.dx * u.x + p.dy * u.y;
  const b = p.dx * w.x + p.dy * w.y;
  return { cx: { x: u.x * a, y: u.y * a }, cy: { x: w.x * b, y: w.y * b } };
}

function VectorShape({ o, ctx }: { o: VectorObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const c = ctx.resolveColor(p.color);
  const n = leftNormal(p.dx, p.dy);
  // Подпись — у конца вектора, слева от него (как в учебнике).
  const lx = p.dx * LABEL_AT + n.x * 16 - LABEL * 0.3;
  const ly = p.dy * LABEL_AT + n.y * 16 - LABEL * 0.5;
  const v = vectorValues(p.dx, p.dy, p.perCell, p.axisAngle);
  const head = { pointerLength: 12 / zoom, pointerWidth: 9 / zoom };
  const els: ReactNode[] = [];
  if (p.decompose) {
    const { cx, cy } = components(p);
    const dash = [5 / zoom, 4 / zoom];
    els.push(
      <Line key="px" points={[p.dx, p.dy, cx.x, cx.y]} stroke={c} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />,
      <Line key="py" points={[p.dx, p.dy, cy.x, cy.y]} stroke={c} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />,
    );
    for (const [k, e, sfx, val] of [['ax', cx, 'x', v.x], ['ay', cy, 'y', v.y]] as const) {
      if (Math.hypot(e.x, e.y) < 2) continue;
      els.push(<Arrow key={k} points={[0, 0, e.x, e.y]} stroke={c} fill={c} opacity={0.75} strokeWidth={1.5} strokeScaleEnabled={false} {...head} listening={false} />);
      const m = leftNormal(e.x, e.y);
      const sub = splitLabel(p.label).sub;
      els.push(<VecLabel key={`l${k}`} x={e.x * 0.5 - m.x * 14 - LABEL * 0.3} y={e.y * 0.5 - m.y * 14 - LABEL * 0.4} label={`${splitLabel(p.label).main}_${sub}${sfx}`} color={c} size={LABEL * 0.85} arrow={false} />);
      if (p.showValue && p.perCell > 0)
        els.push(<Text key={`v${k}`} x={e.x * 0.5 - m.x * 14 - LABEL * 0.3} y={e.y * 0.5 - m.y * 14 + LABEL * 0.6} text={valueText(p, val, sfx)} fontSize={LABEL * 0.65} fill={c} listening={false} />);
    }
  }
  return (
    <Group listening={false}>
      {els}
      <Arrow points={[0, 0, p.dx, p.dy]} stroke={c} fill={c} strokeWidth={p.width} strokeScaleEnabled={false} {...head} listening={false} />
      <VecLabel x={lx} y={ly} label={p.label} color={c} />
      {p.showValue && p.perCell > 0 && <Text x={lx} y={ly + LABEL * 1.15} text={valueText(p, v.len)} fontSize={LABEL * 0.7} fill={c} listening={false} />}
    </Group>
  );
}

function segDist(q: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
}

/** Поворот на 15° с Shift: конец вектора — по ближайшему кратному углу. */
function snapAngle(dx: number, dy: number): Point {
  const l = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: Math.cos(a) * l, y: Math.sin(a) * l };
}

export const vectorModule: ObjectModule<VectorProps, ReactNode> = {
  type: VECTOR_TYPE,
  title: 'Вектор величины',
  version: 1,
  propsSchema: vectorPropsSchema,
  createProps: () => ({ q: 'force', label: 'F', dx: 80, dy: 0, color: 'accent-1', width: 2.5, perCell: 0, showValue: true, decompose: false, axisAngle: 0 }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as VectorObject,
  getLocalBounds: (o) => {
    const p = o.props;
    const pad = 28;
    const x = Math.min(0, p.dx) - pad;
    const y = Math.min(0, p.dy) - pad;
    return { x, y, width: Math.abs(p.dx) + pad * 2, height: Math.abs(p.dy) + pad * 2 };
  },
  hitTest: (o, point, tol) => segDist(toLocal(o, point), { x: 0, y: 0 }, { x: o.props.dx, y: o.props.dy }) <= tol + 4,
  hitTestRect: (o, rect, mode) => {
    const a = toWorld(o, { x: 0, y: 0 });
    const b = toWorld(o, { x: o.props.dx, y: o.props.dy });
    const inside = (q: Point) => q.x >= rect.x && q.y >= rect.y && q.x <= rect.x + rect.width && q.y <= rect.y + rect.height;
    return mode === 'contain' ? inside(a) && inside(b) : inside(a) || inside(b);
  },
  getHandles: (o) => [
    { id: 'tip', kind: 'point', position: toWorld(o, { x: o.props.dx, y: o.props.dy }), label: 'Конец вектора (Shift — через 15°)' },
    { id: 'tail', kind: 'point', position: toWorld(o, { x: 0, y: 0 }), label: 'Точка приложения' },
  ],
  dragHandle: (o, id, to, mods) => {
    if (id === 'tip') {
      const l = toLocal(o, to);
      const d = mods.shift ? snapAngle(l.x, l.y) : l;
      return { props: { dx: d.x, dy: d.y } };
    }
    if (id === 'tail') {
      const tip = toWorld(o, { x: o.props.dx, y: o.props.dy });
      const d = mods.shift ? snapAngle(tip.x - to.x, tip.y - to.y) : { x: tip.x - to.x, y: tip.y - to.y };
      return { x: tip.x - d.x, y: tip.y - d.y, props: { dx: d.x, dy: d.y } };
    }
    return null;
  },
  getSnapPoints: (o) => [
    { kind: 'anchor', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'endpoint', point: toWorld(o, { x: o.props.dx, y: o.props.dy }) },
  ],
  render: (o, ctx) => <VectorShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const p = o.props;
    const c = ctx.resolveColor(p.color);
    const a = toWorld(o, { x: 0, y: 0 });
    const b = toWorld(o, { x: p.dx, y: p.dy });
    const l = Math.hypot(p.dx, p.dy) || 1;
    const ux = p.dx / l;
    const uy = p.dy / l;
    const h = `${b.x},${b.y} ${b.x - ux * 12 - uy * 4.5},${b.y - uy * 12 + ux * 4.5} ${b.x - ux * 12 + uy * 4.5},${b.y - uy * 12 - ux * 4.5}`;
    const n = leftNormal(p.dx, p.dy);
    return `<g><line x1="${a.x}" y1="${a.y}" x2="${b.x - ux * 10}" y2="${b.y - uy * 10}" stroke="${c}" stroke-width="${p.width}"/><polygon points="${h}" fill="${c}"/>${labelSvg(a.x + p.dx * LABEL_AT + n.x * 16 - LABEL * 0.3, a.y + p.dy * LABEL_AT + n.y * 16 - LABEL * 0.5, p.label, c)}</g>`;
  },
  inspector: [
    { kind: 'text', key: 'label', label: 'Обозначение (F_тр — индекс)', maxLength: 12 },
    { kind: 'number', key: 'perCell', label: 'Ед. в клетке', min: 0, step: 0.5 },
    { kind: 'toggle', key: 'showValue', label: 'Значение' },
    { kind: 'toggle', key: 'decompose', label: 'Проекции' },
    { kind: 'number', key: 'axisAngle', label: 'Поворот осей, °', min: -360, max: 360, step: 5 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Сумма векторов (равнодействующая)
// =====================================================================

export const sumPropsSchema = z.object({ label: z.string().max(12), color: z.string().max(32), showValue: z.boolean() });
export type SumProps = z.infer<typeof sumPropsSchema>;
type SumObject = BoardObject<SumProps>;

interface SumGeom {
  tail: Point;
  tip: Point;
  /** Вспомогательные пунктирные линии (параллелограмм или цепочка). */
  guides: [Point, Point][];
  /** Перенесённые копии слагаемых (правило многоугольника). */
  copies: { a: Point; b: Point; color: string }[];
  first: VectorObject;
  sameQuantity: boolean;
}

export function sumGeom(o: SumObject, ctx: ResolveContext): SumGeom | null {
  const vs = o.deps.map((d) => ctx.getObject(d)).filter((v): v is VectorObject => v?.type === VECTOR_TYPE) as VectorObject[];
  if (vs.length < 2 || vs.length !== o.deps.length) return null;
  const tail = toWorld(vs[0]!, { x: 0, y: 0 });
  const d = (v: VectorObject) => {
    const a = toWorld(v, { x: 0, y: 0 });
    const b = toWorld(v, { x: v.props.dx, y: v.props.dy });
    return { x: b.x - a.x, y: b.y - a.y, a };
  };
  const ds = vs.map(d);
  const tip = { x: tail.x + ds.reduce((s, q) => s + q.x, 0), y: tail.y + ds.reduce((s, q) => s + q.y, 0) };
  const guides: [Point, Point][] = [];
  const copies: SumGeom['copies'] = [];
  const common = ds.every((q) => Math.hypot(q.a.x - tail.x, q.a.y - tail.y) < 1);
  if (vs.length === 2 && common) {
    // Правило параллелограмма.
    const t1 = { x: tail.x + ds[0]!.x, y: tail.y + ds[0]!.y };
    const t2 = { x: tail.x + ds[1]!.x, y: tail.y + ds[1]!.y };
    guides.push([t1, tip], [t2, tip]);
  } else {
    // Правило многоугольника: слагаемые переносятся «конец к началу».
    let at = { x: tail.x + ds[0]!.x, y: tail.y + ds[0]!.y };
    for (let i = 1; i < vs.length; i++) {
      const next = { x: at.x + ds[i]!.x, y: at.y + ds[i]!.y };
      if (Math.hypot(ds[i]!.a.x - at.x, ds[i]!.a.y - at.y) > 1) copies.push({ a: at, b: next, color: vs[i]!.props.color });
      at = next;
    }
  }
  return { tail, tip, guides, copies, first: vs[0]!, sameQuantity: vs.every((v) => v.props.q === vs[0]!.props.q && v.props.perCell === vs[0]!.props.perCell) };
}

function SumShape({ o, ctx }: { o: SumObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const g = sumGeom(o, ctx);
  if (!g) return null;
  const c = ctx.resolveColor(o.props.color);
  const dash = [6 / zoom, 4 / zoom];
  const head = { pointerLength: 12 / zoom, pointerWidth: 9 / zoom };
  const dx = g.tip.x - g.tail.x;
  const dy = g.tip.y - g.tail.y;
  const n = leftNormal(dx, dy);
  const lx = g.tail.x + dx * 0.5 + n.x * 18 - LABEL * 0.3;
  const ly = g.tail.y + dy * 0.5 + n.y * 18 - LABEL * 0.5;
  const fp = g.first.props;
  const value = Math.hypot(dx, dy) * (fp.perCell / 20);
  return (
    <Group listening={false}>
      {g.guides.map(([a, b], i) => (
        <Line key={`g${i}`} points={[a.x, a.y, b.x, b.y]} stroke={c} strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />
      ))}
      {g.copies.map((k, i) => (
        <Arrow key={`c${i}`} points={[k.a.x, k.a.y, k.b.x, k.b.y]} stroke={ctx.resolveColor(k.color)} fill={ctx.resolveColor(k.color)} opacity={0.6} strokeWidth={1.5} dash={dash} strokeScaleEnabled={false} {...head} listening={false} />
      ))}
      <Arrow points={[g.tail.x, g.tail.y, g.tip.x, g.tip.y]} stroke={c} fill={c} strokeWidth={3} strokeScaleEnabled={false} {...head} listening={false} />
      <VecLabel x={lx} y={ly} label={o.props.label} color={c} />
      {o.props.showValue && g.sameQuantity && fp.perCell > 0 && <Text x={lx} y={ly + LABEL * 1.15} text={valueText({ ...fp, label: o.props.label }, value)} fontSize={LABEL * 0.7} fill={c} listening={false} />}
    </Group>
  );
}

export const sumModule: ObjectModule<SumProps, ReactNode> = {
  type: SUM_TYPE,
  title: 'Сумма векторов',
  version: 1,
  propsSchema: sumPropsSchema,
  createProps: () => ({ label: 'R', color: 'accent-5', showValue: true }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as SumObject,
  derived: true,
  getLocalBounds: (o, ctx) => {
    const g = sumGeom(o, ctx);
    if (!g) return { x: 0, y: 0, width: 0, height: 0 };
    const pts = [g.tail, g.tip, ...g.guides.flat(), ...g.copies.flatMap((k) => [k.a, k.b])];
    const x = Math.min(...pts.map((q) => q.x)) - 24;
    const y = Math.min(...pts.map((q) => q.y)) - 24;
    return { x, y, width: Math.max(...pts.map((q) => q.x)) + 24 - x, height: Math.max(...pts.map((q) => q.y)) + 24 - y };
  },
  hitTest: (o, point, tol, ctx) => {
    const g = sumGeom(o, ctx);
    return !!g && segDist(point, g.tail, g.tip) <= tol + 4;
  },
  getHandles: () => [],
  getSnapPoints: (o, ctx) => {
    const g = sumGeom(o, ctx);
    return g ? [{ kind: 'endpoint', point: g.tip }] : [];
  },
  render: (o, ctx) => <SumShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const g = sumGeom(o, ctx);
    if (!g) return '';
    const c = resolveColor(o.props.color, ctx.theme as CanvasTheme);
    return `<g><line x1="${g.tail.x}" y1="${g.tail.y}" x2="${g.tip.x}" y2="${g.tip.y}" stroke="${c}" stroke-width="3"/>${labelSvg((g.tail.x + g.tip.x) / 2, (g.tail.y + g.tip.y) / 2 - 24, o.props.label, c)}</g>`;
  },
  inspector: [
    { kind: 'text', key: 'label', label: 'Обозначение', maxLength: 12 },
    { kind: 'toggle', key: 'showValue', label: 'Значение' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  hitPriority: 1,
};
