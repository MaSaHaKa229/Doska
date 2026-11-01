import type { PDFDocumentProxy } from 'pdfjs-dist';
import { assetUrl, PDF_POINT_TO_WORLD, type Rect } from '@doska/shared';

/**
 * Работа с PDF в браузере (pdf.js): документы открываются по адресу файла
 * доски, страницы рисуются на холсте ровно в том масштабе, в каком их
 * видит пользователь, поэтому текст остаётся чётким при любом увеличении.
 * Библиотека и её воркер загружаются только когда на доске есть PDF.
 */

type PdfLib = typeof import('pdfjs-dist');
let lib: Promise<PdfLib> | null = null;

function pdfjs(): Promise<PdfLib> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(assetId: string): Promise<PDFDocumentProxy> {
  let p = docs.get(assetId);
  if (!p) {
    p = pdfjs().then((m) => m.getDocument({ url: assetUrl(assetId), withCredentials: true, enableXfa: false }).promise);
    p.catch(() => docs.delete(assetId));
    docs.set(assetId, p);
  }
  return p;
}

/** Размеры страниц в мировых единицах (с учётом поворота страницы в файле). */
export async function pdfPageSizes(doc: PDFDocumentProxy, from = 1, to = doc.numPages): Promise<{ width: number; height: number }[]> {
  const out: { width: number; height: number }[] = [];
  for (let n = from; n <= to; n++) {
    const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
    out.push({ width: vp.width * PDF_POINT_TO_WORLD, height: vp.height * PDF_POINT_TO_WORLD });
  }
  return out;
}

/** Предел пикселей одного отрисованного фрагмента (память видеокарты). */
const MAX_RENDER_PIXELS = 16_000_000;

/**
 * Отрисовать область страницы. region — в мировых координатах страницы
 * (0,0 — левый верхний угол), pixelsPerUnit — пикселей экрана на мировую
 * единицу (масштаб × devicePixelRatio). Возвращает холст и фактическую
 * область (после ограничения размером страницы).
 */
export async function renderPdfRegion(
  doc: PDFDocumentProxy,
  pageNo: number,
  pageWorld: { width: number; height: number },
  region: Rect,
  pixelsPerUnit: number,
  signal?: { cancelled: boolean },
): Promise<{ canvas: HTMLCanvasElement; rect: Rect } | null> {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(pageWorld.width, region.x + region.width);
  const y1 = Math.min(pageWorld.height, region.y + region.height);
  if (x1 <= x0 || y1 <= y0) return null;
  let ppu = pixelsPerUnit;
  const area = (x1 - x0) * (y1 - y0) * ppu * ppu;
  if (area > MAX_RENDER_PIXELS) ppu *= Math.sqrt(MAX_RENDER_PIXELS / area);
  const page = await doc.getPage(pageNo);
  if (signal?.cancelled) return null;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (pageWorld.width / base.width) * ppu });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((x1 - x0) * ppu));
  canvas.height = Math.max(1, Math.ceil((y1 - y0) * ppu));
  await page.render({ canvas, viewport, transform: [1, 0, 0, 1, -x0 * ppu, -y0 * ppu], background: '#ffffff' }).promise;
  if (signal?.cancelled) return null;
  return { canvas, rect: { x: x0, y: y0, width: (canvas.width / ppu), height: canvas.height / ppu } };
}
