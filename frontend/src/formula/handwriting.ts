import type { BoardModel } from '../collab/model';
import { STROKE_TYPE } from '../objects/stroke/stroke';
import type { Rect } from '@doska/shared';

/** Высота рукописи на картинке для распознавания, пиксели (pix2tex лучше всего читает строку такой высоты). */
const TARGET_HEIGHT = 96;
const PAD = 12;

/** Штрихи пера среди выделенного (листья групп). */
export function handwritingStrokes(model: BoardModel, selection: readonly string[]): string[] {
  const leaves = model.leaves(selection);
  return leaves.length > 0 && leaves.every((id) => model.getObject(id)?.type === STROKE_TYPE) ? leaves : [];
}

/** SVG рукописи: чёрные штрихи на белом, масштаб под распознавание. */
export function handwritingSvg(model: BoardModel, ids: string[]): { svg: string; width: number; height: number; bounds: Rect } | null {
  const b = model.boundsOf(ids);
  if (!b || b.width <= 0 || b.height <= 0) return null;
  const k = Math.min(4, Math.max(0.1, TARGET_HEIGHT / b.height), 1600 / b.width);
  const width = Math.ceil(b.width * k + PAD * 2);
  const height = Math.ceil(b.height * k + PAD * 2);
  const parts: string[] = [];
  for (const id of ids) {
    const e = model.get(id);
    const svg = e?.module?.toSVG?.(e.obj, {
      ...model.resolve,
      theme: 'light',
      selected: false,
      hovered: false,
      viewport: b,
      // Цвет не важен для распознавания: всё чёрным, полупрозрачность убирается.
      resolveColor: () => '#000000',
    });
    if (svg) parts.push(svg.replace(/opacity="[^"]*"/, 'opacity="1"'));
  }
  if (!parts.length) return null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<g transform="translate(${PAD} ${PAD}) scale(${k}) translate(${-b.x} ${-b.y})">${parts.join('')}</g></svg>`;
  return { svg, width, height, bounds: b };
}

/** PNG рукописи для отправки на распознавание. */
export async function handwritingPng(model: BoardModel, ids: string[]): Promise<{ png: Blob; bounds: Rect } | null> {
  const r = handwritingSvg(model, ids);
  if (!r) return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return png ? { png, bounds: r.bounds } : null;
}
