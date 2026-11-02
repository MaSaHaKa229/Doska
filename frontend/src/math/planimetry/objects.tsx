import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, InspectorField, ObjectModule, Point, Rect, RenderContext, ResolveContext, SnapCurve, SnapPoint } from '@doska/shared';
import { useBoard } from '../../store/board';
import { dashFor } from '../../objects/util';
import { SURFACE_COLORS } from '../../objects/colors';
import {
  add,
  angleDeg,
  arcGeom,
  arcPoints,
  boundsOf,
  centroid,
  circumcenter,
  dist,
  distToArc,
  distToLinear,
  distToPolyline,
  ellipseGeom,
  ellipsePoints,
  foot,
  homothety,
  incenter,
  insidePolygon,
  intersections,
  len,
  mid,
  mul,
  orthocenter,
  paramOf,
  pointAt,
  polar,
  polygonArea,
  reflectLine,
  reflectPoint,
  regularPolygon,
  rotate,
  sub,
  transformShape,
  translate,
  type FigureShape,
  type Geom,
  type Xform,
} from './geometry';
import { CPOINT_TYPE, PLUGIN_ID, POINT_TYPE, evaluate, geomOfId, registerEvaluator } from './eval';

export { PLUGIN_ID, POINT_TYPE, CPOINT_TYPE };
export type { FigureShape };

/** Длина, на которую рисуются прямая и луч (за пределами любого разумного вида). */
const FAR = 200_000;
/** Опорная часть прямой и луча для габарита («Показать всё»). */
const NEAR = 400;
/** Единица измерений — клетка сетки по умолчанию (20 мировых единиц). */
export const UNIT = 20;
const LABEL_SIZE = 20;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Число для подписи: до двух знаков, десятичная запятая. */
export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',').replace('-', '−');
}

const asPoints = (inputs: Geom[]): Point[] | null => (inputs.every((g) => g.kind === 'point') ? inputs.map((g) => (g as { p: Point }).p) : null);

// =====================================================================
//  Точки: свободная и зависимая
// =====================================================================

const pointStyle = {
  /** Подпись (A, B, C₁…); пусто — без подписи. */
  label: z.string().max(20),
  color: z.string().max(32),
  /** Радиус на экране, пт. */
  size: z.number().finite().min(2).max(16),
};

export const pointPropsSchema = z.object({
  ...pointStyle,
  /** Создана инструментом вместе с построением: удаляется вместе с ним, если больше никому не нужна. */
  auto: z.boolean(),
});
export type PointProps = z.infer<typeof pointPropsSchema>;
type PointObject = BoardObject<PointProps>;

function PointShape({ at, label, color, size, ctx }: { at: Point; label: string; color: string; size: number; ctx: RenderContext }) {
  const zoom = useZoom();
  const r = size / zoom;
  const c = ctx.resolveColor(color);
  return (
    <Group x={at.x} y={at.y}>
      <Circle radius={r} fill={c} stroke={SURFACE_COLORS[ctx.theme].paper} strokeWidth={1.5} strokeScaleEnabled={false} perfectDrawEnabled={false} listening={false} />
      {label && <Text x={r + 2} y={-r - LABEL_SIZE - 2} text={label} fontSize={LABEL_SIZE} fontStyle="italic" fontFamily="Times New Roman, serif" fill={c} listening={false} />}
    </Group>
  );
}

const pointSvg = (at: Point, label: string, color: string, size: number) =>
  `<circle cx="${at.x}" cy="${at.y}" r="${size}" fill="${color}"/>` +
  (label ? `<text x="${at.x + 6}" y="${at.y - 6}" font-size="${LABEL_SIZE}" font-style="italic" font-family="Times New Roman, serif" fill="${color}">${esc(label)}</text>` : '');

const pointBounds = (label: string): Rect => ({
  x: -8,
  y: label ? -LABEL_SIZE - 8 : -8,
  width: label ? 16 + LABEL_SIZE * 0.6 * label.length : 16,
  height: label ? LABEL_SIZE + 16 : 16,
});

const POINT_INSPECTOR: InspectorField[] = [
  { kind: 'text', key: 'label', label: 'Подпись', maxLength: 20 },
  { kind: 'color', key: 'color', label: 'Цвет' },
];

export const pointModule: ObjectModule<PointProps, ReactNode> = {
  type: POINT_TYPE,
  title: 'Точка',
  version: 1,
  propsSchema: pointPropsSchema,
  createProps: () => ({ label: '', color: 'ink', size: 4, auto: false }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as PointObject,
  // Подпись входит в габарит: её видно при «Показать всё» и выделении рамкой.
  getLocalBounds: (o) => pointBounds(o.props.label),
  hitTest: (o, point, tolerance) => dist(point, o) <= tolerance + 4,
  getHandles: () => [],
  getSnapPoints: (o) => [{ kind: 'anchor', point: { x: o.x, y: o.y }, refId: o.id }],
  render: (o, ctx) => <PointShape at={{ x: 0, y: 0 }} label={o.props.label} color={o.props.color} size={o.props.size} ctx={ctx} />,
  toSVG: (o, ctx) => pointSvg(o, o.props.label, ctx.resolveColor(o.props.color), o.props.size),
  inspector: POINT_INSPECTOR,
  transform: { rotatable: false, resize: 'none' },
  hitPriority: 10,
};

// ----- Преобразования (общие для образов точек и фигур) -----

export const XFORMS = ['reflect-line', 'reflect-point', 'rotate', 'translate', 'homothety'] as const;
export type XformKind = (typeof XFORMS)[number];

/** Преобразование по виду, параметрам из props и геометрии опор-параметров. */
export function xformOf(kind: XformKind, params: Geom[], p: { angle?: number; k?: number }): Xform | null {
  const g = params[0];
  if (!g) return null;
  switch (kind) {
    case 'reflect-line':
      return g.kind === 'linear' ? reflectLine(g.a, g.b) : null;
    case 'reflect-point':
      return g.kind === 'point' ? reflectPoint(g.p) : null;
    case 'rotate':
      return g.kind === 'point' ? rotate(g.p, p.angle ?? 90) : null;
    case 'translate':
      return g.kind === 'linear' ? translate(sub(g.b, g.a)) : null;
    case 'homothety':
      return g.kind === 'point' ? homothety(g.p, p.k ?? 2) : null;
  }
}

// ----- Зависимая точка -----

export const CPOINT_KINDS = ['midpoint', 'intersection', 'on', 'centroid', 'orthocenter', 'incenter', 'circumcenter', 'image'] as const;
export type CPointKind = (typeof CPOINT_KINDS)[number];

export const cpointPropsSchema = z.object({
  ...pointStyle,
  kind: z.enum(CPOINT_KINDS),
  /** Пересечение: какая из точек пересечения (по порядку). */
  index: z.number().int().min(0).max(64).optional(),
  /** Точка на объекте: параметр вдоль него. */
  t: z.number().finite().optional(),
  /** Образ: вид преобразования и его параметры. */
  xf: z.enum(XFORMS).optional(),
  angle: z.number().finite().min(-360).max(360).optional(),
  k: z.number().finite().min(-100).max(100).optional(),
});
export type CPointProps = z.infer<typeof cpointPropsSchema>;
type CPointObject = BoardObject<CPointProps>;

export function cpointPosition(p: CPointProps, inputs: Geom[]): Point | null {
  const pts = asPoints(inputs);
  switch (p.kind) {
    case 'midpoint': {
      if (pts?.length === 2) return mid(pts[0]!, pts[1]!);
      const g = inputs[0];
      return g?.kind === 'linear' ? mid(g.a, g.b) : null;
    }
    case 'intersection': {
      const [a, b] = inputs;
      if (!a || !b || a.kind === 'point' || b.kind === 'point') return null;
      return intersections(a, b)[p.index ?? 0] ?? null;
    }
    case 'on': {
      const g = inputs[0];
      return g && g.kind !== 'point' ? pointAt(g, p.t ?? 0) : null;
    }
    case 'centroid':
      return pts?.length === 3 ? centroid(pts[0]!, pts[1]!, pts[2]!) : null;
    case 'orthocenter':
      return pts?.length === 3 ? orthocenter(pts[0]!, pts[1]!, pts[2]!) : null;
    case 'incenter':
      return pts?.length === 3 ? (incenter(pts[0]!, pts[1]!, pts[2]!)?.c ?? null) : null;
    case 'circumcenter':
      return pts?.length === 3 ? circumcenter(pts[0]!, pts[1]!, pts[2]!) : null;
    case 'image': {
      const [src, ...params] = inputs;
      const x = p.xf ? xformOf(p.xf, params, p) : null;
      return src?.kind === 'point' && x ? x.map(src.p) : null;
    }
  }
}

registerEvaluator(CPOINT_TYPE, (o, inputs) => {
  const at = cpointPosition(o.props as CPointProps, inputs);
  return at ? { kind: 'point', p: at } : null;
});

const cpointAt = (o: CPointObject, ctx: ResolveContext) => {
  const r = evaluate(o, ctx);
  return r.g?.kind === 'point' ? { at: r.g.p, missing: r.missing } : null;
};

export const CPOINT_TITLES: Record<CPointKind, string> = {
  midpoint: 'Середина',
  intersection: 'Точка пересечения',
  on: 'Точка на объекте',
  centroid: 'Точка пересечения медиан',
  orthocenter: 'Точка пересечения высот',
  incenter: 'Центр вписанной окружности',
  circumcenter: 'Центр описанной окружности',
  image: 'Образ точки',
};

export const cpointModule: ObjectModule<CPointProps, ReactNode> = {
  type: CPOINT_TYPE,
  title: 'Зависимая точка',
  version: 1,
  propsSchema: cpointPropsSchema,
  createProps: () => ({ label: '', color: 'ink', size: 4, kind: 'midpoint' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as CPointObject,
  getLocalBounds: (o, ctx) => {
    const r = cpointAt(o, ctx);
    if (!r) return { x: 0, y: 0, width: 0, height: 0 };
    const b = pointBounds(o.props.label);
    return { ...b, x: b.x + r.at.x, y: b.y + r.at.y };
  },
  hitTest: (o, point, tolerance, ctx) => {
    const r = cpointAt(o, ctx);
    return !!r && dist(point, r.at) <= tolerance + 4;
  },
  // Точку на объекте тянут вдоль объекта: её ручка меняет параметр t.
  getHandles: (o, ctx) => {
    if (o.props.kind !== 'on') return [];
    const r = cpointAt(o, ctx);
    return r ? [{ id: 't', kind: 'point', position: r.at, label: 'Точка на объекте', snap: false }] : [];
  },
  dragHandle: (o, _h, to, _m, ctx) => {
    const g = geomOfId(o.deps[0] ?? '', ctx);
    return g && g.kind !== 'point' ? { props: { t: paramOf(g, to) } } : null;
  },
  getSnapPoints: (o, ctx) => {
    const r = cpointAt(o, ctx);
    return r && !r.missing ? [{ kind: 'anchor', point: r.at, refId: o.id }] : [];
  },
  render: (o, ctx) => {
    const r = cpointAt(o, ctx);
    return r ? <PointShape at={r.at} label={o.props.label} color={r.missing ? 'muted' : o.props.color} size={o.props.size} ctx={ctx} /> : null;
  },
  toSVG: (o, ctx) => {
    const r = cpointAt(o, ctx);
    return r ? pointSvg(r.at, o.props.label, ctx.resolveColor(o.props.color), o.props.size) : '';
  },
  inspector: POINT_INSPECTOR,
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  hitPriority: 10,
};

// =====================================================================
//  Фигуры (динамическая геометрия)
// =====================================================================

export const figurePropsSchema = z.object({
  color: z.string().max(32),
  /** Толщина линии на экране, пт. */
  width: z.number().finite().min(0.5).max(16),
  dash: z.enum(['solid', 'dashed', 'dotted']),
  /** Подпись фигуры (a, ω…). */
  label: z.string().max(20),
  /** Заливка замкнутой фигуры полупрозрачным цветом линии. */
  fill: z.boolean(),
  /** Показывать размер: длину, радиус, площадь (в клетках сетки). */
  measure: z.boolean().optional(),
  /** Число сторон правильного многоугольника. */
  n: z.number().int().min(3).max(24).optional(),
  /** Касательная: первая или вторая из двух. */
  index: z.number().int().min(0).max(1).optional(),
  /** Образ: вид преобразования и его параметры. */
  xf: z.enum(XFORMS).optional(),
  angle: z.number().finite().min(-360).max(360).optional(),
  k: z.number().finite().min(-100).max(100).optional(),
  /**
   * Координаты опор на момент создания (x, y подряд): чем нарисовать
   * построение, если опору удалил другой участник («нет опоры»).
   */
  fb: z.array(z.number().finite()).max(128),
});
export type FigureProps = z.infer<typeof figurePropsSchema>;
type FigureObject = BoardObject<FigureProps>;

export interface FigureDef {
  name: string;
  title: string;
  /** Для инструмента «по точкам»: сколько точек (null — любое число ≥ minPoints); не задано — построение по объектам. */
  points?: number | null;
  minPoints?: number;
  closed: boolean;
  /** Форма по геометрии опор. */
  evaluate(inputs: Geom[], p: FigureProps): FigureShape | null;
  /** Дополнительные поля панели свойств. */
  inspector?: InspectorField[];
}

/** Описание фигуры по точкам: все опоры — точки. */
const byPoints = (fn: (pts: Point[], p: FigureProps) => FigureShape | null) => (inputs: Geom[], p: FigureProps) => {
  const pts = asPoints(inputs);
  return pts ? fn(pts, p) : null;
};

function unit(a: Point, b: Point): Point {
  const d = sub(b, a);
  const l = len(d) || 1;
  return { x: d.x / l, y: d.y / l };
}

/** Точки отрисовки линейной фигуры. */
function linearEnds(s: Extract<FigureShape, { kind: 'linear' }>, far: number): [Point, Point] {
  const d = unit(s.a, s.b);
  if (s.mode === 'line') return [{ x: s.a.x - d.x * far, y: s.a.y - d.y * far }, { x: s.a.x + d.x * far, y: s.a.y + d.y * far }];
  if (s.mode === 'ray') return [s.a, { x: s.a.x + d.x * far, y: s.a.y + d.y * far }];
  return [s.a, s.b];
}

/** Контур фигуры ломаной (для дуг, эллипса, многоугольника). */
export function outline(s: FigureShape, far = NEAR): { pts: Point[]; closed: boolean } {
  switch (s.kind) {
    case 'linear':
      return { pts: linearEnds(s, far), closed: false };
    case 'poly':
      return s;
    case 'circle':
      return { pts: Array.from({ length: 96 }, (_, i) => polar(s.c, s.r, (Math.PI * 2 * i) / 96)), closed: true };
    case 'arc': {
      const pts = arcPoints(s.g);
      if (s.mode === 'sector') return { pts: [s.g.center, ...pts], closed: true };
      return { pts, closed: s.mode === 'segment' };
    }
    case 'ellipse':
      return { pts: ellipsePoints(s.g), closed: true };
  }
}

function hit(s: FigureShape, p: Point, tol: number, fill: boolean): boolean {
  switch (s.kind) {
    case 'linear':
      return distToLinear(p, s.a, s.b, s.mode === 'vector' ? 'segment' : s.mode) <= tol;
    case 'circle': {
      const d = dist(p, s.c);
      return Math.abs(d - s.r) <= tol || (fill && d <= s.r);
    }
    case 'arc': {
      if (distToArc(p, s.g) <= tol) return true;
      const o = outline(s);
      if (s.mode !== 'arc' && distToPolyline(p, o.pts, true) <= tol) return true;
      return fill && s.mode !== 'arc' && insidePolygon(p, o.pts);
    }
    default: {
      const o = outline(s);
      return distToPolyline(p, o.pts, o.closed) <= tol || (fill && o.closed && insidePolygon(p, o.pts));
    }
  }
}

function snapCurves(s: FigureShape): SnapCurve[] {
  switch (s.kind) {
    case 'linear':
      if (s.mode === 'line') return [{ kind: 'line', point: s.a, direction: sub(s.b, s.a) }];
      if (s.mode === 'ray') return [{ kind: 'ray', origin: s.a, direction: sub(s.b, s.a) }];
      return [{ kind: 'segment', a: s.a, b: s.b }];
    case 'circle':
      return [{ kind: 'circle', center: s.c, radius: s.r }];
    case 'arc': {
      // Ядро описывает дугу углами по возрастанию; наша идёт по убыванию от start.
      const curves: SnapCurve[] = [{ kind: 'arc', center: s.g.center, radius: s.g.radius, startAngle: s.g.start - s.g.sweep, endAngle: s.g.start }];
      const o = outline(s);
      if (s.mode === 'sector') {
        curves.push({ kind: 'segment', a: s.g.center, b: o.pts[1]! }, { kind: 'segment', a: s.g.center, b: o.pts[o.pts.length - 1]! });
      } else if (s.mode === 'segment') curves.push({ kind: 'segment', a: o.pts[0]!, b: o.pts[o.pts.length - 1]! });
      return curves;
    }
    default: {
      const o = outline(s);
      return [{ kind: 'polyline', points: o.pts, closed: o.closed }];
    }
  }
}

function snapPoints(s: FigureShape, ownVertices: boolean): SnapPoint[] {
  // Опорные точки — сами объекты-точки (их привязки дают refId точки).
  const out: SnapPoint[] = [];
  const at = (kind: SnapPoint['kind'], point: Point) => out.push({ kind, point });
  switch (s.kind) {
    case 'linear':
      if (s.mode !== 'line') at('midpoint', mid(s.a, s.b));
      // Концы построенного отрезка (медианы, высоты) — не точки-объекты.
      if (ownVertices) {
        at('endpoint', s.a);
        if (s.mode !== 'line' && s.mode !== 'ray') at('endpoint', s.b);
      }
      break;
    case 'poly': {
      const n = s.closed ? s.pts.length : s.pts.length - 1;
      for (let i = 0; i < n; i++) at('midpoint', mid(s.pts[i]!, s.pts[(i + 1) % s.pts.length]!));
      if (ownVertices) s.pts.forEach((p) => at('vertex', p));
      break;
    }
    case 'circle':
      at('center', s.c);
      for (let k = 0; k < 4; k++) at('quadrant', polar(s.c, s.r, (k * Math.PI) / 2));
      break;
    case 'arc':
      at('center', s.g.center);
      at('endpoint', polar(s.g.center, s.g.radius, s.g.start - s.g.sweep));
      if (ownVertices) at('endpoint', polar(s.g.center, s.g.radius, s.g.start));
      break;
    case 'ellipse':
      at('center', s.g.center);
      break;
  }
  return out;
}

/** Размер фигуры для подписи (в клетках сетки). */
export function measureText(s: FigureShape): string | null {
  switch (s.kind) {
    case 'linear':
      return s.mode === 'segment' || s.mode === 'vector' ? fmt(dist(s.a, s.b) / UNIT) : null;
    case 'poly': {
      if (s.closed) return `S = ${fmt(polygonArea(s.pts) / UNIT / UNIT)}`;
      let l = 0;
      for (let i = 1; i < s.pts.length; i++) l += dist(s.pts[i - 1]!, s.pts[i]!);
      return `l = ${fmt(l / UNIT)}`;
    }
    case 'circle':
      return `r = ${fmt(s.r / UNIT)}`;
    case 'arc': {
      const r = s.g.radius / UNIT;
      if (s.mode === 'arc') return `l = ${fmt(r * s.g.sweep)}`;
      if (s.mode === 'sector') return `S = ${fmt((r * r * s.g.sweep) / 2)}`;
      return `S = ${fmt((r * r * (s.g.sweep - Math.sin(s.g.sweep))) / 2)}`;
    }
    case 'ellipse':
      return `S = ${fmt((Math.PI * s.g.rx * s.g.ry) / UNIT / UNIT)}`;
  }
}

/** Подпись фигуры и её размер одной строкой: «a = 5», «S = 12», «ω r = 3». */
export function figureCaption(label: string, measure: string | null): string {
  if (!measure) return label;
  if (!label) return measure;
  return measure.includes('=') ? `${label}: ${measure}` : `${label} = ${measure}`;
}

function labelPoint(s: FigureShape): Point {
  switch (s.kind) {
    case 'linear':
      return mid(s.a, s.b);
    case 'circle':
      return polar(s.c, s.r, -Math.PI / 4);
    case 'poly':
      return s.closed ? s.pts.reduce((a, b) => add(a, mul(b, 1 / s.pts.length)), { x: 0, y: 0 }) : s.pts[0]!;
    case 'arc':
      return polar(s.g.center, s.g.radius, s.g.start - s.g.sweep / 2);
    case 'ellipse':
      return ellipsePoints(s.g, 8)[7]!;
  }
}

function FigureShapeView({ s, p, ctx, missing }: { s: FigureShape; p: FigureProps; ctx: RenderContext; missing: boolean }) {
  const zoom = useZoom();
  const color = ctx.resolveColor(missing ? 'muted' : p.color);
  const common = {
    stroke: color,
    strokeWidth: p.width,
    strokeScaleEnabled: false,
    dash: missing ? [6, 4] : dashFor(p.dash, p.width),
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    perfectDrawEnabled: false,
    listening: false,
  };
  let body: ReactNode;
  if (s.kind === 'linear') {
    const [a, b] = linearEnds(s, FAR);
    body =
      s.mode === 'vector' ? (
        <Arrow points={[a.x, a.y, b.x, b.y]} fill={color} pointerLength={(p.width * 4 + 6) / zoom} pointerWidth={(p.width * 3 + 6) / zoom} {...common} />
      ) : (
        <Line points={[a.x, a.y, b.x, b.y]} {...common} />
      );
  } else if (s.kind === 'circle') {
    body = <Circle x={s.c.x} y={s.c.y} radius={s.r} {...common} />;
  } else {
    const o = outline(s);
    body = <Line points={o.pts.flatMap((q) => [q.x, q.y])} closed={o.closed} {...common} />;
  }
  const o = s.kind === 'linear' ? null : outline(s);
  const area = p.fill && !missing && o?.closed ? <Line points={o.pts.flatMap((q) => [q.x, q.y])} closed fill={color} opacity={0.12} listening={false} perfectDrawEnabled={false} /> : null;
  const at = labelPoint(s);
  const text = figureCaption(p.label, p.measure ? measureText(s) : null);
  return (
    <Group>
      {area}
      {body}
      {text && <Text x={at.x + 6} y={at.y - LABEL_SIZE - 4} text={text} fontSize={LABEL_SIZE} fontStyle={p.measure ? 'normal' : 'italic'} fontFamily="Times New Roman, serif" fill={color} listening={false} />}
      {missing && <Text x={at.x + 6} y={at.y + 6} text="нет опоры" fontSize={14} fill={color} listening={false} />}
    </Group>
  );
}

function svgOf(s: FigureShape, p: FigureProps, color: string): string {
  const dash = p.dash === 'dashed' ? ` stroke-dasharray="${p.width * 4} ${p.width * 3}"` : p.dash === 'dotted' ? ` stroke-dasharray="0.01 ${p.width * 2.5}" stroke-linecap="round"` : '';
  const attrs = `stroke="${color}" stroke-width="${p.width}" fill="none"${dash}`;
  if (s.kind === 'linear') {
    const [a, b] = linearEnds(s, s.mode === 'segment' || s.mode === 'vector' ? 0 : FAR / 10);
    const line = `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${attrs}/>`;
    if (s.mode !== 'vector') return line;
    const d = unit(a, b);
    const l = p.width * 4 + 6;
    const w = (p.width * 3 + 6) / 2;
    const base = { x: b.x - d.x * l, y: b.y - d.y * l };
    return `${line}<polygon points="${b.x},${b.y} ${base.x - d.y * w},${base.y + d.x * w} ${base.x + d.y * w},${base.y - d.x * w}" fill="${color}"/>`;
  }
  if (s.kind === 'circle') {
    return `<circle cx="${s.c.x}" cy="${s.c.y}" r="${s.r}" ${attrs.replace('fill="none"', p.fill ? `fill="${color}" fill-opacity="0.12"` : 'fill="none"')}/>`;
  }
  const o = outline(s);
  const pts = o.pts.map((q) => `${q.x},${q.y}`).join(' ');
  const fillAttr = p.fill && o.closed ? `fill="${color}" fill-opacity="0.12"` : 'fill="none"';
  return `<${o.closed ? 'polygon' : 'polyline'} points="${pts}" ${attrs.replace('fill="none"', fillAttr)}/>`;
}

const LINE_INSPECTOR: InspectorField[] = [
  { kind: 'color', key: 'color', label: 'Цвет' },
  { kind: 'stroke-width', key: 'width', label: 'Толщина' },
  { kind: 'line-style', key: 'dash', label: 'Линия' },
  { kind: 'text', key: 'label', label: 'Подпись', maxLength: 20 },
  { kind: 'toggle', key: 'measure', label: 'Размер' },
];

/** Модуль фигуры по описанию: всё общее (габарит, попадание, привязки, отрисовка) — здесь. */
export function figureModule(def: FigureDef): ObjectModule<FigureProps, ReactNode> {
  const type = `${PLUGIN_ID}.${def.name}`;
  registerEvaluator(type, (o, inputs) => def.evaluate(inputs, o.props as FigureProps));
  const shapeOf = (o: FigureObject, ctx: ResolveContext) => {
    const r = evaluate(o, ctx);
    return r.g && r.g.kind !== 'point' ? { s: r.g, missing: r.missing } : null;
  };
  // Вершины построенной фигуры (медиана, образ) — не точки-объекты: привязка к ним нужна отдельно.
  const ownVertices = def.points === undefined;
  return {
    type,
    title: def.title,
    version: 1,
    propsSchema: figurePropsSchema,
    createProps: () => ({ color: 'ink', width: 2, dash: 'solid', label: '', fill: false, fb: [] }),
    serialize: (o) => o,
    deserialize: (raw) => raw as unknown as FigureObject,
    getLocalBounds: (o, ctx): Rect => {
      const r = shapeOf(o, ctx);
      if (!r) return { x: 0, y: 0, width: 0, height: 0 };
      return boundsOf(outline(r.s).pts, 4);
    },
    hitTest: (o, point, tolerance, ctx) => {
      const r = shapeOf(o, ctx);
      return !!r && hit(r.s, point, tolerance + 2, o.props.fill);
    },
    getHandles: () => [],
    getSnapPoints: (o, ctx) => {
      const r = shapeOf(o, ctx);
      return r && !r.missing ? snapPoints(r.s, ownVertices) : [];
    },
    getSnapCurves: (o, ctx) => {
      const r = shapeOf(o, ctx);
      return r && !r.missing ? snapCurves(r.s) : [];
    },
    render: (o, ctx) => {
      const r = shapeOf(o, ctx);
      return r ? <FigureShapeView s={r.s} p={o.props} ctx={ctx} missing={r.missing} /> : null;
    },
    toSVG: (o, ctx) => {
      const r = shapeOf(o, ctx);
      return r ? svgOf(r.s, o.props, ctx.resolveColor(r.missing ? 'muted' : o.props.color)) : '';
    },
    inspector: [...LINE_INSPECTOR, ...(def.closed ? [{ kind: 'toggle', key: 'fill', label: 'Заливка' } as InspectorField] : []), ...(def.inspector ?? [])],
    transform: { rotatable: false, resize: 'none' },
    derived: true,
    // Прямые и лучи уходят за габарит; у построений форма заранее неизвестна.
    unbounded: def.name === 'line' || def.name === 'ray' || def.points === undefined,
  };
}

const line = (a: Point, b: Point, mode: 'segment' | 'ray' | 'line' | 'vector' = 'line'): FigureShape => ({ kind: 'linear', a, b, mode });
const perpDir = (a: Point, b: Point): Point => ({ x: -(b.y - a.y), y: b.x - a.x });

/** Описания фигур: 6.1a — по точкам, 6.1b — построения и образы. */
export const FIGURES: FigureDef[] = [
  { name: 'segment', title: 'Отрезок', points: 2, closed: false, evaluate: byPoints(([a, b]) => line(a!, b!, 'segment')) },
  { name: 'ray', title: 'Луч', points: 2, closed: false, evaluate: byPoints(([a, b]) => line(a!, b!, 'ray')) },
  { name: 'line', title: 'Прямая', points: 2, closed: false, evaluate: byPoints(([a, b]) => line(a!, b!)) },
  { name: 'vector', title: 'Вектор', points: 2, closed: false, evaluate: byPoints(([a, b]) => line(a!, b!, 'vector')) },
  { name: 'polyline', title: 'Ломаная', points: null, minPoints: 2, closed: false, evaluate: byPoints((pts) => ({ kind: 'poly', pts, closed: false })) },
  { name: 'polygon', title: 'Многоугольник', points: null, minPoints: 3, closed: true, evaluate: byPoints((pts) => ({ kind: 'poly', pts, closed: true })) },
  {
    name: 'regular-polygon',
    title: 'Правильный многоугольник',
    points: 2,
    closed: true,
    evaluate: byPoints(([a, b], p) => ({ kind: 'poly', pts: regularPolygon(a!, b!, p.n ?? 6), closed: true })),
    inspector: [{ kind: 'number', key: 'n', label: 'Сторон', min: 3, max: 24, step: 1 }],
  },
  { name: 'circle', title: 'Окружность', points: 2, closed: true, evaluate: byPoints(([c, t]) => ({ kind: 'circle', c: c!, r: dist(c!, t!) })) },
  { name: 'arc', title: 'Дуга', points: 3, closed: false, evaluate: byPoints(([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'arc' })) },
  { name: 'sector', title: 'Сектор', points: 3, closed: true, evaluate: byPoints(([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'sector' })) },
  { name: 'circle-segment', title: 'Сегмент круга', points: 3, closed: true, evaluate: byPoints(([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'segment' })) },
  { name: 'ellipse', title: 'Эллипс', points: 3, closed: true, evaluate: byPoints(([c, a, b]) => ({ kind: 'ellipse', g: ellipseGeom(c!, a!, b!) })) },

  // ----- 6.1b: построения -----
  {
    name: 'perpendicular',
    title: 'Перпендикуляр',
    closed: false,
    evaluate: ([p, l]) => (p?.kind === 'point' && l?.kind === 'linear' ? line(p.p, add(p.p, perpDir(l.a, l.b))) : null),
  },
  {
    name: 'parallel',
    title: 'Параллельная прямая',
    closed: false,
    evaluate: ([p, l]) => (p?.kind === 'point' && l?.kind === 'linear' ? line(p.p, add(p.p, sub(l.b, l.a))) : null),
  },
  {
    name: 'bisector',
    title: 'Биссектриса угла',
    closed: false,
    evaluate: byPoints(([a, b, c]) => {
      const u = unit(b!, a!);
      const v = unit(b!, c!);
      const d = add(u, v);
      // Развёрнутый угол: биссектриса перпендикулярна сторонам.
      return line(b!, add(b!, len(d) < 1e-9 ? { x: -u.y, y: u.x } : d), 'ray');
    }),
  },
  {
    name: 'perp-bisector',
    title: 'Серединный перпендикуляр',
    closed: false,
    evaluate: byPoints(([a, b]) => {
      const m = mid(a!, b!);
      return dist(a!, b!) < 1e-9 ? null : line(m, add(m, perpDir(a!, b!)));
    }),
  },
  {
    name: 'tangent',
    title: 'Касательная',
    closed: false,
    evaluate: ([p, c], props) => {
      if (p?.kind !== 'point' || c?.kind !== 'circle') return null;
      const d = dist(p.p, c.c);
      if (d < c.r - 1e-9) return null;
      // Точка на окружности — одна касательная (обе совпадают).
      if (d - c.r < 1e-6) return line(p.p, add(p.p, perpDir(c.c, p.p)));
      const base = Math.atan2(p.p.y - c.c.y, p.p.x - c.c.x);
      const off = Math.acos(c.r / d);
      return line(p.p, polar(c.c, c.r, base + ((props.index ?? 0) === 0 ? off : -off)));
    },
  },
  { name: 'median', title: 'Медиана', closed: false, evaluate: byPoints(([a, b, c]) => line(a!, mid(b!, c!), 'segment')) },
  {
    name: 'altitude',
    title: 'Высота',
    closed: false,
    evaluate: byPoints(([a, b, c]) => (dist(b!, c!) < 1e-9 ? null : line(a!, foot(a!, b!, c!), 'segment'))),
  },
  {
    name: 'incircle',
    title: 'Вписанная окружность',
    closed: true,
    evaluate: byPoints(([a, b, c]) => {
      const r = incenter(a!, b!, c!);
      return r ? { kind: 'circle', c: r.c, r: r.r } : null;
    }),
  },
  {
    name: 'circumcircle',
    title: 'Описанная окружность',
    closed: true,
    evaluate: byPoints(([a, b, c]) => {
      const o = circumcenter(a!, b!, c!);
      return o ? { kind: 'circle', c: o, r: dist(o, a!) } : null;
    }),
  },
  // ----- 6.1b: образ фигуры при преобразовании -----
  {
    name: 'image',
    title: 'Образ фигуры',
    closed: true,
    evaluate: ([src, ...params], p) => {
      const x = p.xf ? xformOf(p.xf, params, p) : null;
      if (!src || src.kind === 'point' || !x) return null;
      return transformShape(src, x);
    },
    inspector: [
      { kind: 'number', key: 'angle', label: 'Угол, °', min: -360, max: 360, step: 1 },
      { kind: 'number', key: 'k', label: 'Коэффициент', min: -100, max: 100, step: 0.1 },
    ],
  },
];

export const figureModules = FIGURES.map(figureModule);
export const figureType = (name: string) => `${PLUGIN_ID}.${name}`;
export const figureDef = (name: string) => FIGURES.find((f) => f.name === name)!;

// =====================================================================
//  6.1b: отметки — угол и равные отрезки
// =====================================================================

export const ANGLE_TYPE = `${PLUGIN_ID}.angle`;
export const TICKS_TYPE = `${PLUGIN_ID}.ticks`;

export const anglePropsSchema = z.object({
  color: z.string().max(32),
  /** Число дуг (равные углы отмечаются одинаковым числом). */
  arcs: z.number().int().min(1).max(3),
  /** Подпись (α, ∠B…). */
  label: z.string().max(20),
  /** Показывать величину в градусах. */
  showValue: z.boolean(),
  /** Отмечать угол больше 180° (с другой стороны). */
  reflex: z.boolean(),
  fb: z.array(z.number().finite()).max(6),
});
export type AngleProps = z.infer<typeof anglePropsSchema>;

/** Угол ABC: начальный угол и размах дуги отметки (по уменьшению atan2, как у дуг) и величина. */
export function angleArc(a: Point, b: Point, c: Point, reflex: boolean): { start: number; sweep: number; deg: number } {
  const sa = Math.atan2(a.y - b.y, a.x - b.x);
  const sc = Math.atan2(c.y - b.y, c.x - b.x);
  const g = arcGeom(b, polar(b, 1, sa), polar(b, 1, sc));
  // Внутренний угол — меньший из двух направлений обхода.
  const inner = g.sweep <= Math.PI ? { start: sa, sweep: g.sweep } : { start: sc, sweep: Math.PI * 2 - g.sweep };
  const res = reflex ? { start: inner.start - inner.sweep, sweep: Math.PI * 2 - inner.sweep } : inner;
  return { ...res, deg: reflex ? 360 - angleDeg(a, b, c) : angleDeg(a, b, c) };
}

registerEvaluator(ANGLE_TYPE, (_o, inputs) => {
  const pts = asPoints(inputs);
  return pts?.length === 3 ? { kind: 'poly', pts, closed: false } : null;
});

const ARC_R = 26;

const angleText = (p: AngleProps, deg: number) => [p.label, p.showValue ? `${fmt(deg)}°` : ''].filter(Boolean).join(' = ');

function AngleView({ pts, p, ctx, missing }: { pts: Point[]; p: AngleProps; ctx: RenderContext; missing: boolean }) {
  const zoom = useZoom();
  const [a, b, c] = pts as [Point, Point, Point];
  const color = ctx.resolveColor(missing ? 'muted' : p.color);
  const arc = angleArc(a, b, c, p.reflex);
  const r = ARC_R / zoom;
  const right = !p.reflex && Math.abs(arc.deg - 90) < 0.05;
  const common = { stroke: color, strokeWidth: 1.5, strokeScaleEnabled: false, listening: false, perfectDrawEnabled: false };
  const shapes: ReactNode[] = [];
  if (right) {
    // Прямой угол — квадратик.
    const u = sub(polar(b, r * 0.7, Math.atan2(a.y - b.y, a.x - b.x)), b);
    const v = sub(polar(b, r * 0.7, Math.atan2(c.y - b.y, c.x - b.x)), b);
    const q = [add(b, u), add(add(b, u), v), add(b, v)];
    shapes.push(<Line key="sq" points={q.flatMap((x) => [x.x, x.y])} {...common} />);
  } else {
    for (let i = 0; i < p.arcs; i++) {
      const g = { center: b, radius: r + (i * 4) / zoom, start: arc.start, sweep: arc.sweep };
      shapes.push(<Line key={i} points={arcPoints(g).flatMap((x) => [x.x, x.y])} {...common} />);
    }
  }
  const at = polar(b, r + (p.arcs * 4 + 12) / zoom, arc.start - arc.sweep / 2);
  const text = angleText(p, arc.deg);
  return (
    <Group>
      {shapes}
      {text && <Text x={at.x - (text.length * 4) / zoom} y={at.y - 8 / zoom} text={text} fontSize={16 / zoom} fill={color} listening={false} />}
    </Group>
  );
}

const resolveTriple = (o: BoardObject, ctx: ResolveContext) => {
  const r = evaluate(o, ctx);
  return r.g?.kind === 'poly' && r.g.pts.length === 3 ? { pts: r.g.pts, missing: r.missing } : null;
};

export const angleModule: ObjectModule<AngleProps, ReactNode> = {
  type: ANGLE_TYPE,
  title: 'Отметка угла',
  version: 1,
  propsSchema: anglePropsSchema,
  createProps: () => ({ color: 'ink', arcs: 1, label: '', showValue: true, reflex: false, fb: [] }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as BoardObject<AngleProps>,
  getLocalBounds: (o, ctx) => {
    const r = resolveTriple(o, ctx);
    return r ? boundsOf([r.pts[1]!], ARC_R + 40) : { x: 0, y: 0, width: 0, height: 0 };
  },
  hitTest: (o, point, tolerance, ctx) => {
    const r = resolveTriple(o, ctx);
    if (!r) return false;
    const [a, b, c] = r.pts as [Point, Point, Point];
    const d = dist(point, b);
    // Попадание — по сектору отметки около вершины (радиус отметки задан на экране, допуск щедрый).
    if (d <= 6 || d > ARC_R + 24 + tolerance) return false;
    const arc = angleArc(a, b, c, o.props.reflex);
    return angleOnSweep(arc.start, arc.sweep, Math.atan2(point.y - b.y, point.x - b.x));
  },
  getHandles: () => [],
  render: (o, ctx) => {
    const r = resolveTriple(o, ctx);
    return r ? <AngleView pts={r.pts} p={o.props} ctx={ctx} missing={r.missing} /> : null;
  },
  toSVG: (o, ctx) => {
    const r = resolveTriple(o, ctx);
    if (!r) return '';
    const [a, b, c] = r.pts as [Point, Point, Point];
    const arc = angleArc(a, b, c, o.props.reflex);
    const pts = arcPoints({ center: b, radius: ARC_R, start: arc.start, sweep: arc.sweep });
    const color = ctx.resolveColor(o.props.color);
    const at = polar(b, ARC_R + 14, arc.start - arc.sweep / 2);
    const text = angleText(o.props, arc.deg);
    return `<polyline points="${pts.map((q) => `${q.x},${q.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>${text ? `<text x="${at.x}" y="${at.y}" font-size="16" fill="${color}">${esc(text)}</text>` : ''}`;
  },
  inspector: [
    { kind: 'color', key: 'color', label: 'Цвет' },
    { kind: 'number', key: 'arcs', label: 'Дуг', min: 1, max: 3, step: 1 },
    { kind: 'text', key: 'label', label: 'Подпись', maxLength: 20 },
    { kind: 'toggle', key: 'showValue', label: 'Градусы' },
    { kind: 'toggle', key: 'reflex', label: 'Больше 180°' },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  hitPriority: 5,
};

function angleOnSweep(start: number, sweep: number, angle: number): boolean {
  const t = (((start - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return t <= sweep + 1e-9;
}

export const ticksPropsSchema = z.object({
  color: z.string().max(32),
  /** Число штрихов: равные отрезки отмечаются одинаковым числом. */
  count: z.number().int().min(1).max(3),
  fb: z.array(z.number().finite()).max(4),
});
export type TicksProps = z.infer<typeof ticksPropsSchema>;

/** Отметка равенства: на отрезке (одна опора — отрезок) или между двумя точками. */
registerEvaluator(TICKS_TYPE, (_o, inputs) => {
  const pts = asPoints(inputs);
  if (pts?.length === 2) return line(pts[0]!, pts[1]!, 'segment');
  const g = inputs[0];
  return g?.kind === 'linear' ? line(g.a, g.b, 'segment') : null;
});

function ticksPoints(s: Extract<FigureShape, { kind: 'linear' }>, count: number, zoom: number): number[][] {
  const m = mid(s.a, s.b);
  const d = unit(s.a, s.b);
  const n = { x: -d.y, y: d.x };
  const h = 7 / zoom;
  const gap = 4 / zoom;
  return Array.from({ length: count }, (_, i) => {
    const c = add(m, mul(d, (i - (count - 1) / 2) * gap));
    return [c.x - n.x * h, c.y - n.y * h, c.x + n.x * h, c.y + n.y * h];
  });
}

function TicksView({ s, p, ctx }: { s: Extract<FigureShape, { kind: 'linear' }>; p: TicksProps; ctx: RenderContext }) {
  const zoom = useZoom();
  const color = ctx.resolveColor(p.color);
  return (
    <Group>
      {ticksPoints(s, p.count, zoom).map((pts, i) => (
        <Line key={i} points={pts} stroke={color} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      ))}
    </Group>
  );
}

const ticksShape = (o: BoardObject, ctx: ResolveContext) => {
  const r = evaluate(o, ctx);
  return r.g?.kind === 'linear' ? r.g : null;
};

export const ticksModule: ObjectModule<TicksProps, ReactNode> = {
  type: TICKS_TYPE,
  title: 'Отметка равенства',
  version: 1,
  propsSchema: ticksPropsSchema,
  createProps: () => ({ color: 'ink', count: 1, fb: [] }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as BoardObject<TicksProps>,
  getLocalBounds: (o, ctx) => {
    const s = ticksShape(o, ctx);
    return s ? boundsOf([mid(s.a, s.b)], 12) : { x: 0, y: 0, width: 0, height: 0 };
  },
  hitTest: (o, point, tolerance, ctx) => {
    const s = ticksShape(o, ctx);
    return !!s && dist(point, mid(s.a, s.b)) <= 10 + tolerance;
  },
  getHandles: () => [],
  render: (o, ctx) => {
    const s = ticksShape(o, ctx);
    return s ? <TicksView s={s} p={o.props} ctx={ctx} /> : null;
  },
  toSVG: (o, ctx) => {
    const s = ticksShape(o, ctx);
    const color = ctx.resolveColor(o.props.color);
    return s ? ticksPoints(s, o.props.count, 1).map((q) => `<line x1="${q[0]}" y1="${q[1]}" x2="${q[2]}" y2="${q[3]}" stroke="${color}" stroke-width="2"/>`).join('') : '';
  },
  inspector: [
    { kind: 'color', key: 'color', label: 'Цвет' },
    { kind: 'number', key: 'count', label: 'Штрихов', min: 1, max: 3, step: 1 },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  hitPriority: 5,
};
