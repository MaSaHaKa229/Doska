import type { ReactNode } from 'react';
import { Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext, SnapPoint } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { PLUGIN_ID } from './vectors';

export const BODY_TYPE = `${PLUGIN_ID}.body`;
export const SUPPORT_TYPE = `${PLUGIN_ID}.support`;

const LABEL = 18;
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;

// =====================================================================
//  Тело: брусок, шар, материальная точка
// =====================================================================

export const BODY_KINDS = ['block', 'ball', 'point'] as const;
export type PhysBodyKind = (typeof BODY_KINDS)[number];
export const BODY_KIND_TITLES: Record<PhysBodyKind, string> = { block: 'Брусок', ball: 'Шар', point: 'Материальная точка' };

export const bodyPropsSchema = z.object({
  kind: z.enum(BODY_KINDS),
  /** Брусок: ширина и высота; шар: w — диаметр. Центр тела — (0, 0). */
  w: z.number().finite().min(4).max(5000),
  h: z.number().finite().min(4).max(5000),
  /** Подпись в теле или рядом: «m», «1», «M». */
  label: z.string().max(12),
  color: z.string().max(32),
  fill: z.string().max(32),
});
export type BodyProps = z.infer<typeof bodyPropsSchema>;
type BodyObject = BoardObject<BodyProps>;

const POINT_R = 5;

/** Габарит тела в локальных координатах (центр — в нуле). */
function half(p: BodyProps): { hw: number; hh: number } {
  if (p.kind === 'point') return { hw: POINT_R, hh: POINT_R };
  if (p.kind === 'ball') return { hw: p.w / 2, hh: p.w / 2 };
  return { hw: p.w / 2, hh: p.h / 2 };
}

function BodyShape({ o, ctx }: { o: BodyObject; ctx: RenderContext }) {
  const p = o.props;
  const c = ctx.resolveColor(p.color);
  const f = ctx.resolveColor(p.fill);
  const { hw, hh } = half(p);
  return (
    <Group listening={false}>
      {p.kind === 'block' && <KRect x={-hw} y={-hh} width={hw * 2} height={hh * 2} stroke={c} strokeWidth={2} fill={f} strokeScaleEnabled={false} listening={false} />}
      {p.kind === 'ball' && <Circle radius={hw} stroke={c} strokeWidth={2} fill={f} strokeScaleEnabled={false} listening={false} />}
      {p.kind === 'point' && <Circle radius={POINT_R} fill={c} listening={false} />}
      {p.label &&
        (p.kind === 'point' ? (
          <Text x={POINT_R + 3} y={-POINT_R - LABEL} text={p.label} fontSize={LABEL} fontStyle="italic" fontFamily="Times New Roman, serif" fill={c} listening={false} />
        ) : (
          <Text x={-hw} y={-LABEL / 2} width={hw * 2} align="center" text={p.label} fontSize={LABEL} fontStyle="italic" fontFamily="Times New Roman, serif" fill={c} listening={false} />
        ))}
    </Group>
  );
}

export const physBodyModule: ObjectModule<BodyProps, ReactNode> = {
  type: BODY_TYPE,
  title: 'Тело',
  version: 1,
  propsSchema: bodyPropsSchema,
  createProps: () => ({ kind: 'block', w: 80, h: 50, label: 'm', color: 'ink', fill: 'none' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BodyObject,
  getLocalBounds: (o) => {
    const { hw, hh } = half(o.props);
    return { x: -hw, y: -hh, width: hw * 2, height: hh * 2 };
  },
  hitTest: (o, point, tol) => {
    const q = toLocal(o, point);
    const { hw, hh } = half(o.props);
    if (o.props.kind === 'block') return Math.abs(q.x) <= hw + tol && Math.abs(q.y) <= hh + tol;
    return Math.hypot(q.x, q.y) <= hw + tol + (o.props.kind === 'point' ? 3 : 0);
  },
  getHandles: () => [],
  // Точки приложения сил: центр, середины граней, углы; у шара — четыре точки окружности.
  getSnapPoints: (o) => {
    const { hw, hh } = half(o.props);
    const pts: [number, number, SnapPoint['kind']][] = [[0, 0, 'center']];
    if (o.props.kind !== 'point')
      pts.push(
        [0, -hh, 'midpoint'],
        [0, hh, 'midpoint'],
        [-hw, 0, 'midpoint'],
        [hw, 0, 'midpoint'],
      );
    if (o.props.kind === 'block')
      pts.push(
        [-hw, -hh, 'vertex'],
        [hw, -hh, 'vertex'],
        [hw, hh, 'vertex'],
        [-hw, hh, 'vertex'],
      );
    return pts.map(([x, y, kind]) => ({ kind, point: toWorld(o, { x, y }) }));
  },
  render: (o, ctx) => <BodyShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const p = o.props;
    const c = ctx.resolveColor(p.color);
    const f = p.fill === 'none' ? 'none' : ctx.resolveColor(p.fill);
    const { hw, hh } = half(p);
    const t = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    const shape = p.kind === 'block' ? `<rect x="${-hw}" y="${-hh}" width="${hw * 2}" height="${hh * 2}" stroke="${c}" stroke-width="2" fill="${f}"/>` : p.kind === 'ball' ? `<circle r="${hw}" stroke="${c}" stroke-width="2" fill="${f}"/>` : `<circle r="${POINT_R}" fill="${c}"/>`;
    return `<g transform="${t}">${shape}${p.label ? `<text x="${p.kind === 'point' ? POINT_R + 3 : 0}" y="${p.kind === 'point' ? -POINT_R - 3 : LABEL * 0.35}" text-anchor="${p.kind === 'point' ? 'start' : 'middle'}" font-size="${LABEL}" font-style="italic" fill="${c}">${p.label.replace(/</g, '&lt;')}</text>` : ''}</g>`;
  },
  inspector: [
    {
      kind: 'select',
      key: 'kind',
      label: 'Вид',
      options: BODY_KINDS.map((k) => ({ value: k, label: BODY_KIND_TITLES[k] })),
    },
    { kind: 'text', key: 'label', label: 'Подпись', maxLength: 12 },
    { kind: 'color', key: 'color', label: 'Контур' },
    { kind: 'color', key: 'fill', label: 'Заливка' },
  ],
  transform: { rotatable: true, resize: 'free' },
  // Растяжение меняет размеры тела, а не масштаб (контур и подпись не растягиваются).
  applyResize: (o, sx, sy) => {
    const p = o.props;
    if (p.kind === 'point') return { scaleX: 1, scaleY: 1 };
    if (p.kind === 'ball') return { scaleX: 1, scaleY: 1, props: { w: Math.max(4, p.w * Math.max(Math.abs(sx), Math.abs(sy))) } };
    return { scaleX: 1, scaleY: 1, props: { w: Math.max(4, p.w * Math.abs(sx)), h: Math.max(4, p.h * Math.abs(sy)) } };
  },
};

// =====================================================================
//  Опора: поверхность со штриховкой, подвес
// =====================================================================

export const SUPPORT_KINDS = ['surface', 'mount'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
export const SUPPORT_TITLES: Record<SupportKind, string> = { surface: 'Опора (пол, стена, наклонная)', mount: 'Подвес' };

export const supportPropsSchema = z.object({
  kind: z.enum(SUPPORT_KINDS),
  /** Длина вдоль линии опоры; линия — от (0, 0) до (len, 0), штриховка — снизу (поворотом — стена, потолок, наклон). */
  len: z.number().finite().min(10).max(10000),
  color: z.string().max(32),
  label: z.string().max(12),
});
export type SupportProps = z.infer<typeof supportPropsSchema>;
type SupportObject = BoardObject<SupportProps>;

const HATCH = 12;
const HATCH_STEP = 10;

function SupportShape({ o, ctx }: { o: SupportObject; ctx: RenderContext }) {
  const p = o.props;
  const c = ctx.resolveColor(p.color);
  const below = p.kind === 'surface';
  return (
    <Group listening={false}>
      <Line points={[0, 0, p.len, 0]} stroke={c} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Shape
        sceneFunc={(cx, shape) => {
          const g = raw(cx);
          g.beginPath();
          // Штриховка: короткие наклонные штрихи с одной стороны линии.
          for (let x = 0; x <= p.len - HATCH_STEP / 2; x += HATCH_STEP) {
            g.moveTo(x + HATCH_STEP, 0);
            g.lineTo(x + HATCH_STEP - HATCH, below ? HATCH : -HATCH);
          }
          cx.strokeShape(shape);
        }}
        stroke={c}
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />
      {p.kind === 'mount' && <Circle x={p.len / 2} y={0} radius={3.5} fill={c} listening={false} />}
      {p.label && <Text x={p.len + 6} y={-LABEL / 2} text={p.label} fontSize={LABEL} fontStyle="italic" fontFamily="Times New Roman, serif" fill={c} listening={false} />}
    </Group>
  );
}

export const supportModule: ObjectModule<SupportProps, ReactNode> = {
  type: SUPPORT_TYPE,
  title: 'Опора',
  version: 1,
  propsSchema: supportPropsSchema,
  createProps: () => ({ kind: 'surface', len: 240, color: 'ink', label: '' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as SupportObject,
  getLocalBounds: (o) => ({ x: 0, y: -HATCH, width: o.props.len, height: HATCH * 2 }),
  hitTest: (o, point, tol) => {
    const q = toLocal(o, point);
    return q.x >= -tol && q.x <= o.props.len + tol && Math.abs(q.y) <= HATCH + tol;
  },
  getHandles: () => [],
  getSnapPoints: (o) => [
    { kind: 'endpoint', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'endpoint', point: toWorld(o, { x: o.props.len, y: 0 }) },
    { kind: o.props.kind === 'mount' ? 'anchor' : 'midpoint', point: toWorld(o, { x: o.props.len / 2, y: 0 }) },
  ],
  // Линия опоры — для привязки тел и векторов в любом её месте.
  getSnapCurves: (o) => [{ kind: 'segment', a: toWorld(o, { x: 0, y: 0 }), b: toWorld(o, { x: o.props.len, y: 0 }) }],
  render: (o, ctx) => <SupportShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const p = o.props;
    const c = ctx.resolveColor(p.color);
    const hs: string[] = [];
    for (let x = 0; x <= p.len - HATCH_STEP / 2; x += HATCH_STEP) hs.push(`M${x + HATCH_STEP},0L${x + HATCH_STEP - HATCH},${p.kind === 'surface' ? HATCH : -HATCH}`);
    return `<g transform="translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI})"><line x1="0" y1="0" x2="${p.len}" y2="0" stroke="${c}" stroke-width="2"/><path d="${hs.join('')}" stroke="${c}" stroke-width="1"/></g>`;
  },
  inspector: [
    { kind: 'text', key: 'label', label: 'Подпись', maxLength: 12 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: true, resize: 'free' },
  applyResize: (o, sx) => ({ scaleX: 1, scaleY: 1, props: { len: Math.max(10, o.props.len * Math.abs(sx)) } }),
};
