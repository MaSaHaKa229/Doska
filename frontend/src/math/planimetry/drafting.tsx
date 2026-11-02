import type { ReactNode } from 'react';
import { Circle, Group, Line, Rect as KRect, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point, ToolContext, ToolModule } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { SURFACE_COLORS } from '../../objects/colors';
import { useBoard } from '../../store/board';
import { add, angleOf, arcPoints, dist, distToLinear, mid, normAngle, polar } from './geometry';
import { isPointType, PLUGIN_ID, POINT_TYPE } from './eval';
import { figureType, pointModule, UNIT, type FigureProps, type PointProps } from './objects';
import { nextLabels, usedLabels, type ToolOptionsView } from './tools';

/**
 * Чертёжные инструменты (6.1c): линейка, транспортир, циркуль. Это объекты
 * доски — их видят все участники, двигают выделением, учитель может
 * закрепить (Ctrl+L), убрать — Delete. Поворот — своей ручкой.
 */

export const RULER_TYPE = `${PLUGIN_ID}.ruler`;
export const PROTRACTOR_TYPE = `${PLUGIN_ID}.protractor`;
export const COMPASS_TYPE = `${PLUGIN_ID}.compass`;
export const SECTION_DRAFTING = `${PLUGIN_ID}.drafting`;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const DEG = Math.PI / 180;

/** Поворот к курсору: угол ручки относительно опорной точки; Shift — шаг 15°. */
function rotationTo(center: Point, to: Point, handleAngle: number, shift: boolean): number {
  let r = angleOf(center, to) - handleAngle;
  if (shift) r = Math.round(r / (15 * DEG)) * 15 * DEG;
  return r;
}

const fill = (theme: keyof typeof SURFACE_COLORS) => SURFACE_COLORS[theme].paper;

// =====================================================================
//  Линейка
// =====================================================================

const RULER_H = 56;

export const rulerPropsSchema = z.object({
  /** Длина в клетках сетки. */
  cells: z.number().int().min(4).max(100),
  color: z.string().max(32),
});
export type RulerProps = z.infer<typeof rulerPropsSchema>;
type RulerObject = BoardObject<RulerProps>;

const rulerLen = (p: RulerProps) => p.cells * UNIT;

function RulerShape({ o, theme, color }: { o: RulerObject; theme: keyof typeof SURFACE_COLORS; color: string }) {
  const zoom = useZoom();
  const L = rulerLen(o.props);
  const ticks: number[] = [];
  for (let i = 0; i <= o.props.cells * 2; i++) {
    const x = (i * UNIT) / 2;
    const h = i % 2 === 0 ? (i % 10 === 0 ? 18 : 13) : 7;
    ticks.push(x, 0, x, h, x, 0);
  }
  const labels: ReactNode[] = [];
  for (let i = 0; i <= o.props.cells; i++) {
    labels.push(<Text key={i} x={i * UNIT - 8} y={21} width={16} align="center" text={String(i)} fontSize={10} fill={color} listening={false} />);
  }
  return (
    <Group>
      <KRect width={L} height={RULER_H} fill={fill(theme)} opacity={0.82} stroke={color} strokeWidth={1} strokeScaleEnabled={false} cornerRadius={3} listening={false} />
      <Line points={ticks} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {labels}
      <Text x={L - 92} y={RULER_H - 16} text="клетки" fontSize={10} fill={color} opacity={0.6} listening={false} />
      <Circle x={L - 14} y={RULER_H / 2} radius={7 / zoom} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
    </Group>
  );
}

/** Ручка поворота линейки (локально). */
const rulerRotHandle = (p: RulerProps): Point => ({ x: rulerLen(p) - 14, y: RULER_H / 2 });

export const rulerModule: ObjectModule<RulerProps, ReactNode> = {
  type: RULER_TYPE,
  title: 'Линейка',
  version: 1,
  propsSchema: rulerPropsSchema,
  createProps: () => ({ cells: 20, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as RulerObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: rulerLen(o.props), height: RULER_H }),
  hitTest: (o, point, tolerance) => {
    const p = toLocal(o, point);
    return p.x >= -tolerance && p.y >= -tolerance && p.x <= rulerLen(o.props) + tolerance && p.y <= RULER_H + tolerance;
  },
  getHandles: (o) => [{ id: 'rotate', kind: 'rotate', position: toWorld(o, rulerRotHandle(o.props)), label: 'Повернуть (Shift — шаг 15°)', snap: false }],
  dragHandle: (o, _h, to, m) => {
    const local = rulerRotHandle(o.props);
    return { rotation: rotationTo({ x: o.x, y: o.y }, to, Math.atan2(local.y, local.x), m.shift) };
  },
  // Привязка: ноль и конец шкалы — линейку прикладывают нулём к точке.
  getSnapPoints: (o) => [
    { kind: 'endpoint', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'endpoint', point: toWorld(o, { x: rulerLen(o.props), y: 0 }) },
  ],
  guides: (o) => [
    { a: toWorld(o, { x: 0, y: 0 }), b: toWorld(o, { x: rulerLen(o.props), y: 0 }) },
    { a: toWorld(o, { x: 0, y: RULER_H }), b: toWorld(o, { x: rulerLen(o.props), y: RULER_H }) },
  ],
  render: (o, ctx) => <RulerShape o={o} theme={ctx.theme} color={ctx.resolveColor(o.props.color)} />,
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const tr = `translate(${o.x} ${o.y}) rotate(${o.rotation / DEG})`;
    const ticks = Array.from({ length: o.props.cells + 1 }, (_, i) => `<line x1="${i * UNIT}" y1="0" x2="${i * UNIT}" y2="13" stroke="${c}"/><text x="${i * UNIT - 3}" y="30" font-size="10" fill="${c}">${i}</text>`).join('');
    return `<g transform="${tr}"><rect width="${rulerLen(o.props)}" height="${RULER_H}" fill="${fill(ctx.theme)}" fill-opacity="0.82" stroke="${c}"/>${ticks}</g>`;
  },
  inspector: [
    { kind: 'number', key: 'cells', label: 'Длина, клеток', min: 4, max: 100, step: 1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Транспортир
// =====================================================================

const PR = 150;

export const protractorPropsSchema = z.object({
  /** Угол луча-указателя от правого конца шкалы, градусы 0…180. */
  ray: z.number().finite().min(0).max(180),
  color: z.string().max(32),
});
export type ProtractorProps = z.infer<typeof protractorPropsSchema>;
type ProtractorObject = BoardObject<ProtractorProps>;

/** Точка шкалы транспортира (локально): угол от правого конца против часовой стрелки на экране. */
const scale = (deg: number, r: number): Point => ({ x: r * Math.cos(deg * DEG), y: -r * Math.sin(deg * DEG) });

function ProtractorShape({ o, theme, color }: { o: ProtractorObject; theme: keyof typeof SURFACE_COLORS; color: string }) {
  const zoom = useZoom();
  const arc = arcPoints({ center: { x: 0, y: 0 }, radius: PR, start: 0, sweep: Math.PI }).map((p) => ({ x: p.x, y: p.y }));
  const ticks: number[] = [];
  for (let d = 0; d <= 180; d++) {
    const len = d % 10 === 0 ? 14 : d % 5 === 0 ? 10 : 5;
    const a = scale(d, PR);
    const b = scale(d, PR - len);
    ticks.push(a.x, a.y, b.x, b.y, a.x, a.y);
  }
  const labels: ReactNode[] = [];
  for (let d = 0; d <= 180; d += 10) {
    const outer = scale(d, PR - 24);
    const inner = scale(d, PR - 40);
    labels.push(
      <Text key={`o${d}`} x={outer.x - 10} y={outer.y - 5} width={20} align="center" text={String(d)} fontSize={10} fill={color} listening={false} />,
      <Text key={`i${d}`} x={inner.x - 10} y={inner.y - 5} width={20} align="center" text={String(180 - d)} fontSize={9} fill={color} opacity={0.6} listening={false} />,
    );
  }
  const tip = scale(o.props.ray, PR);
  const lab = scale(o.props.ray, PR * 0.55);
  return (
    <Group>
      <Line points={[...arc.flatMap((p) => [p.x, p.y]), -PR, 0, PR, 0]} closed fill={fill(theme)} opacity={0.82} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Line points={ticks} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {labels}
      <Line points={[-8, 0, 8, 0]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Line points={[0, -8, 0, 4]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Line points={[0, 0, tip.x, tip.y]} stroke="#2a7de1" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text x={lab.x - 20} y={lab.y - 18} width={40} align="center" text={`${Math.round(o.props.ray * 2) / 2}°`.replace('.', ',')} fontSize={14} fontStyle="bold" fill="#2a7de1" listening={false} />
      <Circle x={tip.x * 0.8} y={tip.y * 0.8} radius={6 / zoom} fill="#2a7de1" listening={false} />
      <Circle x={PR + 16} y={0} radius={7 / zoom} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
    </Group>
  );
}

export const protractorModule: ObjectModule<ProtractorProps, ReactNode> = {
  type: PROTRACTOR_TYPE,
  title: 'Транспортир',
  version: 1,
  propsSchema: protractorPropsSchema,
  createProps: () => ({ ray: 45, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as ProtractorObject,
  getLocalBounds: () => ({ x: -PR - 26, y: -PR - 6, width: 2 * PR + 52, height: PR + 20 }),
  hitTest: (o, point, tolerance) => {
    const p = toLocal(o, point);
    return (Math.hypot(p.x, p.y) <= PR + tolerance && p.y <= 6 + tolerance) || Math.hypot(p.x - PR - 16, p.y) <= 10 + tolerance;
  },
  getHandles: (o) => [
    { id: 'rotate', kind: 'rotate', position: toWorld(o, { x: PR + 16, y: 0 }), label: 'Повернуть (Shift — шаг 15°)', snap: false },
    { id: 'ray', kind: 'param', position: toWorld(o, mulP(scale(o.props.ray, PR), 0.8)), label: 'Луч: угол по шкале', snap: false },
  ],
  dragHandle: (o, h, to, m) => {
    if (h === 'rotate') return { rotation: rotationTo({ x: o.x, y: o.y }, to, 0, m.shift) };
    const p = toLocal(o, to);
    let deg = Math.atan2(-p.y, p.x) / DEG;
    if (deg < -90) deg = 180;
    deg = Math.min(180, Math.max(0, deg));
    return { props: { ray: m.shift ? Math.round(deg) : Math.round(deg * 2) / 2 } };
  },
  // Центр транспортира прилипает к точкам при перемещении.
  getSnapPoints: (o) => [
    { kind: 'center', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'endpoint', point: toWorld(o, { x: PR, y: 0 }) },
    { kind: 'endpoint', point: toWorld(o, { x: -PR, y: 0 }) },
  ],
  guides: (o) => [{ a: toWorld(o, { x: -PR, y: 0 }), b: toWorld(o, { x: PR, y: 0 }) }],
  render: (o, ctx) => <ProtractorShape o={o} theme={ctx.theme} color={ctx.resolveColor(o.props.color)} />,
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const tr = `translate(${o.x} ${o.y}) rotate(${o.rotation / DEG})`;
    const t = scale(o.props.ray, PR);
    return `<g transform="${tr}"><path d="M ${-PR} 0 A ${PR} ${PR} 0 0 1 ${PR} 0 Z" fill="${fill(ctx.theme)}" fill-opacity="0.82" stroke="${c}"/><line x1="0" y1="0" x2="${t.x}" y2="${t.y}" stroke="#2a7de1"/></g>`;
  },
  inspector: [
    { kind: 'number', key: 'ray', label: 'Луч, °', min: 0, max: 180, step: 0.5 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

function mulP(p: Point, k: number): Point {
  return { x: p.x * k, y: p.y * k };
}

// =====================================================================
//  Циркуль
// =====================================================================

export const compassPropsSchema = z.object({
  /** Раствор (радиус), мировые единицы. */
  r: z.number().finite().min(10).max(5000),
  /** Направление на грифель (рад, atan2). */
  a: z.number().finite(),
  /** Начерчено в текущем жесте: начальный угол и размах (со знаком). */
  drawFrom: z.number().finite(),
  drawn: z.number().finite().min(-20).max(20),
  color: z.string().max(32),
});
export type CompassProps = z.infer<typeof compassPropsSchema>;
type CompassObject = BoardObject<CompassProps>;

/** Точка над серединой раствора на высоте h (перпендикуляр к направлению на грифель). */
function above(p: CompassProps, h: number): Point {
  const m = mid({ x: 0, y: 0 }, polar({ x: 0, y: 0 }, p.r, p.a));
  return add(m, { x: Math.sin(p.a) * h, y: -Math.cos(p.a) * h });
}
const legHeight = (p: CompassProps) => Math.max(50, p.r * 0.7);
/** Шарнир циркуля (относительно иглы). */
const hinge = (p: CompassProps): Point => above(p, legHeight(p));
/** Ручка вращения — над шарниром; поворачивается вместе с циркулем. */
const knob = (p: CompassProps): Point => above(p, legHeight(p) + 20);

function CompassShape({ o, color }: { o: CompassObject; color: string }) {
  const zoom = useZoom();
  const p = o.props;
  const tip = polar({ x: 0, y: 0 }, p.r, p.a);
  const H = hinge(p);
  const K = knob(p);
  const trace =
    Math.abs(p.drawn) > 1e-3
      ? arcPoints(p.drawn < 0 ? { center: { x: 0, y: 0 }, radius: p.r, start: p.drawFrom, sweep: Math.min(Math.PI * 2, -p.drawn) } : { center: { x: 0, y: 0 }, radius: p.r, start: p.drawFrom + p.drawn, sweep: Math.min(Math.PI * 2, p.drawn) })
      : null;
  return (
    <Group>
      {trace && <Line points={trace.flatMap((q) => [q.x, q.y])} stroke="#2a7de1" strokeWidth={2} strokeScaleEnabled={false} dash={[6 / zoom, 4 / zoom]} listening={false} />}
      <Line points={[0, 0, H.x, H.y, tip.x, tip.y]} stroke={color} strokeWidth={4} strokeScaleEnabled={false} lineCap="round" lineJoin="round" opacity={0.85} listening={false} />
      <Line points={[H.x, H.y, K.x, K.y]} stroke={color} strokeWidth={3} strokeScaleEnabled={false} lineCap="round" listening={false} />
      <Circle x={K.x} y={K.y} radius={8 / zoom} fill="#2a7de1" listening={false} />
      <Circle x={H.x} y={H.y} radius={5 / zoom} fill={color} listening={false} />
      <Circle x={0} y={0} radius={3 / zoom} fill={color} listening={false} />
      <Circle x={tip.x} y={tip.y} radius={6 / zoom} stroke="#2a7de1" strokeWidth={2} strokeScaleEnabled={false} listening={false} />
    </Group>
  );
}

const wrap = (d: number) => {
  let x = d % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

/** Начертить дугу (или окружность) по жесту циркуля. */
function drawWithCompass(o: CompassObject, ctx: ToolContext): void {
  const p = o.props;
  const opts = ctx.getToolOptions<ToolOptionsView>();
  const full = Math.abs(p.drawn) >= Math.PI * 2 - 0.02;
  const c = { x: o.x, y: o.y };
  // Игла на точке — построение опирается на неё; иначе — новая точка-центр.
  const hit = ctx.hitTest(c, ctx.screenToWorld(4)).find((x) => isPointType(x.type));
  const ghost = (at: Point) =>
    ctx.createObject<PointProps>(POINT_TYPE, { x: at.x, y: at.y, props: { ...pointModule.createProps(), color: opts.stroke, auto: true, ghost: true } });
  const center =
    hit?.id ??
    ctx.createObject<PointProps>(POINT_TYPE, { x: c.x, y: c.y, props: { ...pointModule.createProps(), label: nextLabels(usedLabels(ctx), 1)[0] ?? '', color: opts.stroke, auto: true } });
  if (!center) return;
  const style: FigureProps = { color: opts.stroke, width: opts.strokeWidth, dash: opts.dash, label: '', fill: false, fb: [] };
  if (full) {
    const t = ghost(polar(c, p.r, p.drawFrom));
    if (t) ctx.createObject<FigureProps>(figureType('circle'), { x: 0, y: 0, props: style, deps: [center, t] });
  } else {
    // Дуга планиметрии идёт по убыванию угла от первой точки ко второй.
    const end = p.drawFrom + p.drawn;
    const [from, to] = p.drawn < 0 ? [p.drawFrom, end] : [end, p.drawFrom];
    const a = ghost(polar(c, p.r, from));
    const b = ghost(polar(c, p.r, to));
    if (a && b) ctx.createObject<FigureProps>(figureType('arc'), { x: 0, y: 0, props: style, deps: [center, a, b] });
  }
}

export const compassModule: ObjectModule<CompassProps, ReactNode> = {
  type: COMPASS_TYPE,
  title: 'Циркуль',
  version: 1,
  propsSchema: compassPropsSchema,
  createProps: () => ({ r: 5 * UNIT, a: 0, drawFrom: 0, drawn: 0, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as CompassObject,
  getLocalBounds: (o) => {
    const pts = [{ x: 0, y: 0 }, polar({ x: 0, y: 0 }, o.props.r, o.props.a), hinge(o.props), knob(o.props)];
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return { x: Math.min(...xs) - 12, y: Math.min(...ys) - 12, width: Math.max(...xs) - Math.min(...xs) + 24, height: Math.max(...ys) - Math.min(...ys) + 24 };
  },
  hitTest: (o, point, tolerance) => {
    const p = { x: point.x - o.x, y: point.y - o.y };
    const H = hinge(o.props);
    const tip = polar({ x: 0, y: 0 }, o.props.r, o.props.a);
    return distToLinear(p, { x: 0, y: 0 }, H, 'segment') <= tolerance + 5 || distToLinear(p, H, tip, 'segment') <= tolerance + 5 || dist(p, knob(o.props)) <= tolerance + 10;
  },
  getHandles: (o) => [
    { id: 'pencil', kind: 'point', position: add({ x: o.x, y: o.y }, polar({ x: 0, y: 0 }, o.props.r, o.props.a)), label: 'Грифель: раствор циркуля', snap: true },
    { id: 'knob', kind: 'param', position: add({ x: o.x, y: o.y }, knob(o.props)), label: 'Вращайте, чтобы начертить дугу', snap: false },
  ],
  dragHandle: (o, h, to) => {
    const c = { x: o.x, y: o.y };
    if (h === 'pencil') return { props: { r: Math.max(10, dist(c, to)), a: angleOf(c, to), drawn: 0 } };
    // Ручка вращения стоит над шарниром: её угол отличается от угла грифеля на постоянную величину.
    const offset = Math.atan2(knob({ ...o.props, a: 0 }).y, knob({ ...o.props, a: 0 }).x);
    const a = angleOf(c, to) - offset;
    const delta = wrap(a - o.props.a);
    const drawn = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, o.props.drawn + delta));
    return { props: { a: normAngle(a), drawn, drawFrom: Math.abs(o.props.drawn) < 1e-9 ? o.props.a : o.props.drawFrom } };
  },
  finishHandle: (o, h, ctx) => {
    if (h !== 'knob') return;
    // Объект в документе уже с последними изменениями жеста.
    const cur = (ctx.resolve.getObject(o.id) as CompassObject | undefined) ?? o;
    if (Math.abs(cur.props.drawn) >= 0.05) drawWithCompass(cur, ctx);
    ctx.updateObject<CompassProps>(o.id, { props: { drawn: 0 } });
  },
  getSnapPoints: (o) => [{ kind: 'center', point: { x: o.x, y: o.y } }],
  render: (o, ctx) => <CompassShape o={o} color={ctx.resolveColor(o.props.color)} />,
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const H = hinge(o.props);
    const tip = polar({ x: 0, y: 0 }, o.props.r, o.props.a);
    return `<polyline transform="translate(${o.x} ${o.y})" points="0,0 ${H.x},${H.y} ${tip.x},${tip.y}" fill="none" stroke="${c}" stroke-width="4"/>`;
  },
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Инструменты: поставить чертёжный инструмент на доску
// =====================================================================

function placeTool(type: string, title: string, icon: string, keywords: string[], props: () => object): ToolModule<ReactNode> {
  return {
    id: `${type}-tool`,
    title,
    icon,
    group: 'math',
    section: SECTION_DRAFTING,
    keywords: [...keywords, 'чертёжный инструмент', 'планиметрия'],
    requiresWrite: true,
    snapping: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      // На странице один инструмент каждого вида: повторный выбор переносит его к щелчку.
      const existing = ctx.listObjects(type).find((o) => ctx.canModify(o.id));
      let id = existing?.id ?? '';
      if (existing) ctx.updateObject(existing.id, { x: e.snapped.x, y: e.snapped.y });
      else id = ctx.createObject(type, { x: e.snapped.x, y: e.snapped.y, props: props() });
      if (id) ctx.setSelection([id]);
      ctx.activateTool('core.select');
    },
  };
}

export const draftingModules = [rulerModule, protractorModule, compassModule];
export const draftingTools = [
  placeTool(RULER_TYPE, 'Линейка', 'Ruler', ['линейка', 'ровная линия', 'измерить длину'], () => rulerModule.createProps()),
  placeTool(PROTRACTOR_TYPE, 'Транспортир', 'Gauge', ['транспортир', 'измерить угол', 'градусы'], () => protractorModule.createProps()),
  placeTool(COMPASS_TYPE, 'Циркуль', 'DraftingCompass', ['циркуль', 'окружность', 'дуга', 'раствор'], () => compassModule.createProps()),
];
