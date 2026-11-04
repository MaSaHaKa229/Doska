import type { ReactNode } from 'react';
import { Arc, Circle, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext, ResolveContext } from '@doska/shared';
import { resolveColor, type CanvasTheme } from '../../objects/colors';
import { toLocal } from '../../objects/util';
import { netBounds, netOf, type Net } from './net';
import { BODY_TITLES, type Body } from './solids';
import { PLUGIN_ID, SCENE_TYPE, type SceneProps } from './objects';

export const NET_TYPE = `${PLUGIN_ID}.net`;

/**
 * Развёртка тела сцены (этап 6.4b): отдельный объект доски со ссылкой на
 * сцену (deps). Правка тела в сцене перестраивает развёртку; масштаб и
 * размер подписей — как у сцены.
 */
export const netPropsSchema = z.object({
  /** id тела внутри сцены. */
  body: z.string().min(1).max(16),
  color: z.string().max(32),
  fill: z.string().max(32),
  opacity: z.number().finite().min(0).max(1),
  labels: z.boolean(),
});
export type NetProps = z.infer<typeof netPropsSchema>;

interface Resolved {
  net: Net | null;
  scale: number;
  labelSize: number;
  /** Сдвиг: левый верхний угол развёртки — в (0, 0) объекта. */
  ox: number;
  oy: number;
  message: string | null;
}

function resolve(o: BoardObject<NetProps>, ctx: ResolveContext): Resolved {
  const scene = o.deps[0] ? ctx.getObject(o.deps[0]) : undefined;
  const sp = scene?.type === SCENE_TYPE ? (scene.props as unknown as SceneProps) : null;
  const body = sp?.bodies.find((b) => b.id === o.props.body) as Body | undefined;
  if (!sp || !body) return { net: null, scale: 1, labelSize: 16, ox: 0, oy: 0, message: 'Развёртка: тело удалено из сцены' };
  const net = netOf(body);
  if (!net) return { net: null, scale: sp.scale, labelSize: sp.labelSize, ox: 0, oy: 0, message: `${BODY_TITLES[body.kind]}: развёртки нет` };
  const b = netBounds(net);
  return { net, scale: sp.scale, labelSize: sp.labelSize, ox: -b.x * sp.scale, oy: -b.y * sp.scale, message: null };
}

function size(o: BoardObject<NetProps>, ctx: ResolveContext): { w: number; h: number } {
  const r = resolve(o, ctx);
  if (!r.net) return { w: 260, h: 30 };
  const b = netBounds(r.net);
  return { w: Math.max(20, b.width * r.scale), h: Math.max(20, b.height * r.scale) };
}

/** Подписи вершин развёртки: каждая — чуть внутрь своей грани. */
function vertexLabels(net: Net, k: number): { x: number; y: number; text: string }[] {
  const out: { x: number; y: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const p of net.polys) {
    const cx = p.pts.reduce((s, q) => s + q[0], 0) / p.pts.length;
    const cy = p.pts.reduce((s, q) => s + q[1], 0) / p.pts.length;
    p.pts.forEach((q, i) => {
      const key = `${q[0].toFixed(3)},${q[1].toFixed(3)}`;
      if (!p.names[i] || seen.has(key)) return;
      seen.add(key);
      // Снаружи многоугольника: от центра грани.
      const dx = q[0] - cx;
      const dy = q[1] - cy;
      const l = Math.hypot(dx, dy) || 1;
      out.push({ x: q[0] * k + (dx / l) * k * 0.35, y: q[1] * k + (dy / l) * k * 0.35, text: p.names[i]! });
    });
  }
  return out;
}

/** #rrggbb → rgba с прозрачностью: заливка полупрозрачная, контур — нет. */
export function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${a})` : hex;
}

function NetShape({ o, ctx }: { o: BoardObject<NetProps>; ctx: RenderContext }) {
  const r = resolve(o, ctx);
  const c = ctx.resolveColor(o.props.color);
  if (!r.net) return <Text text={r.message ?? ''} fontSize={14} fill={ctx.resolveColor('muted')} listening={false} />;
  const k = r.scale;
  const fill = withAlpha(ctx.resolveColor(o.props.fill), o.props.opacity);
  const fs = r.labelSize;
  const common = { stroke: c, strokeWidth: 1.6, strokeScaleEnabled: false, listening: false } as const;
  return (
    <Group x={r.ox} y={r.oy} listening={false}>
      {r.net.polys.map((p, i) => (
        <Line key={`p${i}`} points={p.pts.flatMap((q) => [q[0] * k, q[1] * k])} closed fill={fill} {...common} fillEnabled={o.props.opacity > 0} />
      ))}
      {r.net.sectors.map((s, i) => (
        <Arc
          key={`s${i}`}
          x={s.c[0] * k}
          y={s.c[1] * k}
          innerRadius={s.r1 * k}
          outerRadius={s.r2 * k}
          angle={((s.a1 - s.a0) * 180) / Math.PI}
          rotation={(s.a0 * 180) / Math.PI}
          fill={fill}
          {...common}
          fillEnabled={o.props.opacity > 0}
        />
      ))}
      {r.net.circles.map((s, i) => (
        <Circle key={`c${i}`} x={s.c[0] * k} y={s.c[1] * k} radius={s.r * k} fill={fill} {...common} fillEnabled={o.props.opacity > 0} />
      ))}
      {o.props.labels && (
        <>
          {vertexLabels(r.net, k).map((t, i) => (
            <Text key={`t${i}`} x={t.x - fs * 2} y={t.y - fs / 2} width={fs * 4} align="center" text={t.text} fontSize={fs} fontStyle="italic" fill={c} listening={false} />
          ))}
          {r.net.circles.map((s, i) => s.name && <Text key={`o${i}`} x={s.c[0] * k + 4} y={s.c[1] * k - fs - 2} text={s.name} fontSize={fs} fontStyle="italic" fill={c} listening={false} />)}
          {r.net.circles.map((s, i) => (
            <Circle key={`od${i}`} x={s.c[0] * k} y={s.c[1] * k} radius={2.5 / ctx.zoom} fill={c} listening={false} />
          ))}
          {r.net.sectors.map((s, i) => s.name && <Text key={`sn${i}`} x={s.c[0] * k + 6} y={s.c[1] * k - fs - 2} text={s.name} fontSize={fs} fontStyle="italic" fill={c} listening={false} />)}
        </>
      )}
    </Group>
  );
}

function netSvg(o: BoardObject<NetProps>, ctx: ResolveContext, theme: CanvasTheme): string {
  const r = resolve(o, ctx);
  if (!r.net) return '';
  const k = r.scale;
  const X = (v: number) => (o.x + r.ox + v * k).toFixed(2);
  const Y = (v: number) => (o.y + r.oy + v * k).toFixed(2);
  const st = `stroke="${resolveColor(o.props.color, theme)}" stroke-width="1.6" fill="${o.props.opacity > 0 ? resolveColor(o.props.fill, theme) : 'none'}" fill-opacity="${o.props.opacity}"`;
  const out: string[] = [];
  for (const p of r.net.polys) out.push(`<polygon points="${p.pts.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ')}" ${st}/>`);
  for (const c of r.net.circles) out.push(`<circle cx="${X(c.c[0])}" cy="${Y(c.c[1])}" r="${(c.r * k).toFixed(2)}" ${st}/>`);
  for (const s of r.net.sectors) {
    const pt = (rad: number, a: number) => `${X(s.c[0] + rad * Math.cos(a))},${Y(s.c[1] + rad * Math.sin(a))}`;
    const large = s.a1 - s.a0 > Math.PI ? 1 : 0;
    const R = (s.r2 * k).toFixed(2);
    const ri = (s.r1 * k).toFixed(2);
    const d =
      s.r1 > 0
        ? `M${pt(s.r2, s.a0)} A${R},${R} 0 ${large} 1 ${pt(s.r2, s.a1)} L${pt(s.r1, s.a1)} A${ri},${ri} 0 ${large} 0 ${pt(s.r1, s.a0)} Z`
        : `M${X(s.c[0])},${Y(s.c[1])} L${pt(s.r2, s.a0)} A${R},${R} 0 ${large} 1 ${pt(s.r2, s.a1)} Z`;
    out.push(`<path d="${d}" ${st}/>`);
  }
  return `<g>${out.join('')}</g>`;
}

export const netModule: ObjectModule<NetProps, ReactNode> = {
  type: NET_TYPE,
  title: 'Развёртка',
  version: 1,
  propsSchema: netPropsSchema,
  createProps: () => ({ body: 'b1', color: 'ink', fill: 'accent-2', opacity: 0.12, labels: true }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<NetProps>,
  getLocalBounds: (o, ctx) => {
    const s = size(o, ctx);
    return { x: 0, y: 0, width: s.w, height: s.h };
  },
  hitTest: (o, point, tol, ctx) => {
    const p = toLocal(o, point);
    const s = size(o, ctx);
    return p.x >= -tol && p.y >= -tol && p.x <= s.w + tol && p.y <= s.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <NetShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => netSvg(o, ctx, ctx.theme),
  inspector: [
    { kind: 'toggle', key: 'labels', label: 'Подписи' },
    { kind: 'color', key: 'color', label: 'Линии' },
    { kind: 'color', key: 'fill', label: 'Заливка' },
  ],
  transform: { rotatable: true, resize: 'none' },
};
