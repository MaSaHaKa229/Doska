import { useEffect, useState, type ReactNode } from 'react';
import { Image as KImage } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule } from '@doska/shared';
import { MAX_LATEX, colorVar, mathElement } from '../text/schema';
import { elementSvg, measureElement, rasterScale, rasterize } from '../text/render';
import { localTolerance, toLocal, toWorld } from './util';
import { useBoard } from '../store/board';
import type { CanvasTheme } from './colors';

export const FORMULA_TYPE = 'core.formula';
export const DEFAULT_FORMULA_SIZE = 32;
const PAD = 6;

export const formulaPropsSchema = z.object({
  latex: z.string().max(MAX_LATEX),
  /** Кегль в мировых единицах. */
  size: z.number().finite().min(6).max(1000),
  /** Цвет — токен палитры. */
  color: z.string().max(32),
});
export type FormulaProps = z.infer<typeof formulaPropsSchema>;
type FormulaObject = BoardObject<FormulaProps>;

/** Элемент формулы (тот же для измерения и картинки). */
export function formulaElement(p: FormulaProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'doska-text';
  root.style.cssText = `padding:${PAD}px;font-size:${p.size}px;color:${colorVar(p.color)};white-space:nowrap;width:max-content`;
  root.appendChild(mathElement(p.latex || '\\square', document, true));
  return root;
}

const sizeCache = new Map<string, { width: number; height: number }>();

/**
 * Размер формулы — по отрисовке в странице (кэш по формуле и кеглю). Без
 * вёрстки (тесты) — оценка по длине записи.
 */
export function formulaSize(p: Pick<FormulaProps, 'latex' | 'size'>): { width: number; height: number } {
  const key = `${p.size}|${p.latex}`;
  let s = sizeCache.get(key);
  if (!s) {
    const m = measureElement(formulaElement({ ...p, color: 'ink' }), null);
    s = m.width > 0 && m.height > 0 ? m : { width: Math.max(1, p.latex.length) * p.size * 0.5 + PAD * 2, height: p.size * 1.4 + PAD * 2 };
    if (sizeCache.size > 2000) sizeCache.clear();
    sizeCache.set(key, s);
  }
  return s;
}

function useRasterScale(objScale: number): number {
  return useBoard((st) => rasterScale(((st.pageId && st.cameras[st.pageId]?.zoom) || 1) * objScale, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
}

function FormulaNode({ obj, theme }: { obj: FormulaObject; theme: CanvasTheme }) {
  const p = obj.props;
  const { width, height } = formulaSize(p);
  const scale = useRasterScale(Math.max(Math.abs(obj.scaleX), Math.abs(obj.scaleY)));
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    rasterize(`formula|${theme}|${p.color}|${p.size}|${scale}|${p.latex}`, () => elementSvg(formulaElement(p), width, height, theme, null, scale))
      .then((i) => !cancelled && setImg(i))
      .catch(() => !cancelled && setImg(null));
    return () => {
      cancelled = true;
    };
  }, [p, width, height, theme, scale]);
  return img ? <KImage image={img} width={width} height={height} listening={false} perfectDrawEnabled={false} /> : null;
}

export const formulaModule: ObjectModule<FormulaProps, ReactNode> = {
  type: FORMULA_TYPE,
  title: 'Формула',
  version: 1,
  propsSchema: formulaPropsSchema,
  createProps: () => ({ latex: '', size: DEFAULT_FORMULA_SIZE, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as FormulaObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, ...formulaSize(o.props) }),
  hitTest: (o, point, tolerance) => {
    const { width, height } = formulaSize(o.props);
    const p = toLocal(o, point);
    const t = localTolerance(o, tolerance);
    return p.x >= -t && p.y >= -t && p.x <= width + t && p.y <= height + t;
  },
  getHandles: () => [],
  getSnapPoints: (o) => {
    const { width, height } = formulaSize(o.props);
    return [
      { kind: 'vertex', point: toWorld(o, { x: 0, y: 0 }) },
      { kind: 'center', point: toWorld(o, { x: width / 2, y: height / 2 }) },
    ];
  },
  render: (o, ctx) => <FormulaNode obj={o} theme={ctx.theme} />,
  toSVG: (o, ctx) => {
    const { width, height } = formulaSize(o.props);
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    return `<g transform="${tr}">${elementSvg(formulaElement(o.props), width, height, ctx.theme, null, 1)}</g>`;
  },
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  editor: 'formula',
  transform: { rotatable: true, resize: 'proportional' },
  // Растяжение меняет кегль: формула перерисовывается чёткой, а не растягивается.
  applyResize: (o, scaleX) => ({
    scaleX: o.scaleX,
    scaleY: o.scaleY,
    props: { size: Math.min(1000, Math.max(6, Math.round(o.props.size * Math.abs(scaleX / (o.scaleX || 1)) * 10) / 10)) },
  }),
};
