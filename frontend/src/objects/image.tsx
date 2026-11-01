import type { ReactNode } from 'react';
import { Image as KImage, Rect as KRect, Text } from 'react-konva';
import { z } from 'zod';
import { assetUrl, type BoardObject, type ObjectModule } from '@doska/shared';
import { useAssetImage } from '../media/imageCache';
import { localTolerance, toLocal, toWorld } from './util';

export const IMAGE_TYPE = 'core.image';

const cropSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
});
export type ImageCrop = z.infer<typeof cropSchema>;

export const imagePropsSchema = z.object({
  assetId: z.string().uuid(),
  /** Размер на доске в локальных единицах (объект масштабируется ещё и scaleX/Y). */
  w: z.number().finite().positive().max(1e6),
  h: z.number().finite().positive().max(1e6),
  /** Исходный размер файла в пикселях. */
  naturalW: z.number().int().positive(),
  naturalH: z.number().int().positive(),
  /** Видимая часть исходной картинки (пиксели) или null — целиком. */
  crop: cropSchema.nullable(),
  alt: z.string().max(300).optional(),
});
export type ImageProps = z.infer<typeof imagePropsSchema>;
type ImageObject = BoardObject<ImageProps>;

/** Область обрезки в пределах картинки (не меньше 4×4 пикселей). */
export function clampCrop(c: ImageCrop, naturalW: number, naturalH: number): ImageCrop {
  const x = Math.min(Math.max(0, c.x), naturalW - 4);
  const y = Math.min(Math.max(0, c.y), naturalH - 4);
  return { x, y, w: Math.max(4, Math.min(c.w, naturalW - x)), h: Math.max(4, Math.min(c.h, naturalH - y)) };
}

/**
 * Новые props после обрезки: масштаб «пикселей на единицу доски» не
 * меняется, поэтому оставшаяся часть картинки остаётся того же размера на
 * доске. null — обрезку снять.
 */
export function applyCrop(p: ImageProps, crop: ImageCrop | null): Pick<ImageProps, 'crop' | 'w' | 'h'> {
  const srcW = p.crop?.w ?? p.naturalW;
  const scale = p.w / srcW;
  const next = crop ? clampCrop(crop, p.naturalW, p.naturalH) : null;
  return { crop: next, w: (next?.w ?? p.naturalW) * scale, h: (next?.h ?? p.naturalH) * scale };
}

function ImageNode({ p }: { p: ImageProps }) {
  const entry = useAssetImage(p.assetId);
  if (entry.status === 'ready') {
    return (
      <KImage
        image={entry.img}
        width={p.w}
        height={p.h}
        crop={p.crop ? { x: p.crop.x, y: p.crop.y, width: p.crop.w, height: p.crop.h } : undefined}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }
  return (
    <>
      <KRect width={p.w} height={p.h} fill="#8883" stroke="#888" dash={[6, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text
        width={p.w}
        height={p.h}
        align="center"
        verticalAlign="middle"
        fontSize={Math.max(10, Math.min(p.w, p.h) / 10)}
        fill="#666"
        text={entry.status === 'error' ? 'Картинка недоступна' : 'Загрузка…'}
        listening={false}
      />
    </>
  );
}

export const imageModule: ObjectModule<ImageProps, ReactNode> = {
  type: IMAGE_TYPE,
  title: 'Картинка',
  version: 1,
  propsSchema: imagePropsSchema,
  createProps: () => ({ assetId: '00000000-0000-4000-8000-000000000000', w: 100, h: 100, naturalW: 100, naturalH: 100, crop: null }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as ImageObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: o.props.h }),
  hitTest: (o, point, tolerance) => {
    const p = toLocal(o, point);
    const t = localTolerance(o, tolerance);
    return p.x >= -t && p.y >= -t && p.x <= o.props.w + t && p.y <= o.props.h + t;
  },
  getHandles: () => [],
  getSnapPoints: (o) => {
    const { w, h } = o.props;
    return [
      { kind: 'center', point: toWorld(o, { x: w / 2, y: h / 2 }) },
      { kind: 'vertex', point: toWorld(o, { x: 0, y: 0 }) },
      { kind: 'vertex', point: toWorld(o, { x: w, y: 0 }) },
      { kind: 'vertex', point: toWorld(o, { x: w, y: h }) },
      { kind: 'vertex', point: toWorld(o, { x: 0, y: h }) },
    ];
  },
  render: (o) => <ImageNode p={o.props} />,
  toSVG: (o) => {
    const p = o.props;
    const c = p.crop ?? { x: 0, y: 0, w: p.naturalW, h: p.naturalH };
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    return (
      `<g transform="${tr}"><svg width="${p.w}" height="${p.h}" viewBox="${c.x} ${c.y} ${c.w} ${c.h}" preserveAspectRatio="none">` +
      `<image href="${assetUrl(p.assetId)}" width="${p.naturalW}" height="${p.naturalH}"/></svg></g>`
    );
  },
  editor: 'crop',
  transform: { rotatable: true, resize: 'proportional' },
};
