import type { ReactNode } from 'react';
import { Shape } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point } from '@doska/shared';
import { localTolerance, toLocal, toWorld } from '../util';
import { hitStroke, pointCount, strokeBounds, strokeOutline } from './geometry';

export const STROKE_TYPE = 'core.stroke';
/** Предел точек одного штриха (после упрощения); длинный росчерк делится на несколько штрихов. */
export const MAX_STROKE_POINTS = 5000;

export const strokePropsSchema = z.object({
  /** Плоский массив [x, y, нажатие, …] в локальных координатах объекта. */
  points: z
    .array(z.number().finite())
    .min(3)
    .max(MAX_STROKE_POINTS * 3)
    .refine((a) => a.length % 3 === 0, 'Неверное число координат'),
  color: z.string().max(32),
  /** Номинальная толщина в мировых единицах (при нажатии 0,5). */
  width: z.number().finite().positive().max(10_000),
  opacity: z.number().finite().min(0.05).max(1),
  /** Толщина зависит от нажатия (перо); без — ровная линия (маркер, распознанный многоугольник). */
  pressure: z.boolean(),
  /** Замкнутая ломаная (распознанный треугольник или четырёхугольник). */
  closed: z.boolean().optional(),
  kind: z.enum(['pen', 'marker']),
});
export type StrokeProps = z.infer<typeof strokePropsSchema>;
type StrokeObject = BoardObject<StrokeProps>;

/**
 * Путь по точкам со сглаживанием: квадратичные кривые через середины
 * отрезков (опорные точки — вершины ломаной). Упрощённый штрих при
 * увеличении не выглядит «гранёным».
 */
export function smoothPath(xy: readonly number[], closed: boolean): Path2D {
  const path = new Path2D();
  const n = xy.length / 2;
  if (n === 0) return path;
  const x = (i: number) => xy[((i + n) % n) * 2]!;
  const y = (i: number) => xy[((i + n) % n) * 2 + 1]!;
  if (n < 3) {
    path.moveTo(x(0), y(0));
    for (let i = 1; i < n; i++) path.lineTo(x(i), y(i));
    if (closed) path.closePath();
    return path;
  }
  if (closed) {
    path.moveTo((x(-1) + x(0)) / 2, (y(-1) + y(0)) / 2);
    for (let i = 0; i < n; i++) path.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
    path.closePath();
    return path;
  }
  path.moveTo(x(0), y(0));
  for (let i = 1; i < n - 1; i++) path.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  path.lineTo(x(n - 1), y(n - 1));
  return path;
}

/** Только координаты (без нажатия). */
export function xyOf(flat: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 3) out.push(flat[i]!, flat[i + 1]!);
  return out;
}

// Готовые пути по массиву точек: штрих перерисовывается при любом
// изменении слоя, а точки меняются редко.
const pathCache = new WeakMap<readonly number[], { key: string; path: Path2D }>();

function cachedPath(p: Pick<StrokeProps, 'points' | 'width' | 'pressure' | 'closed'>): Path2D {
  const key = `${p.width}|${p.pressure}|${!!p.closed}`;
  const hit = pathCache.get(p.points);
  if (hit && hit.key === key) return hit.path;
  const path = p.pressure && !p.closed ? smoothPath(strokeOutline(p.points, p.width, true), true) : smoothPath(xyOf(p.points), !!p.closed);
  pathCache.set(p.points, { key, path });
  return path;
}

/**
 * Отрисовка штриха (и для документа, и для «живого» штриха в оверлее).
 * С нажатием — заливка контура переменной толщины; без — линия ровной
 * толщины со скруглёнными концами. Прозрачность применяется ко всему
 * штриху целиком, поэтому самопересечения маркера не темнее остального.
 */
export function StrokeShape({ props, color }: { props: Pick<StrokeProps, 'points' | 'width' | 'pressure' | 'closed' | 'opacity'>; color: string }) {
  const b = strokeBounds(props.points, props.width, props.pressure);
  return (
    <Shape
      x={b.x}
      y={b.y}
      width={b.width}
      height={b.height}
      opacity={props.opacity}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        // Нативный контекст: обёртка Konva не поддерживает Path2D и присваивание стилей.
        const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
        native.save();
        native.translate(-b.x, -b.y);
        const path = cachedPath(props);
        if (props.pressure && !props.closed) {
          native.fillStyle = color;
          native.fill(path, 'nonzero');
        } else {
          native.strokeStyle = color;
          native.lineWidth = props.width;
          native.lineCap = 'round';
          native.lineJoin = 'round';
          native.stroke(path);
        }
        native.restore();
      }}
    />
  );
}

function svgPath(xy: readonly number[], closed: boolean): string {
  const n = xy.length / 2;
  if (!n) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(xy[0]!)} ${f(xy[1]!)}`;
  for (let i = 1; i < n; i++) d += ` L${f(xy[i * 2]!)} ${f(xy[i * 2 + 1]!)}`;
  return closed ? d + ' Z' : d;
}

export const strokeModule: ObjectModule<StrokeProps, ReactNode> = {
  type: STROKE_TYPE,
  title: 'Рисунок от руки',
  version: 1,
  propsSchema: strokePropsSchema,
  createProps: () => ({ points: [0, 0, 0.5], color: 'ink', width: 3, opacity: 1, pressure: true, kind: 'pen' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as StrokeObject,
  getLocalBounds: (o) => strokeBounds(o.props.points, o.props.width, o.props.pressure),
  hitTest: (o, point, tolerance) =>
    hitStroke(o.props.points, o.props.width, o.props.pressure, toLocal(o, point), localTolerance(o, tolerance), !!o.props.closed),
  getHandles: () => [],
  getSnapPoints: (o) => {
    const n = pointCount(o.props.points);
    const pt = (i: number): Point => toWorld(o, { x: o.props.points[i * 3]!, y: o.props.points[i * 3 + 1]! });
    // Вершины распознанного многоугольника; у рукописного штриха — концы.
    if (o.props.closed) return Array.from({ length: n }, (_, i) => ({ kind: 'vertex' as const, point: pt(i) }));
    return n > 1 ? [{ kind: 'endpoint', point: pt(0) }, { kind: 'endpoint', point: pt(n - 1) }] : [];
  },
  getSnapCurves: (o) =>
    o.props.closed ? [{ kind: 'polyline', points: Array.from({ length: pointCount(o.props.points) }, (_, i) => toWorld(o, { x: o.props.points[i * 3]!, y: o.props.points[i * 3 + 1]! })), closed: true }] : [],
  render: (o, ctx) => <StrokeShape props={o.props} color={ctx.resolveColor(o.props.color)} />,
  toSVG: (o, ctx) => {
    const p = o.props;
    const color = ctx.resolveColor(p.color);
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    const body =
      p.pressure && !p.closed
        ? `<path d="${svgPath(strokeOutline(p.points, p.width, true), true)}" fill="${color}"/>`
        : `<path d="${svgPath(xyOf(p.points), !!p.closed)}" fill="none" stroke="${color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<g transform="${tr}" opacity="${p.opacity}">${body}</g>`;
  },
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  transform: { rotatable: true, resize: 'free' },
};
