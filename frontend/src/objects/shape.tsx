import { Arrow, Ellipse, Line, Rect as KRect } from 'react-konva';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { distanceToSegment, type BoardObject, type ObjectModule, type Point, type Rect } from '@doska/shared';
import { dashFor, localTolerance, toLocal, toWorld } from './util';

/**
 * Базовые фигуры: прямоугольник, эллипс, треугольник, отрезок, стрелка.
 * Геометрия задаётся в локальных координатах: прямоугольник (0,0)–(w,h);
 * для отрезка и стрелки — от (0,0) до (w,h) (w, h могут быть отрицательными).
 */
export const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line', 'arrow'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const shapePropsSchema = z.object({
  kind: z.enum(SHAPE_KINDS),
  w: z.number().finite().min(-1e6).max(1e6),
  h: z.number().finite().min(-1e6).max(1e6),
  stroke: z.string().max(32),
  fill: z.string().max(32),
  strokeWidth: z.number().finite().min(0.5).max(100),
  dash: z.enum(['solid', 'dashed', 'dotted']),
});
export type ShapeProps = z.infer<typeof shapePropsSchema>;
type ShapeObject = BoardObject<ShapeProps>;

export const isLinear = (k: ShapeKind) => k === 'line' || k === 'arrow';

function localBounds(p: ShapeProps): Rect {
  const pad = p.strokeWidth / 2 + (p.kind === 'arrow' ? p.strokeWidth * 3 : 0);
  const x0 = Math.min(0, p.w);
  const y0 = Math.min(0, p.h);
  return { x: x0 - pad, y: y0 - pad, width: Math.abs(p.w) + pad * 2, height: Math.abs(p.h) + pad * 2 };
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const s = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  const t = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) return false;
  const d = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  return d === 0 || (d < 0) === (s + t <= 0);
}

/** Попадание точки (локальные координаты) в фигуру с допуском tol. */
export function hitShape(p: ShapeProps, pt: Point, tol: number): boolean {
  const edge = tol + p.strokeWidth / 2;
  const filled = p.fill !== 'none';
  const x0 = Math.min(0, p.w);
  const y0 = Math.min(0, p.h);
  const x1 = Math.max(0, p.w);
  const y1 = Math.max(0, p.h);
  switch (p.kind) {
    case 'line':
    case 'arrow':
      return distanceToSegment(pt, { x: 0, y: 0 }, { x: p.w, y: p.h }) <= edge;
    case 'rect': {
      const inside = pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1;
      if (filled && inside) return true;
      const corners = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      return corners.some((a, i) => distanceToSegment(pt, a, corners[(i + 1) % 4]!) <= edge);
    }
    case 'ellipse': {
      const rx = (x1 - x0) / 2;
      const ry = (y1 - y0) / 2;
      if (rx < 1e-9 || ry < 1e-9) return distanceToSegment(pt, { x: x0, y: y0 }, { x: x1, y: y1 }) <= edge;
      const nx = (pt.x - (x0 + rx)) / rx;
      const ny = (pt.y - (y0 + ry)) / ry;
      const d = Math.hypot(nx, ny);
      if (filled && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(rx, ry) <= edge;
    }
    case 'triangle': {
      const a = { x: x0 + (x1 - x0) / 2, y: y0 };
      const b = { x: x1, y: y1 };
      const c = { x: x0, y: y1 };
      if (filled && pointInTriangle(pt, a, b, c)) return true;
      return [a, b, c].some((v, i) => distanceToSegment(pt, v, [a, b, c][(i + 1) % 3]!) <= edge);
    }
  }
}

export const shapeModule: ObjectModule<ShapeProps, ReactNode> = {
  type: 'core.shape',
  title: 'Фигура',
  version: 1,
  propsSchema: shapePropsSchema,
  createProps: () => ({ kind: 'rect', w: 100, h: 60, stroke: 'ink', fill: 'none', strokeWidth: 2, dash: 'solid' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as ShapeObject,
  getLocalBounds: (o) => localBounds(o.props),
  hitTest: (o, point, tolerance) => hitShape(o.props, toLocal(o, point), localTolerance(o, tolerance)),
  getHandles: (o) =>
    isLinear(o.props.kind)
      ? [
          { id: 'start', kind: 'point', position: toWorld(o, { x: 0, y: 0 }), label: 'Начало', snap: true },
          { id: 'end', kind: 'point', position: toWorld(o, { x: o.props.w, y: o.props.h }), label: 'Конец', snap: true },
        ]
      : [],
  dragHandle: (o, handleId, to) => {
    const local = toLocal(o, to);
    if (handleId === 'end') return { props: { w: local.x, h: local.y } };
    if (handleId === 'start') return { x: to.x, y: to.y, props: { w: o.props.w - local.x, h: o.props.h - local.y } };
    return null;
  },
  getSnapPoints: (o) => {
    const p = o.props;
    if (isLinear(p.kind)) {
      return [
        { kind: 'endpoint', point: toWorld(o, { x: 0, y: 0 }) },
        { kind: 'endpoint', point: toWorld(o, { x: p.w, y: p.h }) },
        { kind: 'midpoint', point: toWorld(o, { x: p.w / 2, y: p.h / 2 }) },
      ];
    }
    const pts = [
      { kind: 'center' as const, point: toWorld(o, { x: p.w / 2, y: p.h / 2 }) },
      { kind: 'vertex' as const, point: toWorld(o, { x: 0, y: 0 }) },
      { kind: 'vertex' as const, point: toWorld(o, { x: p.w, y: 0 }) },
      { kind: 'vertex' as const, point: toWorld(o, { x: p.w, y: p.h }) },
      { kind: 'vertex' as const, point: toWorld(o, { x: 0, y: p.h }) },
    ];
    return p.kind === 'rect' ? pts : pts.slice(0, 1);
  },
  render: (o, ctx) => {
    const p = o.props;
    const stroke = ctx.resolveColor(p.stroke);
    const fill = p.fill === 'none' ? undefined : ctx.resolveColor(p.fill);
    const common = {
      stroke,
      strokeWidth: p.strokeWidth,
      strokeScaleEnabled: false,
      dash: dashFor(p.dash, p.strokeWidth),
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
      perfectDrawEnabled: false,
      listening: false,
    };
    switch (p.kind) {
      case 'rect':
        return <KRect x={Math.min(0, p.w)} y={Math.min(0, p.h)} width={Math.abs(p.w)} height={Math.abs(p.h)} fill={fill} {...common} />;
      case 'ellipse':
        return <Ellipse x={p.w / 2} y={p.h / 2} radiusX={Math.abs(p.w) / 2} radiusY={Math.abs(p.h) / 2} fill={fill} {...common} />;
      case 'triangle':
        return <Line points={[p.w / 2, 0, p.w, p.h, 0, p.h]} closed fill={fill} {...common} />;
      case 'line':
        return <Line points={[0, 0, p.w, p.h]} {...common} />;
      case 'arrow':
        return (
          <Arrow
            points={[0, 0, p.w, p.h]}
            fill={stroke}
            pointerLength={p.strokeWidth * 4 + 4}
            pointerWidth={p.strokeWidth * 3 + 4}
            {...common}
          />
        );
    }
  },
  toSVG: (o, ctx) => {
    const p = o.props;
    const stroke = ctx.resolveColor(p.stroke);
    const fill = p.fill === 'none' ? 'none' : ctx.resolveColor(p.fill);
    const attrs = `stroke="${stroke}" stroke-width="${p.strokeWidth}" fill="${fill}" vector-effect="non-scaling-stroke"`;
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    const body =
      p.kind === 'rect'
        ? `<rect x="${Math.min(0, p.w)}" y="${Math.min(0, p.h)}" width="${Math.abs(p.w)}" height="${Math.abs(p.h)}" ${attrs}/>`
        : p.kind === 'ellipse'
          ? `<ellipse cx="${p.w / 2}" cy="${p.h / 2}" rx="${Math.abs(p.w) / 2}" ry="${Math.abs(p.h) / 2}" ${attrs}/>`
          : p.kind === 'triangle'
            ? `<polygon points="${p.w / 2},0 ${p.w},${p.h} 0,${p.h}" ${attrs}/>`
            : `<line x1="0" y1="0" x2="${p.w}" y2="${p.h}" ${attrs}/>`;
    return `<g transform="${tr}">${body}</g>`;
  },
  inspector: [
    { kind: 'color', key: 'stroke', label: 'Цвет линии' },
    { kind: 'color', key: 'fill', label: 'Заливка' },
    { kind: 'stroke-width', key: 'strokeWidth', label: 'Толщина' },
    { kind: 'line-style', key: 'dash', label: 'Стиль линии' },
  ],
  transform: { rotatable: true, resize: 'free' },
};
