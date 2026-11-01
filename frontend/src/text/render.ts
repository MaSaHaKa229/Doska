import type { JSONContent } from '@tiptap/core';
import { DOMSerializer, Node as PMNode } from '@tiptap/pm/model';
import { TEXT_COLOR_TOKENS, textSchema } from './schema';
import { resolveColor, type CanvasTheme } from '../objects/colors';

/**
 * Отрисовка текстового блока. Документ превращается в XHTML схемой
 * ProseMirror (без innerHTML из документа), высота измеряется в странице, а
 * на доску блок попадает картинкой: SVG с foreignObject. Так текст стоит в
 * общем порядке слоёв (перо поверх текста), одинаково выглядит в
 * миниатюрах, а в картинке-SVG браузер не выполняет скрипты и не грузит
 * внешние ресурсы. Формулы — MathML, браузер рисует их сам.
 */

export const TEXT_PADDING = 8;

/**
 * Общий CSS текста: редактор, измерение и картинка выглядят одинаково.
 * box-sizing задан явно: в картинке-SVG нет глобальных стилей приложения.
 */
export const TEXT_CSS = `
.doska-text *,.doska-text *::before,.doska-text *::after{box-sizing:border-box}
.doska-text{box-sizing:border-box;width:100%;padding:${TEXT_PADDING}px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:20px;line-height:1.35;color:var(--c-ink);overflow-wrap:anywhere;white-space:pre-wrap;outline:none}
.doska-text p{margin:0;min-height:1.35em}
.doska-text h1{font-size:1.8em;line-height:1.2;margin:0 0 .15em}
.doska-text h2{font-size:1.45em;line-height:1.2;margin:0 0 .15em}
.doska-text h3{font-size:1.2em;line-height:1.25;margin:0 0 .1em}
.doska-text ul,.doska-text ol{margin:0;padding-left:1.4em}
.doska-text li p{min-height:0}
.doska-text blockquote{margin:0;padding-left:.7em;border-left:3px solid var(--c-muted);color:var(--c-muted)}
.doska-text table{border-collapse:collapse;margin:.2em 0}
.doska-text td,.doska-text th{border:1px solid var(--c-muted);padding:.1em .4em;min-width:2.5em;vertical-align:top;white-space:pre-wrap}
.doska-text th{font-weight:600;background:rgba(127,127,127,.12)}
.doska-text .math-inline{display:inline-block}
.doska-text .math-inline math{font-size:1.1em}
.doska-text s{text-decoration:line-through}
`;

/** Переменные цветов текста для темы холста. */
export function colorVars(theme: CanvasTheme): string {
  return TEXT_COLOR_TOKENS.map((t) => `--c-${t}:${resolveColor(t, theme)};`).join('');
}

/** DOM блока (контейнер .doska-text) — для измерения и для картинки. */
export function docToElement(doc: JSONContent, d: Document = document): HTMLElement {
  const schema = textSchema();
  const node = PMNode.fromJSON(schema, doc);
  const root = d.createElement('div');
  root.className = 'doska-text';
  root.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: d }));
  return root;
}

let measureHost: HTMLDivElement | null = null;
function host(): HTMLDivElement {
  if (measureHost?.isConnected) return measureHost;
  measureHost = document.createElement('div');
  measureHost.setAttribute('aria-hidden', 'true');
  measureHost.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout';
  const style = document.createElement('style');
  style.textContent = TEXT_CSS;
  measureHost.appendChild(style);
  document.body.appendChild(measureHost);
  return measureHost;
}

/** Высота блока ширины w (мировые единицы = CSS-пиксели при масштабе 1). */
export function measureTextHeight(doc: JSONContent, w: number): number {
  const h = host();
  const box = document.createElement('div');
  box.style.width = `${w}px`;
  box.appendChild(docToElement(doc));
  h.appendChild(box);
  const height = Math.ceil(box.getBoundingClientRect().height);
  box.remove();
  return Math.max(height, Math.ceil(20 * 1.35 + TEXT_PADDING * 2));
}

/** Масштаб картинки: степень двойки, не меньше 0,5 и не больше 8 (повторная отрисовка — только при заметной смене масштаба). */
export function rasterScale(zoom: number, dpr: number): number {
  const s = Math.max(0.5, Math.min(8, zoom * dpr));
  return 2 ** Math.ceil(Math.log2(s));
}

/** Не больше стольких пикселей в одной картинке текста. */
const MAX_PIXELS = 16_000_000;

/** SVG-документ блока (строка). */
export function textSvg(doc: JSONContent, w: number, h: number, theme: CanvasTheme, fill: string | null, scale: number): string {
  let s = scale;
  if (w * h * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (w * h));
  const xhtml = new XMLSerializer().serializeToString(docToElement(doc));
  const bg = fill ? `background:${fill};` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w * s)}" height="${Math.ceil(h * s)}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${colorVars(theme)}${bg}">` +
    `<style>${TEXT_CSS}</style>${xhtml}</div></foreignObject></svg>`
  );
}

const cache = new Map<string, Promise<HTMLImageElement>>();
const CACHE_LIMIT = 300;

/** Картинка блока (с кэшем по содержимому, размеру, теме и масштабу). */
export function rasterizeText(doc: JSONContent, w: number, h: number, theme: CanvasTheme, fill: string | null, scale: number): Promise<HTMLImageElement> {
  const key = `${theme}|${fill}|${w}|${h}|${scale}|${JSON.stringify(doc)}`;
  let p = cache.get(key);
  if (p) {
    // Свежие ключи — в конец (вытесняются самые старые).
    cache.delete(key);
    cache.set(key, p);
    return p;
  }
  p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось отрисовать текст'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(textSvg(doc, w, h, theme, fill, scale))}`;
  });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return p;
}
