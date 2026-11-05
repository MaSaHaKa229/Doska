import type { Background, Point, SnapCurve, SnapPoint, SnapPointKind } from '@doska/shared';
import { effectiveStep, MIN_GRID_PX } from './background';

/**
 * Привязки (snapping).
 *
 * Порядок поиска для точки курсора p с допуском tol (мировые единицы):
 *  1) характерные точки объектов рядом с курсором (концы, вершины, центры,
 *     середины) и пересечения их кривых;
 *  2) узлы сетки фона страницы.
 * Побеждает ближайшая точка с учётом приоритета вида: конец/вершина/
 * пересечение важнее центра и середины, объекты важнее сетки. Если ничего
 * нет в пределах допуска — точка не меняется.
 */

export type SnapKind = SnapPointKind | 'grid';

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  refId?: string;
}

export const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: 'конец',
  midpoint: 'середина',
  center: 'центр',
  vertex: 'вершина',
  quadrant: 'квадрант',
  intersection: 'пересечение',
  anchor: 'точка',
  grid: 'сетка',
};

/** Штраф вида (в долях допуска): меньше — приоритетнее. */
const KIND_PENALTY: Record<SnapKind, number> = {
  endpoint: 0,
  vertex: 0,
  intersection: 0,
  anchor: 0,
  center: 0.15,
  midpoint: 0.15,
  quadrant: 0.25,
  grid: 0.5,
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------
//  Сетка
// ---------------------------------------------------------------------

/** Ближайший узел сетки фона (null — у фона нет узлов). */
export function gridSnap(p: Point, bg: Background, zoom: number): Point | null {
  switch (bg.kind) {
    case 'blank':
      return null;
    case 'grid':
    case 'dots': {
      const s = effectiveStep(bg.step, zoom);
      return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
    }
    case 'millimeter': {
      const mm = bg.step / 5;
      const s = mm * zoom >= MIN_GRID_PX / 2 ? mm : effectiveStep(mm * 10, zoom);
      return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
    }
    case 'ruled': {
      const s = effectiveStep(bg.step, zoom);
      return { x: p.x, y: Math.round(p.y / s) * s };
    }
    case 'polar': {
      const dx = p.x - bg.originX;
      const dy = p.y - bg.originY;
      const r = Math.round(Math.hypot(dx, dy) / bg.step) * bg.step;
      const step = Math.PI / 12; // 15°, как радиальные линии сетки
      const a = Math.round(Math.atan2(dy, dx) / step) * step;
      return { x: bg.originX + r * Math.cos(a), y: bg.originY + r * Math.sin(a) };
    }
    case 'isometric': {
      // Узлы треугольной решётки: (i·h, j·s + i·s/2), h = s·√3/2.
      const s = bg.step;
      const h = (s * Math.sqrt(3)) / 2;
      const i0 = Math.round(p.x / h);
      let best: Point = p;
      let bestD = Infinity;
      for (const i of [i0 - 1, i0, i0 + 1]) {
        const j = Math.round((p.y - (i * s) / 2) / s);
        const q = { x: i * h, y: j * s + (i * s) / 2 };
        const d = dist(p, q);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      return best;
    }
  }
}

// ---------------------------------------------------------------------
//  Пересечения кривых
// ---------------------------------------------------------------------

interface Ln {
  p: Point;
  d: Point;
  tMin: number;
  tMax: number;
}
interface Circ {
  c: Point;
  r: number;
  /** Дуга: допустимый диапазон углов (радианы), null — полная окружность. */
  arc: [number, number] | null;
}

function toPrimitives(c: SnapCurve): (Ln | Circ)[] {
  switch (c.kind) {
    case 'segment':
      return [{ p: c.a, d: { x: c.b.x - c.a.x, y: c.b.y - c.a.y }, tMin: 0, tMax: 1 }];
    case 'ray':
      return [{ p: c.origin, d: c.direction, tMin: 0, tMax: Infinity }];
    case 'line':
      return [{ p: c.point, d: c.direction, tMin: -Infinity, tMax: Infinity }];
    case 'circle':
      return [{ c: c.center, r: c.radius, arc: null }];
    case 'arc':
      return [{ c: c.center, r: c.radius, arc: [c.startAngle, c.endAngle] }];
    case 'polyline': {
      const out: Ln[] = [];
      const pts = c.closed ? [...c.points, c.points[0]!] : c.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        out.push({ p: a, d: { x: b.x - a.x, y: b.y - a.y }, tMin: 0, tMax: 1 });
      }
      return out;
    }
  }
}

const EPS = 1e-9;

function angleIn(a: number, [start, end]: [number, number]): boolean {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const s = norm(start);
  const e = norm(end);
  const v = norm(a);
  return s <= e ? v >= s - 1e-9 && v <= e + 1e-9 : v >= s - 1e-9 || v <= e + 1e-9;
}

function lineLine(a: Ln, b: Ln): Point[] {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < EPS) return [];
  const dx = b.p.x - a.p.x;
  const dy = b.p.y - a.p.y;
  const t = (dx * b.d.y - dy * b.d.x) / den;
  const u = (dx * a.d.y - dy * a.d.x) / den;
  const tol = 1e-9;
  if (t < a.tMin - tol || t > a.tMax + tol || u < b.tMin - tol || u > b.tMax + tol) return [];
  return [{ x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y }];
}

function lineCircle(l: Ln, c: Circ): Point[] {
  const fx = l.p.x - c.c.x;
  const fy = l.p.y - c.c.y;
  const A = l.d.x * l.d.x + l.d.y * l.d.y;
  if (A < EPS) return [];
  const B = 2 * (fx * l.d.x + fy * l.d.y);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const ts = disc <= EPS ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts
    .filter((t) => t >= l.tMin - 1e-9 && t <= l.tMax + 1e-9)
    .map((t) => ({ x: l.p.x + t * l.d.x, y: l.p.y + t * l.d.y }))
    .filter((p) => !c.arc || angleIn(Math.atan2(p.y - c.c.y, p.x - c.c.x), c.arc));
}

function circleCircle(a: Circ, b: Circ): Point[] {
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > a.r + b.r + EPS || d < Math.abs(a.r - b.r) - EPS) return [];
  const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - l * l));
  const mx = a.c.x + (l * dx) / d;
  const my = a.c.y + (l * dy) / d;
  const pts =
    h < EPS
      ? [{ x: mx, y: my }]
      : [
          { x: mx + (h * dy) / d, y: my - (h * dx) / d },
          { x: mx - (h * dy) / d, y: my + (h * dx) / d },
        ];
  return pts.filter(
    (p) =>
      (!a.arc || angleIn(Math.atan2(p.y - a.c.y, p.x - a.c.x), a.arc)) &&
      (!b.arc || angleIn(Math.atan2(p.y - b.c.y, p.x - b.c.x), b.arc)),
  );
}

/** Все точки пересечения двух кривых. */
export function intersectCurves(a: SnapCurve, b: SnapCurve): Point[] {
  const out: Point[] = [];
  for (const pa of toPrimitives(a)) {
    for (const pb of toPrimitives(b)) {
      if ('d' in pa && 'd' in pb) out.push(...lineLine(pa, pb));
      else if ('d' in pa && 'c' in pb) out.push(...lineCircle(pa, pb));
      else if ('c' in pa && 'd' in pb) out.push(...lineCircle(pb, pa));
      else out.push(...circleCircle(pa as Circ, pb as Circ));
    }
  }
  return out;
}

// ---------------------------------------------------------------------
//  Поиск привязки
// ---------------------------------------------------------------------

export interface ObjectSnapSource {
  id: string;
  points: SnapPoint[];
  curves: SnapCurve[];
}

/**
 * Лучшая привязка для точки p. sources — объекты рядом с курсором (их
 * характерные точки и кривые), grid — узел сетки или null.
 */
export function findSnap(p: Point, tol: number, sources: ObjectSnapSource[], grid: Point | null): SnapResult | null {
  let best: SnapResult | null = null;
  let bestScore = Infinity;
  const consider = (point: Point, kind: SnapKind, refId?: string) => {
    const d = dist(p, point);
    if (d > tol) return;
    const score = d + KIND_PENALTY[kind] * tol;
    if (score < bestScore) {
      bestScore = score;
      best = { point, kind, refId };
    }
  };
  for (const s of sources) for (const sp of s.points) consider(sp.point, sp.kind, sp.refId ?? s.id);
  // Пересечения кривых разных объектов и самопересечения не нужны;
  // ограничиваем число пар, чтобы не тормозить на плотных чертежах.
  const curves = sources.flatMap((s) => s.curves.map((c) => ({ id: s.id, c })));
  const limit = Math.min(curves.length, 60);
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      if (curves[i]!.id === curves[j]!.id) continue;
      for (const q of intersectCurves(curves[i]!.c, curves[j]!.c)) consider(q, 'intersection');
    }
  }
  if (grid) consider(grid, 'grid');
  return best;
}
