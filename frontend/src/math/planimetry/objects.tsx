import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point, Rect, RenderContext, ResolveContext, SnapCurve, SnapPoint } from '@doska/shared';
import { useBoard } from '../../store/board';
import { dashFor } from '../../objects/util';
import { SURFACE_COLORS } from '../../objects/colors';
import {
  arcGeom,
  arcPoints,
  boundsOf,
  dist,
  distToArc,
  distToLinear,
  distToPolyline,
  ellipseGeom,
  ellipsePoints,
  insidePolygon,
  mid,
  polar,
  regularPolygon,
  sub,
  type ArcGeom,
  type EllipseGeom,
} from './geometry';

export const PLUGIN_ID = 'math.planimetry';
export const POINT_TYPE = `${PLUGIN_ID}.point`;

/** Длина, на которую рисуются прямая и луч (за пределами любого разумного вида). */
const FAR = 200_000;
/** Опорная часть прямой и луча для габарита («Показать всё»). */
const NEAR = 400;

// =====================================================================
//  Точка
// =====================================================================

export const pointPropsSchema = z.object({
  /** Подпись (A, B, C₁…); пусто — без подписи. */
  label: z.string().max(20),
  color: z.string().max(32),
  /** Радиус на экране, пт. */
  size: z.number().finite().min(2).max(16),
  /** Создана инструментом вместе с построением: удаляется вместе с ним, если больше никому не нужна. */
  auto: z.boolean(),
});
export type PointProps = z.infer<typeof pointPropsSchema>;
type PointObject = BoardObject<PointProps>;

const LABEL_SIZE = 20;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);

function PointShape({ p, ctx }: { p: PointProps; ctx: RenderContext }) {
  const zoom = useZoom();
  const r = p.size / zoom;
  const color = ctx.resolveColor(p.color);
  return (
    <>
      <Circle radius={r} fill={color} stroke={SURFACE_COLORS[ctx.theme].paper} strokeWidth={1.5} strokeScaleEnabled={false} perfectDrawEnabled={false} listening={false} />
      {p.label && (
        <Text x={r + 2} y={-r - LABEL_SIZE - 2} text={p.label} fontSize={LABEL_SIZE} fontStyle="italic" fontFamily="Times New Roman, serif" fill={color} listening={false} />
      )}
    </>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const pointModule: ObjectModule<PointProps, ReactNode> = {
  type: POINT_TYPE,
  title: 'Точка',
  version: 1,
  propsSchema: pointPropsSchema,
  createProps: () => ({ label: '', color: 'ink', size: 4, auto: false }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as PointObject,
  // Подпись входит в габарит: её видно при «Показать всё» и выделении рамкой.
  getLocalBounds: (o) => ({ x: -8, y: o.props.label ? -LABEL_SIZE - 8 : -8, width: o.props.label ? 16 + LABEL_SIZE * 0.6 * o.props.label.length : 16, height: o.props.label ? LABEL_SIZE + 16 : 16 }),
  hitTest: (o, point, tolerance) => dist(point, o) <= tolerance + 4,
  getHandles: () => [],
  getSnapPoints: (o) => [{ kind: 'anchor', point: { x: o.x, y: o.y }, refId: o.id }],
  render: (o, ctx) => <PointShape p={o.props} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const color = ctx.resolveColor(o.props.color);
    const label = o.props.label
      ? `<text x="${o.x + 6}" y="${o.y - 6}" font-size="${LABEL_SIZE}" font-style="italic" font-family="Times New Roman, serif" fill="${color}">${esc(o.props.label)}</text>`
      : '';
    return `<circle cx="${o.x}" cy="${o.y}" r="${o.props.size}" fill="${color}"/>${label}`;
  },
  inspector: [
    { kind: 'text', key: 'label', label: 'Подпись', maxLength: 20 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
  hitPriority: 10,
};

// =====================================================================
//  Фигуры на точках (динамическая геометрия)
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
  /** Число сторон правильного многоугольника. */
  n: z.number().int().min(3).max(24).optional(),
  /**
   * Координаты опор на момент создания (x, y подряд): чем нарисовать
   * построение, если опору удалил другой участник («нет опоры»).
   */
  fb: z.array(z.number().finite()).max(128),
});
export type FigureProps = z.infer<typeof figurePropsSchema>;
type FigureObject = BoardObject<FigureProps>;

/** Форма фигуры, вычисленная по точкам. */
export type FigureShape =
  | { kind: 'linear'; a: Point; b: Point; mode: 'segment' | 'ray' | 'line' | 'vector' }
  | { kind: 'poly'; pts: Point[]; closed: boolean }
  | { kind: 'circle'; c: Point; r: number }
  | { kind: 'arc'; g: ArcGeom; mode: 'arc' | 'sector' | 'segment' }
  | { kind: 'ellipse'; g: EllipseGeom };

export interface FigureDef {
  name: string;
  title: string;
  /** Сколько опорных точек (null — любое число ≥ minPoints). */
  points: number | null;
  minPoints?: number;
  closed: boolean;
  shape(pts: Point[], p: FigureProps): FigureShape;
}

/** Положения опор; последние известные — для «нет опоры». */
const lastKnown = new Map<string, Point[]>();

export function resolvePoints(o: FigureObject, ctx: ResolveContext): { pts: Point[]; missing: boolean } | null {
  const pts: Point[] = [];
  let missing = false;
  o.deps.forEach((id, i) => {
    const d = ctx.getObject(id);
    if (d) pts.push({ x: d.x, y: d.y });
    else {
      missing = true;
      const fb = lastKnown.get(o.id)?.[i] ?? (o.props.fb.length > i * 2 + 1 ? { x: o.props.fb[i * 2]!, y: o.props.fb[i * 2 + 1]! } : null);
      if (fb) pts.push(fb);
    }
  });
  if (pts.length !== o.deps.length) return null;
  if (!missing) lastKnown.set(o.id, pts);
  return { pts, missing };
}

function shapeOf(def: FigureDef, o: FigureObject, ctx: ResolveContext): { s: FigureShape; missing: boolean } | null {
  const r = resolvePoints(o, ctx);
  return r ? { s: def.shape(r.pts, o.props), missing: r.missing } : null;
}

function dir(a: Point, b: Point): Point {
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

/** Точки отрисовки линейной фигуры. */
function linearEnds(s: Extract<FigureShape, { kind: 'linear' }>, far: number): [Point, Point] {
  const d = dir(s.a, s.b);
  if (s.mode === 'line') return [{ x: s.a.x - d.x * far, y: s.a.y - d.y * far }, { x: s.a.x + d.x * far, y: s.a.y + d.y * far }];
  if (s.mode === 'ray') return [s.a, { x: s.a.x + d.x * far, y: s.a.y + d.y * far }];
  return [s.a, s.b];
}

/** Контур фигуры ломаной (для дуг, эллипса, многоугольника). */
function outline(s: FigureShape): { pts: Point[]; closed: boolean } {
  switch (s.kind) {
    case 'linear':
      return { pts: linearEnds(s, NEAR), closed: false };
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

function snapPoints(o: FigureObject, s: FigureShape): SnapPoint[] {
  // Опорные точки — сами объекты-точки (refId — точка, а не фигура).
  const out: SnapPoint[] = [];
  const at = (kind: SnapPoint['kind'], point: Point) => out.push({ kind, point });
  switch (s.kind) {
    case 'linear':
      if (s.mode !== 'line') at('midpoint', mid(s.a, s.b));
      break;
    case 'poly': {
      const n = s.closed ? s.pts.length : s.pts.length - 1;
      for (let i = 0; i < n; i++) at('midpoint', mid(s.pts[i]!, s.pts[(i + 1) % s.pts.length]!));
      // Вершины правильного многоугольника, кроме двух опорных, — свои точки привязки.
      if (o.props.n) s.pts.slice(2).forEach((p) => at('vertex', p));
      break;
    }
    case 'circle':
      at('center', s.c);
      for (let k = 0; k < 4; k++) at('quadrant', polar(s.c, s.r, (k * Math.PI) / 2));
      break;
    case 'arc':
      at('center', s.g.center);
      at('endpoint', polar(s.g.center, s.g.radius, s.g.start - s.g.sweep));
      break;
    case 'ellipse':
      at('center', s.g.center);
      break;
  }
  return out;
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
  const fill = p.fill && !missing ? color : undefined;
  let body: ReactNode;
  let labelAt: Point;
  if (s.kind === 'linear') {
    const [a, b] = linearEnds(s, FAR);
    body =
      s.mode === 'vector' ? (
        <Arrow points={[a.x, a.y, b.x, b.y]} fill={color} pointerLength={(p.width * 4 + 6) / zoom} pointerWidth={(p.width * 3 + 6) / zoom} {...common} />
      ) : (
        <Line points={[a.x, a.y, b.x, b.y]} {...common} />
      );
    labelAt = mid(s.a, s.b);
  } else if (s.kind === 'circle') {
    body = <Circle x={s.c.x} y={s.c.y} radius={s.r} {...common} />;
    labelAt = polar(s.c, s.r, -Math.PI / 4);
  } else {
    const o = outline(s);
    body = <Line points={o.pts.flatMap((q) => [q.x, q.y])} closed={o.closed} {...common} />;
    labelAt = s.kind === 'poly' ? o.pts[0]! : s.kind === 'arc' ? polar(s.g.center, s.g.radius, s.g.start - s.g.sweep / 2) : ellipsePoints(s.g, 8)[7]!;
  }
  const area = fill
    ? (() => {
        const o = s.kind === 'linear' ? null : outline(s);
        return o && o.closed ? <Line points={o.pts.flatMap((q) => [q.x, q.y])} closed fill={fill} opacity={0.12} listening={false} perfectDrawEnabled={false} /> : null;
      })()
    : null;
  return (
    <Group>
      {area}
      {body}
      {p.label && <Text x={labelAt.x + 6} y={labelAt.y - LABEL_SIZE - 4} text={p.label} fontSize={LABEL_SIZE} fontStyle="italic" fontFamily="Times New Roman, serif" fill={color} listening={false} />}
      {missing && <Text x={labelAt.x + 6} y={labelAt.y + 6} text="нет опоры" fontSize={14} fill={color} listening={false} />}
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
    const d = dir(a, b);
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

const LINE_INSPECTOR = [
  { kind: 'color', key: 'color', label: 'Цвет' },
  { kind: 'stroke-width', key: 'width', label: 'Толщина' },
  { kind: 'line-style', key: 'dash', label: 'Линия' },
  { kind: 'text', key: 'label', label: 'Подпись', maxLength: 20 },
] as const;

/** Модуль фигуры по описанию: всё общее (габарит, попадание, привязки, отрисовка) — здесь. */
export function figureModule(def: FigureDef): ObjectModule<FigureProps, ReactNode> {
  const unbounded = def.name === 'line' || def.name === 'ray';
  return {
    type: `${PLUGIN_ID}.${def.name}`,
    title: def.title,
    version: 1,
    propsSchema: figurePropsSchema,
    createProps: () => ({ color: 'ink', width: 2, dash: 'solid', label: '', fill: false, fb: [] }),
    serialize: (o) => o,
    deserialize: (raw) => raw as unknown as FigureObject,
    getLocalBounds: (o, ctx): Rect => {
      const r = shapeOf(def, o, ctx);
      if (!r) return { x: 0, y: 0, width: 0, height: 0 };
      return boundsOf(outline(r.s).pts, 4);
    },
    hitTest: (o, point, tolerance, ctx) => {
      const r = shapeOf(def, o, ctx);
      return !!r && hit(r.s, point, tolerance + 2, o.props.fill);
    },
    getHandles: () => [],
    getSnapPoints: (o, ctx) => {
      const r = shapeOf(def, o, ctx);
      return r && !r.missing ? snapPoints(o, r.s) : [];
    },
    getSnapCurves: (o, ctx) => {
      const r = shapeOf(def, o, ctx);
      return r && !r.missing ? snapCurves(r.s) : [];
    },
    render: (o, ctx) => {
      const r = shapeOf(def, o, ctx);
      return r ? <FigureShapeView s={r.s} p={o.props} ctx={ctx} missing={r.missing} /> : null;
    },
    toSVG: (o, ctx) => {
      const r = shapeOf(def, o, ctx);
      return r ? svgOf(r.s, o.props, ctx.resolveColor(r.missing ? 'muted' : o.props.color)) : '';
    },
    inspector: def.closed ? [...LINE_INSPECTOR, { kind: 'toggle', key: 'fill', label: 'Заливка' }] : [...LINE_INSPECTOR],
    transform: { rotatable: false, resize: 'none' },
    derived: true,
    unbounded,
  };
}

/** Описания фигур 6.1a. */
export const FIGURES: FigureDef[] = [
  { name: 'segment', title: 'Отрезок', points: 2, closed: false, shape: ([a, b]) => ({ kind: 'linear', a: a!, b: b!, mode: 'segment' }) },
  { name: 'ray', title: 'Луч', points: 2, closed: false, shape: ([a, b]) => ({ kind: 'linear', a: a!, b: b!, mode: 'ray' }) },
  { name: 'line', title: 'Прямая', points: 2, closed: false, shape: ([a, b]) => ({ kind: 'linear', a: a!, b: b!, mode: 'line' }) },
  { name: 'vector', title: 'Вектор', points: 2, closed: false, shape: ([a, b]) => ({ kind: 'linear', a: a!, b: b!, mode: 'vector' }) },
  { name: 'polyline', title: 'Ломаная', points: null, minPoints: 2, closed: false, shape: (pts) => ({ kind: 'poly', pts, closed: false }) },
  { name: 'polygon', title: 'Многоугольник', points: null, minPoints: 3, closed: true, shape: (pts) => ({ kind: 'poly', pts, closed: true }) },
  {
    name: 'regular-polygon',
    title: 'Правильный многоугольник',
    points: 2,
    closed: true,
    shape: ([a, b], p) => ({ kind: 'poly', pts: regularPolygon(a!, b!, p.n ?? 6), closed: true }),
  },
  { name: 'circle', title: 'Окружность', points: 2, closed: true, shape: ([c, t]) => ({ kind: 'circle', c: c!, r: dist(c!, t!) }) },
  { name: 'arc', title: 'Дуга', points: 3, closed: false, shape: ([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'arc' }) },
  { name: 'sector', title: 'Сектор', points: 3, closed: true, shape: ([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'sector' }) },
  { name: 'circle-segment', title: 'Сегмент круга', points: 3, closed: true, shape: ([c, a, b]) => ({ kind: 'arc', g: arcGeom(c!, a!, b!), mode: 'segment' }) },
  { name: 'ellipse', title: 'Эллипс', points: 3, closed: true, shape: ([c, a, b]) => ({ kind: 'ellipse', g: ellipseGeom(c!, a!, b!) }) },
];

export const figureModules = FIGURES.map(figureModule);
export const figureType = (name: string) => `${PLUGIN_ID}.${name}`;
export const figureDef = (name: string) => FIGURES.find((f) => f.name === name)!;
