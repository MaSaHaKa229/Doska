import { useEffect, useState, type ReactNode } from 'react';
import { Image as KImage, Rect as KRect } from 'react-konva';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import type { BoardObject, ObjectModule } from '@doska/shared';
import { MAX_DOC_BYTES, EMPTY_DOC, docPlainText, normalizeDoc } from '../text/schema';
import { measureTextHeight, rasterScale, rasterizeText, textSvg } from '../text/render';
import { resolveColor, type CanvasTheme } from './colors';
import { localTolerance, toLocal, toWorld } from './util';
import { useBoard } from '../store/board';

export const TEXT_TYPE = 'core.text';
export const DEFAULT_TEXT_WIDTH = 360;
export const MIN_TEXT_WIDTH = 40;

const docSchema = z.custom<JSONContent>((v) => {
  try {
    if (JSON.stringify(v).length > MAX_DOC_BYTES) return false;
    normalizeDoc(v);
    return true;
  } catch {
    return false;
  }
}, 'Повреждённый текст');

export const textPropsSchema = z.object({
  /** Документ ProseMirror (схема text/schema.ts). */
  doc: docSchema,
  /** Ширина блока (текст переносится по ней) и измеренная высота — локальные единицы. */
  w: z.number().finite().min(MIN_TEXT_WIDTH).max(20_000),
  h: z.number().finite().positive().max(1e6),
  /** Заливка подложки: токен палитры или 'none'. */
  fill: z.string().max(32),
});
export type TextProps = z.infer<typeof textPropsSchema>;
type TextObject = BoardObject<TextProps>;

/** Текущий масштаб картинки текста (подписка на камеру с огрублением). */
function useRasterScale(): number {
  return useBoard((s) => rasterScale((s.pageId && s.cameras[s.pageId]?.zoom) || 1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
}

function TextNode({ obj, theme }: { obj: TextObject; theme: CanvasTheme }) {
  const p = obj.props;
  const editing = useBoard((s) => s.editingText === obj.id);
  const scale = useRasterScale();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const fill = p.fill === 'none' ? null : resolveColor(p.fill, theme);
  useEffect(() => {
    let cancelled = false;
    // Пока готовится новая картинка, на доске остаётся прежняя.
    rasterizeText(p.doc, p.w, p.h, theme, fill, scale)
      .then((i) => !cancelled && setImg(i))
      .catch(() => !cancelled && setImg(null));
    return () => {
      cancelled = true;
    };
  }, [p.doc, p.w, p.h, theme, fill, scale]);
  // Во время редактирования на месте блока — редактор (HTML поверх холста).
  if (editing) return <KRect width={p.w} height={p.h} stroke={resolveColor('accent-2', theme)} dash={[6, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />;
  if (!img) return fill ? <KRect width={p.w} height={p.h} fill={fill} listening={false} /> : null;
  return <KImage image={img} width={p.w} height={p.h} listening={false} perfectDrawEnabled={false} />;
}

export const textModule: ObjectModule<TextProps, ReactNode> = {
  type: TEXT_TYPE,
  title: 'Текст',
  version: 1,
  propsSchema: textPropsSchema,
  createProps: () => ({ doc: EMPTY_DOC, w: DEFAULT_TEXT_WIDTH, h: 43, fill: 'none' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as TextObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: o.props.h }),
  hitTest: (o, point, tolerance) => {
    const p = toLocal(o, point);
    const t = localTolerance(o, tolerance);
    return p.x >= -t && p.y >= -t && p.x <= o.props.w + t && p.y <= o.props.h + t;
  },
  getHandles: () => [],
  getSnapPoints: (o) => [
    { kind: 'vertex', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'vertex', point: toWorld(o, { x: o.props.w, y: 0 }) },
    { kind: 'center', point: toWorld(o, { x: o.props.w / 2, y: o.props.h / 2 }) },
  ],
  render: (o, ctx) => <TextNode obj={o} theme={ctx.theme} />,
  toSVG: (o, ctx) => {
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    const fill = o.props.fill === 'none' ? null : ctx.resolveColor(o.props.fill);
    // Тот же foreignObject, что и на доске (текст остаётся текстом); <title> — для поиска и доступности.
    const title = docPlainText(o.props.doc).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
    return `<g transform="${tr}"><title>${title}</title>${textSvg(o.props.doc, o.props.w, o.props.h, ctx.theme, fill, 1)}</g>`;
  },
  inspector: [{ kind: 'color', key: 'fill', label: 'Подложка' }],
  editor: 'text',
  transform: { rotatable: true, resize: 'free' },
  applyResize: (o, scaleX) => {
    // Ширина меняется, буквы — нет: текст переносится заново, высота измеряется.
    const w = Math.max(MIN_TEXT_WIDTH, o.props.w * Math.abs(scaleX / (o.scaleX || 1)));
    return { scaleX: o.scaleX, scaleY: o.scaleY, props: { w, h: measureTextHeight(o.props.doc, w) } };
  },
};
