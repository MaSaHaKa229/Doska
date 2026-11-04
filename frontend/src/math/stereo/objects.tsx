import type { ReactNode } from 'react';
import { Circle, Group, Line, Rect as KRect, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { resolveColor, type CanvasTheme } from '../../objects/colors';
import { toLocal } from '../../objects/util';
import { bodySchema, drawScene, fitScale, newBody, type Body, type BodyKind, type Drawing, type HiddenMode, type View } from './solids';
import { itemSchema, MAX_ITEMS, MAX_POINTS, spaceLayer, spacePointSchema } from './space';

export const PLUGIN_ID = 'math.stereo';
export const SCENE_TYPE = `${PLUGIN_ID}.scene`;
export const SCENE_EDITOR = 'stereo.scene';

/** Вид «как в учебнике»: зритель спереди, чуть справа и сверху. */
export const TEXTBOOK_VIEW = { yaw: (-65 * Math.PI) / 180, pitch: (22 * Math.PI) / 180 };
export const MAX_BODIES = 12;

export const scenePropsSchema = z.object({
  /** Рамка сцены на доске. */
  w: z.number().finite().min(80).max(4000),
  h: z.number().finite().min(80).max(4000),
  yaw: z.number().finite().min(-100).max(100),
  pitch: z
    .number()
    .finite()
    .min(-Math.PI / 2)
    .max(Math.PI / 2),
  /** Пикселей доски на единицу длины сцены. */
  scale: z.number().finite().min(1).max(1000),
  hidden: z.enum(['dashed', 'hide', 'solid']),
  /** Рисовать рамку сцены. */
  frame: z.boolean(),
  labelSize: z.number().finite().min(8).max(60),
  bodies: z.array(bodySchema).max(MAX_BODIES),
  /** Построения в пространстве (6.4b): точки и отрезки, прямые, плоскости, сечения, измерения. */
  points: z.array(spacePointSchema).max(MAX_POINTS),
  items: z.array(itemSchema).max(MAX_ITEMS),
});
export type SceneProps = z.infer<typeof scenePropsSchema>;

export const viewOf = (p: SceneProps): View => ({ yaw: p.yaw, pitch: p.pitch, scale: p.scale });

/** Новая сцена с одним телом, вписанным в рамку. */
export function sceneWith(kind: BodyKind | null, w = 360, h = 300): SceneProps {
  const bodies = kind ? [newBody(kind, 'b1')] : [];
  return { w, h, ...TEXTBOOK_VIEW, scale: fitScale(bodies, TEXTBOOK_VIEW, w, h), hidden: 'dashed', frame: false, labelSize: 16, bodies, points: [], items: [] };
}

// Чертёж зависит только от props: кэш по объекту props (он заменяется целиком при правке).
const cache = new WeakMap<SceneProps, Drawing>();
export function drawingOf(p: SceneProps): Drawing {
  let d = cache.get(p);
  if (!d) {
    d = drawScene(p.bodies as Body[], viewOf(p), p.hidden as HiddenMode, p.labelSize * 0.7 + 3, p.points.length || p.items.length ? spaceLayer(p) : undefined);
    cache.set(p, d);
  }
  return d;
}

const LINE_W = 1.6;
const HIDDEN_W = 1.2;
const ACCENT_W = 2.4;
/** Значения измерений — мельче подписей и прямым шрифтом. */
const valueSize = (fs: number) => Math.round(fs * 0.85);
const dashOf = (zoom: number) => [6 / zoom, 4 / zoom];

function SceneShape({ o, ctx }: { o: BoardObject<SceneProps>; ctx: RenderContext }) {
  const p = o.props;
  const d = drawingOf(p);
  const cx = p.w / 2;
  const cy = p.h / 2;
  const col = (c: string) => ctx.resolveColor(c);
  const fs = p.labelSize;
  return (
    <Group listening={false}>
      {p.frame ? (
        <KRect width={p.w} height={p.h} stroke={col('muted')} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      ) : (
        // Невидимая подложка: щелчок по пустому месту сцены попадает в объект (hitTest), рисовать нечего.
        <KRect width={p.w} height={p.h} stroke={ctx.selected ? col('muted') : undefined} strokeWidth={0.5} dash={[4 / ctx.zoom, 4 / ctx.zoom]} strokeScaleEnabled={false} listening={false} />
      )}
      <Group x={cx} y={cy}>
        {d.fills.map((f, i) => (
          <Line key={`f${i}`} points={f.pts} closed fill={col(f.color)} opacity={f.opacity} listening={false} />
        ))}
        {d.lines.map((l, i) => (
          <Line
            key={`l${i}`}
            points={l.pts}
            stroke={col(l.color)}
            strokeWidth={l.accent ? ACCENT_W : l.hidden ? HIDDEN_W : LINE_W}
            dash={l.hidden ? dashOf(ctx.zoom) : undefined}
            lineCap="round"
            lineJoin="round"
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
        {d.dots.map((t, i) => (
          <Circle key={`d${i}`} x={t.x} y={t.y} radius={2.5 / ctx.zoom} fill={col(t.color)} listening={false} />
        ))}
        {d.labels.map((t, i) =>
          t.value ? (
            <Text key={`t${i}`} x={t.x - fs * 10} y={t.y - fs / 2} width={fs * 20} align="center" text={t.text} fontSize={valueSize(fs)} fill={col(t.color)} listening={false} />
          ) : (
            <Text key={`t${i}`} x={t.x - fs * 2} y={t.y - fs / 2} width={fs * 4} align="center" text={t.text} fontSize={fs} fontStyle="italic" fill={col(t.color)} listening={false} />
          ),
        )}
      </Group>
    </Group>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** SVG-фрагмент чертежа (мировые координаты): общий для экспорта и превью. */
export function sceneSvg(p: SceneProps, ox: number, oy: number, theme: CanvasTheme, dashScale = 1): string {
  const d = drawingOf(p);
  const cx = ox + p.w / 2;
  const cy = oy + p.h / 2;
  const col = (c: string) => resolveColor(c, theme);
  const pts = (a: number[]) => a.map((v, i) => (i % 2 ? v + cy : v + cx).toFixed(2)).join(' ');
  const out: string[] = [];
  if (p.frame) out.push(`<rect x="${ox}" y="${oy}" width="${p.w}" height="${p.h}" fill="none" stroke="${col('muted')}"/>`);
  for (const f of d.fills) out.push(`<polygon points="${pts(f.pts)}" fill="${col(f.color)}" fill-opacity="${f.opacity}"/>`);
  for (const l of d.lines)
    out.push(
      `<polyline points="${pts(l.pts)}" fill="none" stroke="${col(l.color)}" stroke-width="${l.accent ? ACCENT_W : l.hidden ? HIDDEN_W : LINE_W}" stroke-linecap="round" stroke-linejoin="round"${l.hidden ? ` stroke-dasharray="${6 * dashScale} ${4 * dashScale}"` : ''}/>`,
    );
  for (const t of d.dots) out.push(`<circle cx="${(t.x + cx).toFixed(2)}" cy="${(t.y + cy).toFixed(2)}" r="2.5" fill="${col(t.color)}"/>`);
  for (const t of d.labels)
    out.push(
      `<text x="${(t.x + cx).toFixed(2)}" y="${(t.y + cy + p.labelSize * 0.35).toFixed(2)}" text-anchor="middle" font-size="${t.value ? valueSize(p.labelSize) : p.labelSize}"${t.value ? '' : ' font-style="italic"'} fill="${col(t.color)}">${esc(t.text)}</text>`,
    );
  return out.join('');
}

export const sceneModule: ObjectModule<SceneProps, ReactNode> = {
  type: SCENE_TYPE,
  title: '3D-сцена',
  // 2 — построения в пространстве (points, items).
  version: 2,
  migrate: (props) => ({ points: [], items: [], ...(props as object) }) as unknown as SceneProps,
  propsSchema: scenePropsSchema as unknown as z.ZodType<SceneProps>,
  createProps: () => sceneWith('cube'),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<SceneProps>,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: o.props.h }),
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    return p.x >= -tol && p.y >= -tol && p.x <= o.props.w + tol && p.y <= o.props.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <SceneShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => `<g>${sceneSvg(o.props, o.x, o.y, ctx.theme)}</g>`,
  inspector: [
    {
      kind: 'select',
      key: 'hidden',
      label: 'Невидимые линии',
      options: [
        { value: 'dashed', label: 'Пунктиром' },
        { value: 'hide', label: 'Скрыть' },
        { value: 'solid', label: 'Сплошными' },
      ],
    },
    { kind: 'toggle', key: 'frame', label: 'Рамка' },
    { kind: 'number', key: 'labelSize', label: 'Подписи', min: 8, max: 60, step: 1 },
  ],
  editor: SCENE_EDITOR,
  transform: { rotatable: false, resize: 'free' },
  // Растяжение рамкой меняет рамку и масштаб чертежа (он остаётся вписанным).
  applyResize: (o, scaleX, scaleY) => {
    const w = Math.max(80, o.props.w * Math.abs(scaleX));
    const h = Math.max(80, o.props.h * Math.abs(scaleY));
    const k = Math.min(w / o.props.w, h / o.props.h);
    return { scaleX: 1, scaleY: 1, props: { w, h, scale: Math.max(1, Math.min(1000, o.props.scale * k)) } };
  },
};

export const stereoModules = [sceneModule];
