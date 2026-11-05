import type { ReactNode } from 'react';
import { Arrow, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { CELL, QUANTITIES, QUANTITY_INFO, fmt, type Quantity } from './quantities';
import { PLUGIN_ID } from './vectors';

export const AXES_TYPE = `${PLUGIN_ID}.axes`;
export const SCALE_TYPE = `${PLUGIN_ID}.scale`;
export const SCALE_EDITOR = 'physics.scale';

const LABEL = 18;
const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;

// =====================================================================
//  Оси координат (поворачиваются: ось x вдоль наклонной плоскости)
// =====================================================================

export const axesPropsSchema = z.object({
  /** Длина положительных полуосей и отрицательных частей. */
  len: z.number().finite().min(20).max(5000),
  neg: z.number().finite().min(0).max(5000),
  xLabel: z.string().max(8),
  yLabel: z.string().max(8),
  origin: z.string().max(8),
  color: z.string().max(32),
});
export type PhysAxesProps = z.infer<typeof axesPropsSchema>;
type AxesObject = BoardObject<PhysAxesProps>;

function AxesShape({ o, ctx }: { o: AxesObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const c = ctx.resolveColor(p.color);
  const head = { pointerLength: 11 / zoom, pointerWidth: 8 / zoom };
  return (
    <Group listening={false}>
      <Arrow points={[-p.neg, 0, p.len, 0]} stroke={c} fill={c} strokeWidth={1.5} strokeScaleEnabled={false} {...head} listening={false} />
      <Arrow points={[0, p.neg, 0, -p.len]} stroke={c} fill={c} strokeWidth={1.5} strokeScaleEnabled={false} {...head} listening={false} />
      <Text x={p.len - 4} y={6} text={p.xLabel} fontSize={LABEL} {...italic} fill={c} listening={false} />
      <Text x={8} y={-p.len - 4} text={p.yLabel} fontSize={LABEL} {...italic} fill={c} listening={false} />
      {p.origin && <Text x={-LABEL * 0.9} y={4} text={p.origin} fontSize={LABEL} {...italic} fill={c} listening={false} />}
    </Group>
  );
}

export const physAxesModule: ObjectModule<PhysAxesProps, ReactNode> = {
  type: AXES_TYPE,
  title: 'Оси координат',
  version: 1,
  propsSchema: axesPropsSchema,
  createProps: () => ({ len: 160, neg: 40, xLabel: 'x', yLabel: 'y', origin: 'O', color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as AxesObject,
  getLocalBounds: (o) => ({ x: -o.props.neg - LABEL, y: -o.props.len - LABEL, width: o.props.neg + o.props.len + LABEL * 2, height: o.props.neg + o.props.len + LABEL * 2 }),
  hitTest: (o, point, tol) => {
    const q = toLocal(o, point);
    const t = tol + 4;
    return (Math.abs(q.y) <= t && q.x >= -o.props.neg - t && q.x <= o.props.len + t) || (Math.abs(q.x) <= t && q.y <= o.props.neg + t && q.y >= -o.props.len - t);
  },
  getHandles: () => [],
  getSnapPoints: (o) => [{ kind: 'center', point: toWorld(o, { x: 0, y: 0 }) }],
  getSnapCurves: (o) => [
    { kind: 'segment', a: toWorld(o, { x: -o.props.neg, y: 0 }), b: toWorld(o, { x: o.props.len, y: 0 }) },
    { kind: 'segment', a: toWorld(o, { x: 0, y: o.props.neg }), b: toWorld(o, { x: 0, y: -o.props.len }) },
  ],
  render: (o, ctx) => <AxesShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const p = o.props;
    const c = ctx.resolveColor(p.color);
    return `<g transform="translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI})" stroke="${c}" stroke-width="1.5"><line x1="${-p.neg}" y1="0" x2="${p.len}" y2="0"/><line x1="0" y1="${p.neg}" x2="0" y2="${-p.len}"/><text x="${p.len - 4}" y="${6 + LABEL}" stroke="none" fill="${c}" font-style="italic" font-size="${LABEL}">${p.xLabel}</text><text x="8" y="${-p.len + LABEL - 4}" stroke="none" fill="${c}" font-style="italic" font-size="${LABEL}">${p.yLabel}</text></g>`;
  },
  inspector: [
    { kind: 'text', key: 'xLabel', label: 'Ось x', maxLength: 8 },
    { kind: 'text', key: 'yLabel', label: 'Ось y', maxLength: 8 },
    { kind: 'text', key: 'origin', label: 'Начало', maxLength: 8 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: true, resize: 'proportional' },
  applyResize: (o, sx) => ({ scaleX: 1, scaleY: 1, props: { len: Math.max(20, o.props.len * Math.abs(sx)), neg: Math.max(0, o.props.neg * Math.abs(sx)) } }),
};

/** Угол осей (против часовой стрелки, в градусах) по повороту объекта. */
export const axesAngleDeg = (o: Pick<BoardObject, 'rotation'>) => Math.round(((-o.rotation * 180) / Math.PI) * 100) / 100;

// =====================================================================
//  Масштаб: «1 клетка — 2 Н»
// =====================================================================

export const scalePropsSchema = z.object({ q: z.enum(QUANTITIES), perCell: z.number().finite().positive().max(1e9), color: z.string().max(32) });
export type ScaleProps = z.infer<typeof scalePropsSchema>;
type ScaleObject = BoardObject<ScaleProps>;

export function scaleText(p: Pick<ScaleProps, 'q' | 'perCell'>): string {
  const i = QUANTITY_INFO[p.q as Quantity];
  return `${i.symbol}: 1 клетка — ${fmt(p.perCell)}${i.unit ? ` ${i.unit}` : ''}`;
}

const scaleWidth = (p: ScaleProps) => CELL + 10 + scaleText(p).length * 8.2;

function ScaleShape({ o, ctx }: { o: ScaleObject; ctx: RenderContext }) {
  const c = ctx.resolveColor(o.props.color);
  return (
    <Group listening={false}>
      <Line points={[0, -5, 0, 5, 0, 0, CELL, 0, CELL, -5, CELL, 5]} stroke={c} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Text x={CELL + 10} y={-8} text={scaleText(o.props)} fontSize={15} fill={c} listening={false} />
    </Group>
  );
}

export const scaleModule: ObjectModule<ScaleProps, ReactNode> = {
  type: SCALE_TYPE,
  title: 'Масштаб',
  version: 1,
  propsSchema: scalePropsSchema,
  createProps: () => ({ q: 'force', perCell: 1, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as ScaleObject,
  getLocalBounds: (o) => ({ x: 0, y: -10, width: scaleWidth(o.props), height: 20 }),
  hitTest: (o, point, tol) => {
    const q = toLocal(o, point);
    return q.x >= -tol && q.x <= scaleWidth(o.props) + tol && Math.abs(q.y) <= 10 + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <ScaleShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    return `<g transform="translate(${o.x} ${o.y})"><path d="M0,-5V5M0,0H${CELL}M${CELL},-5V5" stroke="${c}" stroke-width="2"/><text x="${CELL + 10}" y="5" font-size="15" fill="${c}">${scaleText(o.props)}</text></g>`;
  },
  // Значение меняется в диалоге (двойной щелчок): он пересчитывает и векторы этой величины.
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  editor: SCALE_EDITOR,
  transform: { rotatable: false, resize: 'none' },
};
