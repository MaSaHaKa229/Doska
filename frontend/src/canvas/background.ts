import type { Background, Rect } from '@doska/shared';

/** Минимальное расстояние между линиями сетки на экране (пиксели). */
export const MIN_GRID_PX = 8;

/**
 * Шаг сетки с учётом масштаба (уровень детализации): при сильном отдалении
 * шаг увеличивается в 5 раз, пока линии не станут реже MIN_GRID_PX —
 * иначе на экране были бы десятки тысяч линий.
 */
export function effectiveStep(step: number, zoom: number): number {
  let s = step;
  while (s * zoom < MIN_GRID_PX) s *= 5;
  return s;
}

export interface GridColors {
  minor: string;
  major: string;
}

/** Минимальный интерфейс 2D-контекста (подходит и Konva.Context, и CanvasRenderingContext2D). */
export interface Ctx2D {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  fill(): void;
  set strokeStyle(v: string);
  set fillStyle(v: string);
  set lineWidth(v: number);
}

function verticals(ctx: Ctx2D, view: Rect, step: number, offset = 0): void {
  const start = Math.floor((view.x - offset) / step) * step + offset;
  for (let x = start; x <= view.x + view.width; x += step) {
    ctx.moveTo(x, view.y);
    ctx.lineTo(x, view.y + view.height);
  }
}

function horizontals(ctx: Ctx2D, view: Rect, step: number, offset = 0): void {
  const start = Math.floor((view.y - offset) / step) * step + offset;
  for (let y = start; y <= view.y + view.height; y += step) {
    ctx.moveTo(view.x, y);
    ctx.lineTo(view.x + view.width, y);
  }
}

/** Линии с наклоном (изометрическая сетка): семейство параллельных прямых под углом angle. */
function slanted(ctx: Ctx2D, view: Rect, step: number, angle: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Нормаль к направлению прямых; расстояние между прямыми = step.
  const nx = -dy;
  const ny = dx;
  const corners = [
    [view.x, view.y],
    [view.x + view.width, view.y],
    [view.x, view.y + view.height],
    [view.x + view.width, view.y + view.height],
  ] as const;
  const proj = corners.map(([x, y]) => x * nx + y * ny);
  const min = Math.floor(Math.min(...proj) / step) * step;
  const max = Math.max(...proj);
  const len = view.width + view.height;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  const c = cx * dx + cy * dy;
  for (let d = min; d <= max; d += step) {
    const px = nx * d + dx * c;
    const py = ny * d + dy * c;
    ctx.moveTo(px - dx * len, py - dy * len);
    ctx.lineTo(px + dx * len, py + dy * len);
  }
}

/**
 * Отрисовка фона страницы в мировых координатах (контекст уже
 * масштабирован камерой). Толщина линий — 1 экранный пиксель.
 */
export function drawBackground(ctx: Ctx2D, bg: Background, view: Rect, zoom: number, colors: GridColors): void {
  const px = 1 / zoom;
  const step = effectiveStep(bg.step, zoom);
  ctx.lineWidth = px;
  switch (bg.kind) {
    case 'blank':
      return;
    case 'grid': {
      ctx.strokeStyle = colors.minor;
      ctx.beginPath();
      verticals(ctx, view, step);
      horizontals(ctx, view, step);
      ctx.stroke();
      return;
    }
    case 'ruled': {
      ctx.strokeStyle = colors.minor;
      ctx.beginPath();
      horizontals(ctx, view, step);
      ctx.stroke();
      return;
    }
    case 'dots': {
      ctx.fillStyle = colors.major;
      const r = Math.max(1.2 * px, Math.min(step * 0.06, 2.5 * px));
      ctx.beginPath();
      const sx = Math.floor(view.x / step) * step;
      const sy = Math.floor(view.y / step) * step;
      for (let x = sx; x <= view.x + view.width; x += step) {
        for (let y = sy; y <= view.y + view.height; y += step) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      return;
    }
    case 'millimeter': {
      // Шаг фона = 5 мм; мелкая сетка — 1 мм, жирные линии — каждые 10 мм.
      const mm = bg.step / 5;
      if (mm * zoom >= MIN_GRID_PX / 2) {
        ctx.strokeStyle = colors.minor;
        ctx.beginPath();
        verticals(ctx, view, mm);
        horizontals(ctx, view, mm);
        ctx.stroke();
      }
      const major = effectiveStep(mm * 10, zoom);
      ctx.strokeStyle = colors.major;
      ctx.beginPath();
      verticals(ctx, view, major);
      horizontals(ctx, view, major);
      ctx.stroke();
      return;
    }
    case 'polar': {
      const ox = bg.originX;
      const oy = bg.originY;
      const far = Math.max(
        ...[
          [view.x, view.y],
          [view.x + view.width, view.y],
          [view.x, view.y + view.height],
          [view.x + view.width, view.y + view.height],
        ].map(([x, y]) => Math.hypot(x! - ox, y! - oy)),
      );
      ctx.strokeStyle = colors.minor;
      ctx.beginPath();
      for (let r = step; r <= far; r += step) {
        ctx.moveTo(ox + r, oy);
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.strokeStyle = colors.major;
      ctx.beginPath();
      for (let deg = 0; deg < 360; deg += 15) {
        const a = (deg * Math.PI) / 180;
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(a) * far, oy + Math.sin(a) * far);
      }
      ctx.stroke();
      return;
    }
    case 'isometric': {
      ctx.strokeStyle = colors.minor;
      ctx.beginPath();
      verticals(ctx, view, (step * Math.sqrt(3)) / 2);
      slanted(ctx, view, step * (Math.sqrt(3) / 2), Math.PI / 6);
      slanted(ctx, view, step * (Math.sqrt(3) / 2), (5 * Math.PI) / 6);
      ctx.stroke();
      return;
    }
  }
}
