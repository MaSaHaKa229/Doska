import { createRoot } from 'react-dom/client';
import { Layer, Rect as KRect, Shape, Stage } from 'react-konva';
import type Konva from 'konva';
import * as Y from 'yjs';
import type { BoardCapabilities, Rect } from '@doska/shared';
import { BoardModel } from '../collab/model';
import { registry } from '../plugins/registry';
import { SURFACE_COLORS, type CanvasTheme } from '../objects/colors';
import { ObjectView } from '../canvas/BoardStage';
import { drawBackground, type Ctx2D } from '../canvas/background';

/**
 * Экспорт (этап 8.2a): область страницы рисуется вне экрана теми же
 * модулями объектов, что и холст, на копии документа (живая модель доски
 * не трогается). Из готового рисунка — PNG (растр), SVG (повтор отрисовки в
 * векторный контекст svgcanvas) и PDF (страницы картинками через jsPDF).
 */

const VIEW_ONLY: BoardCapabilities = {
  role: 'viewer',
  view: true,
  write: false,
  noWriteReason: 'read-only',
  moderate: false,
  manageLesson: false,
  managePages: false,
  editOthers: false,
  editTeacherObjects: false,
  laser: false,
  leadFollow: false,
  clearStudentObjects: false,
  restoreVersions: false,
  raiseHand: false,
};

/** Поля вокруг содержимого, мировые единицы. */
export const EXPORT_PAD = 24;
/** Наибольшая сторона растра (ограничение браузеров на размер холста). */
export const MAX_SIDE = 8000;

export interface ExportArea {
  pageId: string;
  rect: Rect;
  /** Объекты в порядке отрисовки. */
  ids: string[];
}

/** Область экспорта: выделенные объекты или всё содержимое страницы; null — пусто. */
export function exportArea(model: BoardModel, pageId: string, selection: string[] = []): ExportArea | null {
  const page = model.pageObjects(pageId);
  const chosen = selection.length ? new Set(selection) : null;
  const ids = chosen ? page.filter((id) => chosen.has(id)) : page;
  if (!ids.length) return null;
  const b = chosen ? model.boundsOf(ids) : model.pageBounds(pageId);
  if (!b || !(b.width > 0) || !(b.height > 0)) return null;
  return { pageId, ids, rect: { x: b.x - EXPORT_PAD, y: b.y - EXPORT_PAD, width: b.width + 2 * EXPORT_PAD, height: b.height + 2 * EXPORT_PAD } };
}

/** Множитель разрешения с учётом предела стороны растра. */
export const clampRatio = (rect: Rect, ratio: number) => Math.max(0.05, Math.min(ratio, MAX_SIDE / rect.width, MAX_SIDE / rect.height));

/** Копия модели только для чтения на снимке документа. */
export function snapshotModel(model: BoardModel): BoardModel {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(model.doc));
  return new BoardModel(doc, { userId: '', registry, getCaps: () => VIEW_ONLY, ownerId: '' });
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Rendered {
  stage: Konva.Stage;
  width: number;
  height: number;
  dispose: () => void;
}

/**
 * Нарисовать область вне экрана (масштаб 1 — мировые единицы). Ждёт, пока
 * дорисуются формулы и картинки (они готовятся асинхронно).
 */
export async function renderArea(model: BoardModel, area: ExportArea, opts: { background: boolean }): Promise<Rendered> {
  const page = model.page(area.pageId);
  const theme: CanvasTheme = page?.background.surface === 'chalk' ? 'chalk' : 'light';
  const colors = SURFACE_COLORS[theme];
  model.resolve.zoom = 1;
  model.resolve.theme = theme;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  const { rect } = area;
  const w = Math.ceil(rect.width);
  const h = Math.ceil(rect.height);
  let stage: Konva.Stage | null = null;
  root.render(
    <Stage ref={(s) => (stage = s)} width={w} height={h} x={-rect.x} y={-rect.y} listening={false}>
      <Layer listening={false}>
        {opts.background && <KRect x={rect.x} y={rect.y} width={w} height={h} fill={colors.paper} listening={false} />}
        {opts.background && page && (
          <Shape
            listening={false}
            sceneFunc={(ctx) => {
              const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
              drawBackground(native as unknown as Ctx2D, page.background, rect, 1, { minor: colors.grid, major: colors.gridStrong });
            }}
          />
        )}
        {area.ids.map((id) => (
          <ObjectView key={id} model={model} id={id} theme={theme} register={() => undefined} />
        ))}
      </Layer>
    </Stage>,
  );
  // Формулы растеризуются, картинки грузятся: несколько кадров и пауза, затем ещё кадр.
  await document.fonts?.ready;
  for (let i = 0; i < 3; i++) await frame();
  await sleep(700);
  await frame();
  if (!stage) throw new Error('Не удалось подготовить рисунок');
  const s = stage as Konva.Stage;
  s.batchDraw();
  await frame();
  return {
    stage: s,
    width: w,
    height: h,
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** Растр с множителем разрешения. */
export function toCanvas(r: Rendered, ratio: number): HTMLCanvasElement {
  return r.stage.toCanvas({ pixelRatio: ratio });
}

/**
 * SVG: слой перерисовывается в контекст svgcanvas (линии, фигуры и текст —
 * векторно; формулы, картинки и заливки-растры — встроенными изображениями).
 */
export async function toSvg(r: Rendered): Promise<string> {
  const { Context } = await import('svgcanvas');
  const svg = new Context({ width: r.width, height: r.height });
  // Konva перед обводкой «без масштабирования толщины» вызывает save(), а svgcanvas
  // в save() переключается на новую группу и теряет начатый контур — обводка
  // уходила в пустую группу. Начатый контур остаётся текущим элементом.
  // То же с restore(): наконечник стрелки Konva строит между save() и restore(), а заливает после.
  const inner = svg as unknown as { save: () => void; restore: () => void; __currentElement: Element };
  const keepPath = (fn: () => void) => () => {
    const current = inner.__currentElement;
    fn();
    if (current?.nodeName === 'path') inner.__currentElement = current;
  };
  inner.save = keepPath(inner.save.bind(svg));
  inner.restore = keepPath(inner.restore.bind(svg));
  for (const layer of r.stage.getLayers()) {
    const canvas = layer.getCanvas();
    canvas.setPixelRatio(1);
    const kctx = canvas.getContext() as unknown as { _context: unknown };
    const native = kctx._context;
    kctx._context = svg;
    try {
      layer.drawScene();
    } finally {
      kctx._context = native;
    }
  }
  return svg.getSerializedSvg(true);
}

/** Имя файла из названия доски: без запрещённых символов. */
export function fileName(title: string, suffix: string, ext: string): string {
  const base = (title.trim() || 'Доска').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${base}${suffix ? ` — ${suffix}` : ''}.${ext}`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canvasBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось получить картинку'))), type, quality));

/** Размер листа PDF, мм: A4 по ориентации содержимого или «по содержимому» (96 точек на дюйм). */
export function pdfPage(rect: Rect, format: 'a4' | 'content'): { w: number; h: number; landscape: boolean } {
  const landscape = rect.width >= rect.height;
  if (format === 'a4') return landscape ? { w: 297, h: 210, landscape } : { w: 210, h: 297, landscape };
  const mm = 25.4 / 96;
  return { w: Math.max(20, rect.width * mm), h: Math.max(20, rect.height * mm), landscape };
}

/** Вписать картинку w × h в лист с полями: положение и размер, мм. */
export function fitOnPage(rect: Rect, page: { w: number; h: number }, margin: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min((page.w - 2 * margin) / rect.width, (page.h - 2 * margin) / rect.height);
  const w = rect.width * k;
  const h = rect.height * k;
  return { x: (page.w - w) / 2, y: (page.h - h) / 2, w, h };
}
