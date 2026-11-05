import type { BoardObject, Point, Rect, ResolveContext } from '@doska/shared';
import { parseCurve, type ParsedCurve, type Relation } from './expr';

/** Пространство имён плагина и типы объектов. */
export const PLUGIN_ID = 'math.analysis';
export const AXES_TYPE = `${PLUGIN_ID}.axes`;
export const CURVE_TYPE = `${PLUGIN_ID}.curve`;
export const SLIDER_TYPE = `${PLUGIN_ID}.slider`;
export const TABLE_TYPE = `${PLUGIN_ID}.table`;
export const NUMBERLINE_TYPE = `${PLUGIN_ID}.numberline`;
export const TRIG_TYPE = `${PLUGIN_ID}.trig`;

export type AxesProps = {
  /** Размер области на доске (мировые единицы). */
  w: number;
  h: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  grid: boolean;
  color: string;
  /** Подписи осей (физика, 7.1b: «t, с»); по умолчанию x и y. */
  xLabel?: string;
  yLabel?: string;
};

/** Кадр системы координат: перевод «математика ↔ доска». */
export interface Frame {
  rect: Rect;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  toWorld(X: number, Y: number): Point;
  toMath(p: Point): { X: number; Y: number };
}

export function frameOf(o: BoardObject): Frame {
  const p = o.props as unknown as AxesProps;
  const sx = p.w / (p.xMax - p.xMin);
  const sy = p.h / (p.yMax - p.yMin);
  return {
    rect: { x: o.x, y: o.y, width: p.w, height: p.h },
    xMin: p.xMin,
    xMax: p.xMax,
    yMin: p.yMin,
    yMax: p.yMax,
    toWorld: (X, Y) => ({ x: o.x + (X - p.xMin) * sx, y: o.y + (p.yMax - Y) * sy }),
    toMath: (q) => ({ X: p.xMin + (q.x - o.x) / sx, Y: p.yMax - (q.y - o.y) / sy }),
  };
}

export type CurveProps = {
  /** Запись: «y = x^2», «x^2 + y^2 = 25», «y > x», «(cos(t); sin(t))», «r = 1 + cos(t)». */
  text: string;
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  /** Подпись у графика. */
  showLabel: boolean;
  /** Пределы параметра t (параметрическая и полярная кривые). */
  tMin: number;
  tMax: number;
};

/** Значения параметров из слайдеров среди опор графика. */
export function paramsOf(o: BoardObject, ctx: ResolveContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of o.deps.slice(1)) {
    const s = ctx.getObject(id);
    if (s?.type === SLIDER_TYPE) {
      const p = s.props as { name?: unknown; value?: unknown };
      if (typeof p.name === 'string' && typeof p.value === 'number') out[p.name] = p.value;
    }
  }
  return out;
}

/** Результат построения графика в мировых координатах. */
export interface Plot {
  /** Непрерывные куски линии. */
  lines: Point[][];
  /** Отрезки (неявная кривая, граница неравенства). */
  segments: number[];
  /** Закрашенные прямоугольники неравенства (x, y, w, h подряд). */
  cells: number[];
  /** Граница неравенства пунктиром (строгое неравенство). */
  dashedBoundary: boolean;
  /** Куда поставить подпись. */
  labelAt: Point | null;
}

export type CurveState =
  | { ok: true; parsed: ParsedCurve; plot: Plot; frame: Frame; params: Record<string, number> }
  | { ok: false; reason: string; frame: Frame | null };

const plotCache = new Map<string, Plot>();

/** Разобрать запись, взять кадр осей и параметры, построить (с кэшем). */
export function curveState(o: BoardObject<CurveProps>, ctx: ResolveContext): CurveState {
  const axes = ctx.getObject(o.deps[0] ?? '');
  if (!axes || axes.type !== AXES_TYPE) return { ok: false, reason: 'нет системы координат', frame: null };
  const frame = frameOf(axes);
  const parsed = parseCurve(o.props.text);
  if ('error' in parsed) return { ok: false, reason: parsed.error, frame };
  const params = paramsOf(o, ctx);
  const missing = parsed.params.filter((p) => !(p in params));
  if (missing.length) return { ok: false, reason: `нет слайдера: ${missing.join(', ')}`, frame };
  const key = JSON.stringify([o.props.text, o.props.tMin, o.props.tMax, params, frame.rect, frame.xMin, frame.xMax, frame.yMin, frame.yMax]);
  let plot = plotCache.get(key);
  if (!plot) {
    plot = buildPlot(parsed, frame, params, o.props.tMin, o.props.tMax);
    if (plotCache.size > 300) plotCache.clear();
    plotCache.set(key, plot);
  }
  return { ok: true, parsed, plot, frame, params };
}

const finite = (v: number) => Number.isFinite(v);

export function buildPlot(c: ParsedCurve, fr: Frame, params: Record<string, number>, tMin: number, tMax: number): Plot {
  const plot: Plot = { lines: [], segments: [], cells: [], dashedBoundary: false, labelAt: null };
  const R = fr.yMax - fr.yMin;
  const RX = fr.xMax - fr.xMin;
  const scope = (v: Record<string, number>) => ({ ...params, ...v });
  const push = (pts: { X: number; Y: number }[], limitX: number, limitY: number) => {
    // Разрывы: значение не определено, ушло далеко за область или прыгнуло (асимптота).
    let cur: Point[] = [];
    let prev: { X: number; Y: number } | null = null;
    for (const q of pts) {
      const bad = !finite(q.X) || !finite(q.Y) || Math.abs(q.Y - (fr.yMin + fr.yMax) / 2) > limitY || Math.abs(q.X - (fr.xMin + fr.xMax) / 2) > limitX;
      const jump = prev && !bad && (Math.abs(q.Y - prev.Y) > R * 1.5 || Math.abs(q.X - prev.X) > RX * 1.5);
      if (bad || jump) {
        if (cur.length > 1) plot.lines.push(cur);
        cur = [];
      }
      if (!bad) cur.push(fr.toWorld(q.X, q.Y));
      prev = bad ? null : q;
    }
    if (cur.length > 1) plot.lines.push(cur);
  };
  switch (c.kind) {
    case 'function': {
      const n = Math.min(1600, Math.max(200, Math.round(fr.rect.width)));
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const X = fr.xMin + (RX * i) / n;
        return { X, Y: c.f(scope({ x: X })) };
      });
      push(pts, Infinity, R * 10);
      break;
    }
    case 'parametric':
    case 'polar': {
      const n = 1200;
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const t = tMin + ((tMax - tMin) * i) / n;
        if (c.kind === 'polar') {
          const r = c.f(scope({ t }));
          return { X: r * Math.cos(t), Y: r * Math.sin(t) };
        }
        return { X: c.f(scope({ t })), Y: c.g!(scope({ t })) };
      });
      push(pts, RX * 10, R * 10);
      break;
    }
    case 'implicit':
    case 'inequality': {
      const cols = 140;
      const rows = Math.max(30, Math.min(200, Math.round((cols * fr.rect.height) / fr.rect.width)));
      const dx = RX / cols;
      const dy = R / rows;
      const F = (i: number, j: number) => c.f(scope({ x: fr.xMin + i * dx, y: fr.yMin + j * dy }));
      const grid: number[][] = [];
      for (let i = 0; i <= cols; i++) {
        grid.push([]);
        for (let j = 0; j <= rows; j++) grid[i]!.push(F(i, j));
      }
      plot.segments = marchingSquares(grid, cols, rows, (i, j) => fr.toWorld(fr.xMin + i * dx, fr.yMin + j * dy));
      if (c.kind === 'inequality') {
        plot.dashedBoundary = c.relation === '<' || c.relation === '>';
        const holds = (v: number) => test(v, c.relation!);
        const cw = fr.rect.width / cols;
        const ch = fr.rect.height / rows;
        for (let j = 0; j < rows; j++) {
          // Подряд идущие ячейки строки — одним прямоугольником.
          let start = -1;
          for (let i = 0; i <= cols; i++) {
            const inside = i < cols && holds(c.f(scope({ x: fr.xMin + (i + 0.5) * dx, y: fr.yMin + (j + 0.5) * dy })));
            if (inside && start < 0) start = i;
            if (!inside && start >= 0) {
              plot.cells.push(fr.rect.x + start * cw, fr.rect.y + fr.rect.height - (j + 1) * ch, (i - start) * cw, ch);
              start = -1;
            }
          }
        }
      }
      break;
    }
  }
  // Подпись — у правого края видимой части линии.
  let best: Point | null = null;
  const inside = (p: Point) => p.x >= fr.rect.x && p.x <= fr.rect.x + fr.rect.width && p.y >= fr.rect.y && p.y <= fr.rect.y + fr.rect.height;
  for (const l of plot.lines) for (const p of l) if (inside(p) && (!best || p.x > best.x)) best = p;
  for (let k = 0; k < plot.segments.length; k += 2) {
    const p = { x: plot.segments[k]!, y: plot.segments[k + 1]! };
    if (inside(p) && (!best || p.x > best.x)) best = p;
  }
  plot.labelAt = best;
  return plot;
}

function test(v: number, r: Relation): boolean {
  if (!finite(v)) return false;
  switch (r) {
    case '<':
      return v < 0;
    case '<=':
      return v <= 0;
    case '>':
      return v > 0;
    case '>=':
      return v >= 0;
  }
}

/**
 * Изолиния F = 0 по сетке значений (marching squares) — отрезки
 * x1, y1, x2, y2 подряд в мировых координатах.
 */
export function marchingSquares(g: number[][], cols: number, rows: number, at: (i: number, j: number) => Point): number[] {
  const out: number[] = [];
  const lerp = (i1: number, j1: number, v1: number, i2: number, j2: number, v2: number): Point => {
    const t = v1 / (v1 - v2);
    const a = at(i1, j1);
    const b = at(i2, j2);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const v = [g[i]![j]!, g[i + 1]![j]!, g[i + 1]![j + 1]!, g[i]![j + 1]!];
      if (v.some((x) => !Number.isFinite(x))) continue;
      const corners: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const pts: Point[] = [];
      for (let k = 0; k < 4; k++) {
        const a = v[k]!;
        const b = v[(k + 1) % 4]!;
        if (a === 0 && b === 0) continue;
        if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) {
          const [i1, j1] = corners[k]!;
          const [i2, j2] = corners[(k + 1) % 4]!;
          pts.push(lerp(i1, j1, a, i2, j2, b));
        }
      }
      // Две или четыре точки пересечения сторон ячейки — один или два отрезка.
      for (let k = 0; k + 1 < pts.length; k += 2) out.push(pts[k]!.x, pts[k]!.y, pts[k + 1]!.x, pts[k + 1]!.y);
    }
  }
  return out;
}
