import type { ReactNode } from 'react';
import { Circle, Ellipse, Line, Rect as KRect } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule } from '@doska/shared';
import { resolveColor } from '../objects/colors';
import { toLocal, localTolerance } from '../objects/util';
import {
  StrokeBuilder,
  eraseFromStroke,
  pointCount,
  recognizeShape,
  roundPoints,
  simplifyStroke,
  type RecognizedShape,
} from '../objects/stroke/geometry';
import { MAX_STROKE_POINTS, STROKE_TYPE, StrokeShape, type StrokeProps } from '../objects/stroke/stroke';
import type { ShapeProps } from '../objects/shape';
import type { ToolOptions } from '../store/board';

export const PEN_TOOL_ID = 'core.pen';
export const MARKER_TOOL_ID = 'core.marker';
export const ERASER_TOOL_ID = 'core.eraser';

/** Начать штрих «по линейке» можно не дальше этого расстояния от края (экранные пт). */
const GUIDE_PX = 16;

type Guide = { a: Point; b: Point };

/** Ближайший к точке край-направляющая в пределах допуска. */
export function nearestGuide(guides: Guide[], p: Point, tol: number): Guide | null {
  let best: { g: Guide; d: number } | null = null;
  for (const g of guides) {
    const q = projectOnGuide(g, p);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { g, d };
  }
  return best?.g ?? null;
}

/** Проекция точки на край (в пределах его длины). */
export function projectOnGuide(g: Guide, p: Point): Point {
  const dx = g.b.x - g.a.x;
  const dy = g.b.y - g.a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.min(1, Math.max(0, ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / l2)) : 0;
  return { x: g.a.x + dx * t, y: g.a.y + dy * t };
}

/** Задержка пера на месте, после которой штрих распознаётся как фигура. */
export const RECOGNIZE_HOLD_MS = 600;
/** Сырые точки одного штриха; длиннее — штрих сохраняется и продолжается новым. */
const MAX_RAW_POINTS = 6000;

interface StrokePreview {
  points: number[];
  width: number;
  color: string;
  opacity: number;
  pressure: boolean;
  recognized: RecognizedShape | null;
}

// ---------------------------------------------------------------------
//  Сохранение штриха и распознанной фигуры
// ---------------------------------------------------------------------

/**
 * Записать штрих в документ: упростить (точность — треть экранного
 * пикселя), перенести начало координат в угол габарита, округлить. Слишком
 * длинный штрих делится на части по MAX_STROKE_POINTS точек.
 */
export function commitStroke(
  ctx: ToolContext,
  world: readonly number[],
  props: Omit<StrokeProps, 'points'>,
  placement: 'top' | 'bottom' = 'top',
): string[] {
  const simplified = simplifyStroke(world, ctx.screenToWorld(0.35));
  const ids: string[] = [];
  const n = pointCount(simplified);
  for (let start = 0; start < n; start += MAX_STROKE_POINTS - 1) {
    const chunk = simplified.slice(start * 3, Math.min(n, start + MAX_STROKE_POINTS) * 3);
    if (chunk.length < 3) break;
    let x0 = Infinity;
    let y0 = Infinity;
    for (let i = 0; i < chunk.length; i += 3) {
      x0 = Math.min(x0, chunk[i]!);
      y0 = Math.min(y0, chunk[i + 1]!);
    }
    const local = roundPoints(chunk.map((v, i) => (i % 3 === 0 ? v - x0 : i % 3 === 1 ? v - y0 : v)));
    const id = ctx.createObject<StrokeProps>(STROKE_TYPE, { x: x0, y: y0, props: { ...props, points: local }, placement });
    if (id) ids.push(id);
    if (start + MAX_STROKE_POINTS >= n) break;
  }
  return ids;
}

/** Начало локальной системы повёрнутого прямоугольника с центром (cx, cy). */
function rotatedOrigin(cx: number, cy: number, w: number, h: number, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: cx - (c * w) / 2 + (s * h) / 2, y: cy - (s * w) / 2 - (c * h) / 2 };
}

/** Распознанная фигура → объект документа (фигура ядра или замкнутая ломаная). */
export function commitRecognized(ctx: ToolContext, r: RecognizedShape, opts: { color: string; penWidth: number; worldWidth: number }): string {
  const shape = (kind: ShapeProps['kind'], x: number, y: number, w: number, h: number, rotation = 0) => {
    return ctx.createObject<ShapeProps>('core.shape', {
      x,
      y,
      rotation,
      props: { kind, w, h, stroke: opts.color, fill: 'none', strokeWidth: Math.min(100, Math.max(0.5, opts.penWidth)), dash: 'solid' },
    });
  };
  switch (r.kind) {
    case 'line':
      return shape('line', r.a.x, r.a.y, r.b.x - r.a.x, r.b.y - r.a.y);
    case 'rect': {
      const o = rotatedOrigin(r.cx, r.cy, r.w, r.h, r.angle);
      return shape('rect', o.x, o.y, r.w, r.h, r.angle);
    }
    case 'ellipse': {
      const o = rotatedOrigin(r.cx, r.cy, r.rx * 2, r.ry * 2, r.angle);
      return shape('ellipse', o.x, o.y, r.rx * 2, r.ry * 2, r.angle);
    }
    case 'polygon': {
      const x0 = Math.min(...r.points.map((p) => p.x));
      const y0 = Math.min(...r.points.map((p) => p.y));
      const points = roundPoints(r.points.flatMap((p) => [p.x - x0, p.y - y0, 0.5]));
      return ctx.createObject<StrokeProps>(STROKE_TYPE, {
        x: x0,
        y: y0,
        props: { points, color: opts.color, width: opts.worldWidth, opacity: 1, pressure: false, closed: true, kind: 'pen' },
      });
    }
  }
}

/** Контур распознанной фигуры для предпросмотра (мировые координаты). */
function RecognizedGhost({ r, color, width }: { r: RecognizedShape; color: string; width: number }) {
  const common = { stroke: color, strokeWidth: width, listening: false, lineCap: 'round' as const, lineJoin: 'round' as const };
  switch (r.kind) {
    case 'line':
      return <Line points={[r.a.x, r.a.y, r.b.x, r.b.y]} {...common} />;
    case 'rect':
      return <KRect x={r.cx} y={r.cy} width={r.w} height={r.h} offsetX={r.w / 2} offsetY={r.h / 2} rotation={(r.angle * 180) / Math.PI} {...common} />;
    case 'ellipse':
      return <Ellipse x={r.cx} y={r.cy} radiusX={r.rx} radiusY={r.ry} rotation={(r.angle * 180) / Math.PI} {...common} />;
    case 'polygon':
      return <Line points={r.points.flatMap((p) => [p.x, p.y])} closed {...common} />;
  }
}

// ---------------------------------------------------------------------
//  Перо и маркер
// ---------------------------------------------------------------------

function strokeTool(kind: 'pen' | 'marker'): ToolModule<ReactNode> {
  const pen = kind === 'pen';
  let builder: StrokeBuilder | null = null;
  let style: Omit<StrokePreview, 'points' | 'recognized'> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdAnchor: Point | null = null;
  let recognized: RecognizedShape | null = null;
  let penWidthPx = 3;
  /** Край линейки, вдоль которого идёт текущий штрих. */
  let guide: Guide | null = null;

  const clearHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  };

  const update = (ctx: ToolContext) => {
    if (!builder || !style) return;
    ctx.setPreview({ ...style, points: builder.points, recognized } satisfies StrokePreview);
    ctx.publishDrawing({ tool: pen ? PEN_TOOL_ID : MARKER_TOOL_ID, color: style.color, width: style.width, opacity: style.opacity, points: builder.points });
  };

  const armHold = (ctx: ToolContext, at: Point) => {
    if (!pen || !ctx.getToolOptions<ToolOptions>().recognizeShapes) return;
    clearHold();
    holdAnchor = at;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!builder) return;
      const pts: Point[] = [];
      for (let i = 0; i < builder.points.length; i += 3) pts.push({ x: builder.points[i]!, y: builder.points[i + 1]! });
      recognized = recognizeShape(pts, ctx.screenToWorld(24));
      if (recognized) update(ctx);
    }, RECOGNIZE_HOLD_MS);
  };

  const end = (ctx: ToolContext) => {
    clearHold();
    guide = null;
    builder = null;
    style = null;
    recognized = null;
    holdAnchor = null;
    ctx.setPreview(null);
    ctx.publishDrawing(null);
  };

  return {
    id: pen ? PEN_TOOL_ID : MARKER_TOOL_ID,
    title: pen ? 'Перо' : 'Маркер',
    icon: pen ? 'PenLine' : 'Highlighter',
    group: 'draw',
    hotkey: pen ? 'P' : 'M',
    keywords: pen
      ? ['перо', 'карандаш', 'рисовать', 'от руки', 'ручка', 'стилус', 'pen', 'draw']
      : ['маркер', 'выделитель', 'подчеркнуть', 'выделить', 'highlighter', 'marker'],
    requiresWrite: true,
    cursor: 'crosshair',
    options: pen
      ? [
          { kind: 'color', key: 'stroke', label: 'Цвет' },
          { kind: 'stroke-width', key: 'penWidth', label: 'Толщина' },
          { kind: 'toggle', key: 'recognizeShapes', label: 'Распознавать фигуры (задержите перо)' },
        ]
      : [
          { kind: 'color', key: 'markerColor', label: 'Цвет' },
          {
            kind: 'select',
            key: 'markerWidth',
            label: 'Ширина',
            options: [8, 12, 16, 24, 32].map((w) => ({ value: String(w), label: `${w} пт` })),
          },
        ],
    onPointerDown(e, ctx) {
      const o = ctx.getToolOptions<ToolOptions>();
      penWidthPx = o.penWidth;
      // Штрих, начатый у края линейки, идёт ровно вдоль него.
      guide = nearestGuide(ctx.guides(), e.world, ctx.screenToWorld(GUIDE_PX));
      const start = guide ? projectOnGuide(guide, e.world) : e.world;
      const px = ctx.screenToWorld(1);
      style = pen
        ? { width: o.penWidth * px, color: o.stroke, opacity: 1, pressure: true }
        : { width: Number(o.markerWidth) * px, color: o.markerColor, opacity: 0.35, pressure: false };
      builder = new StrokeBuilder(px * 0.75, pen ? 0.45 : 0.6);
      builder.add(start.x, start.y, e.pressure);
      recognized = null;
      if (!guide) armHold(ctx, e.world);
      update(ctx);
    },
    onPointerMove(e, ctx) {
      if (!builder || !style) return;
      const at = guide ? projectOnGuide(guide, e.world) : e.world;
      if (!builder.add(at.x, at.y, e.pressure)) return;
      if (guide) {
        update(ctx);
        return;
      }
      // Перо сдвинулось — распознавание откладывается до новой задержки.
      if (holdAnchor && Math.hypot(e.world.x - holdAnchor.x, e.world.y - holdAnchor.y) > ctx.screenToWorld(4)) {
        recognized = null;
        armHold(ctx, e.world);
      }
      // Очень длинный росчерк: сохранить и продолжить новым штрихом.
      if (builder.count >= MAX_RAW_POINTS) {
        const last = builder.points.slice(-3);
        commitStroke(ctx, builder.points, { ...style, kind }, pen ? 'top' : 'bottom');
        builder = new StrokeBuilder(ctx.screenToWorld(0.75), pen ? 0.45 : 0.6);
        builder.add(last[0]!, last[1]!, last[2]!);
      }
      update(ctx);
    },
    onPointerUp(e, ctx) {
      if (!builder || !style) return end(ctx);
      const s = style;
      const b = builder;
      const r = recognized;
      // Фигура с поворотом или длинный штрих из частей — один шаг отмены.
      ctx.transact(() => {
        if (r) commitRecognized(ctx, r, { color: s.color, penWidth: penWidthPx, worldWidth: s.width });
        else {
          const at = guide ? projectOnGuide(guide, e.world) : e.world;
          b.finish(at.x, at.y, e.pressure);
          commitStroke(ctx, b.points, { ...s, kind }, pen ? 'top' : 'bottom');
        }
      });
      end(ctx);
    },
    onDeactivate(ctx) {
      end(ctx);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<StrokePreview>();
      if (!p || p.points.length < 3) return null;
      const color = resolveColor(p.color, ctx.resolve.theme);
      if (p.recognized) {
        return (
          <>
            <StrokeShape props={{ ...p, opacity: 0.25 }} color={color} />
            <RecognizedGhost r={p.recognized} color={color} width={p.width} />
          </>
        );
      }
      return <StrokeShape props={p} color={color} />;
    },
  };
}

export const penTool = strokeTool('pen');
export const markerTool = strokeTool('marker');

// ---------------------------------------------------------------------
//  Ластик
// ---------------------------------------------------------------------

interface EraserPreview {
  x: number;
  y: number;
  r: number;
}

/**
 * Попиксельное стирание одним кругом: части штрихов вне круга остаются.
 * Первая часть остаётся тем же объектом (автор не меняется), остальные
 * создаются рядом с теми же поворотом, масштабом и слоем. Возвращает,
 * изменилось ли что-нибудь.
 */
export function erasePixels(ctx: ToolContext, hits: readonly BoardObject[], center: Point, radius: number): boolean {
  let changed = false;
  for (const o of hits) {
    if (o.type !== STROKE_TYPE || !ctx.canModify(o.id)) continue;
    const props = o.props as unknown as StrokeProps;
    const pieces = eraseFromStroke(props.points, toLocal(o, center), localTolerance(o, radius));
    if (!pieces) continue;
    if (pieces.length === 0) {
      if (!ctx.canDelete(o.id)) continue;
      ctx.deleteObjects([o.id]);
      changed = true;
      continue;
    }
    ctx.updateObject(o.id, { props: { points: roundPoints(pieces[0]!) } });
    for (const piece of pieces.slice(1)) {
      ctx.createObject<StrokeProps>(STROKE_TYPE, {
        x: o.x,
        y: o.y,
        props: { ...props, points: roundPoints(piece) },
        placement: props.kind === 'marker' ? 'bottom' : 'top',
        layer: o.layer,
        rotation: o.rotation,
        scaleX: o.scaleX,
        scaleY: o.scaleY,
      });
    }
    changed = true;
  }
  return changed;
}

export const eraserTool: ToolModule<ReactNode> = (() => {
  let last: Point | null = null;
  let started = false;

  const eraseAt = (ctx: ToolContext, p: Point) => {
    const o = ctx.getToolOptions<ToolOptions>();
    const r = ctx.screenToWorld(Number(o.eraserSize) / 2);
    const hits = ctx.hitTest(p, r);
    if (!hits.length) return;
    // Весь жест ластика — один шаг отмены.
    ctx.transact(
      () => {
        if (o.eraserMode === 'pixel') {
          if (erasePixels(ctx, hits, p, r)) started = true;
        } else {
          const ids = hits.filter((h) => h.type !== 'core.group' && ctx.canDelete(h.id)).map((h) => h.id);
          if (ids.length) {
            ctx.deleteObjects(ids);
            started = true;
          }
        }
      },
      { merge: started },
    );
  };

  /** Проход от прошлой точки к новой с шагом в полрадиуса — быстрый жест не оставляет пропусков. */
  const sweep = (ctx: ToolContext, to: Point) => {
    const from = last ?? to;
    const r = ctx.screenToWorld(Number(ctx.getToolOptions<ToolOptions>().eraserSize) / 2);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(d / Math.max(r / 2, 1e-6)));
    for (let i = 1; i <= steps; i++) eraseAt(ctx, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    last = to;
  };

  const preview = (ctx: ToolContext, p: Point) =>
    ctx.setPreview({ x: p.x, y: p.y, r: ctx.screenToWorld(Number(ctx.getToolOptions<ToolOptions>().eraserSize) / 2) } satisfies EraserPreview);

  return {
    id: ERASER_TOOL_ID,
    title: 'Ластик',
    icon: 'Eraser',
    group: 'draw',
    hotkey: 'E',
    keywords: ['ластик', 'стереть', 'стирать', 'удалить', 'eraser'],
    requiresWrite: true,
    cursor: 'crosshair',
    options: [
      {
        kind: 'select',
        key: 'eraserMode',
        label: 'Стирать',
        options: [
          { value: 'stroke', label: 'Объекты целиком' },
          { value: 'pixel', label: 'Части штрихов' },
        ],
      },
      { kind: 'select', key: 'eraserSize', label: 'Размер', options: [10, 20, 40, 80].map((w) => ({ value: String(w), label: `${w} пт` })) },
    ],
    onPointerDown(e, ctx) {
      last = null;
      started = false;
      sweep(ctx, e.world);
      preview(ctx, e.world);
    },
    onPointerMove(e, ctx) {
      sweep(ctx, e.world);
      preview(ctx, e.world);
    },
    onPointerUp(_e, ctx) {
      last = null;
      started = false;
      ctx.setPreview(null);
    },
    onDeactivate(ctx) {
      ctx.setPreview(null);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<EraserPreview>();
      if (!p) return null;
      return <Circle x={p.x} y={p.y} radius={p.r} stroke="#7a7a7a" strokeWidth={ctx.screenToWorld(1)} dash={[ctx.screenToWorld(3), ctx.screenToWorld(3)]} listening={false} />;
    },
  };
})();
