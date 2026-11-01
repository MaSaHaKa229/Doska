import type { Point, Rect, Viewport } from '@doska/shared';

/**
 * Камера: мировая точка в центре экрана и масштаб.
 *   экран = (мир − центр) · zoom + размерЭкрана / 2
 * Та же модель используется в протоколе («Следуйте за мной», viewport).
 */
export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 50;

export const DEFAULT_CAMERA: Camera = { cx: 0, cy: 0, zoom: 1 };

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function worldToScreen(cam: Camera, size: Size, p: Point): Point {
  return { x: (p.x - cam.cx) * cam.zoom + size.width / 2, y: (p.y - cam.cy) * cam.zoom + size.height / 2 };
}

export function screenToWorld(cam: Camera, size: Size, p: Point): Point {
  return { x: (p.x - size.width / 2) / cam.zoom + cam.cx, y: (p.y - size.height / 2) / cam.zoom + cam.cy };
}

/** Видимая область в мировых координатах. */
export function viewportRect(cam: Camera, size: Size): Rect {
  const w = size.width / cam.zoom;
  const h = size.height / cam.zoom;
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, width: w, height: h };
}

/** Масштабирование с сохранением мировой точки под курсором (screenPoint). */
export function zoomAt(cam: Camera, size: Size, screenPoint: Point, newZoom: number): Camera {
  const zoom = clampZoom(newZoom);
  const before = screenToWorld(cam, size, screenPoint);
  const next = { ...cam, zoom };
  const after = screenToWorld(next, size, screenPoint);
  return { cx: cam.cx + (before.x - after.x), cy: cam.cy + (before.y - after.y), zoom };
}

/** Сдвиг камеры на экранный вектор (панорамирование). */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, cx: cam.cx - dxScreen / cam.zoom, cy: cam.cy - dyScreen / cam.zoom };
}

/** Камера, показывающая прямоугольник целиком с отступом. */
export function fitRect(rect: Rect, size: Size, padding = 48, maxZoom = 2): Camera {
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  const zoom = clampZoom(Math.min((size.width - padding * 2) / w, (size.height - padding * 2) / h, maxZoom));
  return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, zoom };
}

/**
 * Интерпретация события колеса: щипок трекпада (ctrlKey) и колесо мыши —
 * масштаб; прокрутка двумя пальцами по трекпаду — перемещение.
 * Колесо мыши отличаем по построчному режиму или крупному целому шагу без
 * горизонтальной составляющей.
 */
export function wheelIntent(e: { ctrlKey: boolean; metaKey: boolean; deltaMode: number; deltaX: number; deltaY: number }): 'zoom' | 'pan' {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (e.deltaMode === 1 || e.deltaMode === 2) return 'zoom';
  if (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)) return 'zoom';
  return 'pan';
}

/** Коэффициент масштаба для события колеса (плавный, не зависит от устройства). */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * 0.0015);
}

/** Вид для протокола: центр, масштаб и видимая мировая область. */
export function cameraToViewport(cam: Camera, size: Size, pageId: string): Viewport {
  return { pageId, centerX: cam.cx, centerY: cam.cy, zoom: cam.zoom, w: size.width / cam.zoom, h: size.height / cam.zoom };
}

/**
 * «Следуйте за мной»: камера, показывающая ту же мировую область, что у
 * ведущего, в окне другого размера. Центр сохраняется, масштаб подгоняется
 * так, чтобы область поместилась целиком. Без размера области (старый
 * клиент) — масштаб ведущего как есть.
 */
export function cameraForViewport(v: Viewport, size: Size): Camera {
  if (!v.w || !v.h) return { cx: v.centerX, cy: v.centerY, zoom: clampZoom(v.zoom) };
  const zoom = clampZoom(Math.min(size.width / v.w, size.height / v.h));
  return { cx: v.centerX, cy: v.centerY, zoom };
}

/** Промежуточная камера анимации перехода (t ∈ [0, 1]); масштаб — по логарифму. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const k = Math.min(1, Math.max(0, t));
  return {
    cx: a.cx + (b.cx - a.cx) * k,
    cy: a.cy + (b.cy - a.cy) * k,
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k),
  };
}
