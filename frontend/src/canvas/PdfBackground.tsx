import { useEffect, useState } from 'react';
import { Image as KImage, Rect as KRect } from 'react-konva';
import type { Background, Rect } from '@doska/shared';
import { loadPdf, renderPdfRegion } from '../media/pdf';
import { viewportRect, type Camera, type Size } from './camera';

type PdfRef = NonNullable<Background['pdf']>;
interface Rendered {
  canvas: HTMLCanvasElement;
  rect: Rect;
}

/** Обзорная отрисовка всей страницы: не больше стольких пикселей по длинной стороне. */
const OVERVIEW_PX = 1600;
const DETAIL_DELAY_MS = 150;

/**
 * Страница PDF как фон страницы доски. Сразу рисуется вся страница в
 * умеренном разрешении, а после остановки камеры — видимая часть в точном
 * масштабе экрана (чёткий текст при любом увеличении, память — в пределах
 * размера окна).
 */
export function PdfBackground({ pdf, camera, size }: { pdf: PdfRef; camera: Camera; size: Size }) {
  const [overview, setOverview] = useState<Rendered | null>(null);
  const [detail, setDetail] = useState<Rendered | null>(null);
  const [failed, setFailed] = useState(false);
  const page = { width: pdf.width, height: pdf.height };

  useEffect(() => {
    const signal = { cancelled: false };
    setOverview(null);
    setDetail(null);
    setFailed(false);
    const ppu = OVERVIEW_PX / Math.max(pdf.width, pdf.height);
    loadPdf(pdf.assetId)
      .then((doc) => renderPdfRegion(doc, pdf.page, page, { x: 0, y: 0, ...page }, ppu, signal))
      .then((r) => !signal.cancelled && r && setOverview(r))
      .catch(() => !signal.cancelled && setFailed(true));
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.assetId, pdf.page, pdf.width, pdf.height]);

  useEffect(() => {
    const ppu = camera.zoom * (window.devicePixelRatio || 1);
    const overviewPpu = OVERVIEW_PX / Math.max(pdf.width, pdf.height);
    // При мелком масштабе обзорной отрисовки достаточно.
    if (ppu <= overviewPpu * 1.1) {
      setDetail(null);
      return;
    }
    const signal = { cancelled: false };
    const t = setTimeout(() => {
      const view = viewportRect(camera, size);
      loadPdf(pdf.assetId)
        .then((doc) => renderPdfRegion(doc, pdf.page, page, view, ppu, signal))
        .then((r) => !signal.cancelled && setDetail(r))
        .catch(() => undefined);
    }, DETAIL_DELAY_MS);
    return () => {
      signal.cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.assetId, pdf.page, pdf.width, pdf.height, camera.cx, camera.cy, camera.zoom, size.width, size.height]);

  return (
    <>
      <KRect x={0} y={0} width={pdf.width} height={pdf.height} fill="#ffffff" shadowColor="#000" shadowOpacity={0.18} shadowBlur={12} listening={false} />
      {overview && <KImage image={overview.canvas} {...overview.rect} listening={false} />}
      {detail && <KImage image={detail.canvas} {...detail.rect} listening={false} />}
      {failed && <KRect x={0} y={0} width={pdf.width} height={pdf.height} stroke="#c62f2f" dash={[8, 6]} strokeWidth={2} strokeScaleEnabled={false} listening={false} />}
    </>
  );
}
