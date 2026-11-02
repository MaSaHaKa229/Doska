import type { Point, Rect } from '@doska/shared';

/** Вычислительная геометрия планиметрии (чистые функции, мировые координаты). */

export const EPS = 1e-9;

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const polar = (c: Point, r: number, angle: number): Point => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
export const angleOf = (c: Point, p: Point): number => Math.atan2(p.y - c.y, p.x - c.x);

/** Угол в [0, 2π). */
export function normAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Параметр t проекции точки p на прямую a→b (0 — a, 1 — b). */
export function projectT(p: Point, a: Point, b: Point): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  return l2 < EPS ? 0 : dot(sub(p, a), d) / l2;
}

/** Расстояние до отрезка, луча (из a через b) или прямой (через a и b). */
export function distToLinear(p: Point, a: Point, b: Point, kind: 'segment' | 'ray' | 'line'): number {
  if (dist(a, b) < EPS) return dist(p, a);
  let t = projectT(p, a, b);
  if (kind === 'segment') t = Math.min(1, Math.max(0, t));
  else if (kind === 'ray') t = Math.max(0, t);
  return dist(p, add(a, mul(sub(b, a), t)));
}

/** Расстояние до ломаной (замкнутой — многоугольника). */
export function distToPolyline(p: Point, pts: Point[], closed: boolean): number {
  if (pts.length === 1) return dist(p, pts[0]!);
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, distToLinear(p, pts[i]!, pts[(i + 1) % pts.length]!, 'segment'));
  return best;
}

/** Точка внутри многоугольника (правило чётности). */
export function insidePolygon(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Вершины правильного n-угольника на стороне a→b (против часовой стрелки на экране — слева от a→b). */
export function regularPolygon(a: Point, b: Point, n: number): Point[] {
  const out: Point[] = [a, b];
  const ext = (Math.PI * 2) / n;
  let dir = angleOf(a, b);
  const side = dist(a, b);
  let cur = b;
  for (let i = 2; i < n; i++) {
    // Экранная ось y направлена вниз: поворот «влево» — минус.
    dir -= ext;
    cur = polar(cur, side, dir);
    out.push(cur);
  }
  return out;
}

/**
 * Дуга окружности с центром c от луча c→a до луча c→b против часовой
 * стрелки на экране (в сторону уменьшения угла atan2 при оси y вниз).
 */
export interface ArcGeom {
  center: Point;
  radius: number;
  /** Начальный угол (рад, atan2) и угловой размах (> 0), обход — по уменьшению угла. */
  start: number;
  sweep: number;
}

export function arcGeom(c: Point, a: Point, b: Point): ArcGeom {
  const start = angleOf(c, a);
  const end = angleOf(c, b);
  let sweep = normAngle(start - end);
  if (sweep < EPS) sweep = Math.PI * 2;
  return { center: c, radius: dist(c, a), start, sweep };
}

/** Точки дуги для отрисовки ломаной (шаг ~3°). */
export function arcPoints(g: ArcGeom): Point[] {
  const steps = Math.max(2, Math.ceil(g.sweep / (Math.PI / 60)));
  return Array.from({ length: steps + 1 }, (_, i) => polar(g.center, g.radius, g.start - (g.sweep * i) / steps));
}

/** Угол точки лежит на дуге. */
export function angleOnArc(g: ArcGeom, angle: number): boolean {
  return normAngle(g.start - angle) <= g.sweep + 1e-9;
}

/** Расстояние до дуги. */
export function distToArc(p: Point, g: ArcGeom): number {
  if (angleOnArc(g, angleOf(g.center, p))) return Math.abs(dist(p, g.center) - g.radius);
  const s = polar(g.center, g.radius, g.start);
  const e = polar(g.center, g.radius, g.start - g.sweep);
  return Math.min(dist(p, s), dist(p, e));
}

/**
 * Эллипс: центр c, конец большой (первой) полуоси a, точка b задаёт вторую
 * полуось расстоянием до оси c→a.
 */
export interface EllipseGeom {
  center: Point;
  rx: number;
  ry: number;
  /** Поворот оси c→a (рад). */
  rotation: number;
}

export function ellipseGeom(c: Point, a: Point, b: Point): EllipseGeom {
  const rx = dist(c, a);
  const ry = rx < EPS ? 0 : Math.abs(cross(sub(a, c), sub(b, c))) / rx;
  return { center: c, rx, ry, rotation: angleOf(c, a) };
}

export function ellipsePoint(g: EllipseGeom, t: number): Point {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const x = g.rx * Math.cos(t);
  const y = g.ry * Math.sin(t);
  return { x: g.center.x + x * cos - y * sin, y: g.center.y + x * sin + y * cos };
}

export function ellipsePoints(g: EllipseGeom, steps = 96): Point[] {
  return Array.from({ length: steps }, (_, i) => ellipsePoint(g, (Math.PI * 2 * i) / steps));
}

/** Габарит набора точек с запасом pad. */
export function boundsOf(pts: Point[], pad = 0): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** Площадь многоугольника (по модулю). */
export function polygonArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i]!, pts[(i + 1) % pts.length]!);
  return Math.abs(s) / 2;
}
