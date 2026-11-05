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

// =====================================================================
//  6.1b: формы, пересечения, точки на кривых, преобразования
// =====================================================================

/** Форма фигуры, вычисленная по опорам. */
export type FigureShape =
  | { kind: 'linear'; a: Point; b: Point; mode: 'segment' | 'ray' | 'line' | 'vector' }
  | { kind: 'poly'; pts: Point[]; closed: boolean }
  | { kind: 'circle'; c: Point; r: number }
  | { kind: 'arc'; g: ArcGeom; mode: 'arc' | 'sector' | 'segment' }
  | { kind: 'ellipse'; g: EllipseGeom };

/** Геометрия объекта: точка или фигура. */
export type Geom = { kind: 'point'; p: Point } | FigureShape;

/** Простейшие куски кривой для пересечений. */
type Prim =
  | { kind: 'lin'; a: Point; b: Point; mode: 'segment' | 'ray' | 'line' }
  | { kind: 'circ'; c: Point; r: number; arc: ArcGeom | null };

function prims(s: FigureShape): Prim[] {
  switch (s.kind) {
    case 'linear':
      return [{ kind: 'lin', a: s.a, b: s.b, mode: s.mode === 'vector' ? 'segment' : s.mode }];
    case 'poly': {
      const out: Prim[] = [];
      const n = s.closed ? s.pts.length : s.pts.length - 1;
      for (let i = 0; i < n; i++) out.push({ kind: 'lin', a: s.pts[i]!, b: s.pts[(i + 1) % s.pts.length]!, mode: 'segment' });
      return out;
    }
    case 'circle':
      return [{ kind: 'circ', c: s.c, r: s.r, arc: null }];
    case 'arc': {
      const out: Prim[] = [{ kind: 'circ', c: s.g.center, r: s.g.radius, arc: s.g }];
      const a = polar(s.g.center, s.g.radius, s.g.start);
      const b = polar(s.g.center, s.g.radius, s.g.start - s.g.sweep);
      if (s.mode === 'sector') out.push({ kind: 'lin', a: s.g.center, b: a, mode: 'segment' }, { kind: 'lin', a: s.g.center, b, mode: 'segment' });
      if (s.mode === 'segment') out.push({ kind: 'lin', a, b, mode: 'segment' });
      return out;
    }
    case 'ellipse':
      // Эллипс — вписанной ломаной (пересечения приближённые, на глаз неотличимые).
      return prims({ kind: 'poly', pts: ellipsePoints(s.g, 180), closed: true });
  }
}

const inLin = (t: number, mode: 'segment' | 'ray' | 'line') => (mode === 'line' ? true : mode === 'ray' ? t >= -1e-9 : t >= -1e-9 && t <= 1 + 1e-9);
const onCirc = (q: Prim & { kind: 'circ' }, p: Point) => !q.arc || angleOnArc(q.arc, angleOf(q.c, p));

function intersectPrims(p: Prim, q: Prim): Point[] {
  if (p.kind === 'lin' && q.kind === 'lin') {
    const d1 = sub(p.b, p.a);
    const d2 = sub(q.b, q.a);
    const den = cross(d1, d2);
    if (Math.abs(den) < EPS) return [];
    const w = sub(q.a, p.a);
    const t = cross(w, d2) / den;
    const u = cross(w, d1) / den;
    return inLin(t, p.mode) && inLin(u, q.mode) ? [add(p.a, mul(d1, t))] : [];
  }
  if (p.kind === 'circ' && q.kind === 'lin') return intersectPrims(q, p);
  if (p.kind === 'lin' && q.kind === 'circ') {
    // Корни по возрастанию параметра вдоль прямой — порядок устойчив при движении.
    const d = sub(p.b, p.a);
    const f = sub(p.a, q.c);
    const A = dot(d, d);
    const B = 2 * dot(f, d);
    const C = dot(f, f) - q.r * q.r;
    const disc = B * B - 4 * A * C;
    if (A < EPS || disc < -1e-9) return [];
    const sq = Math.sqrt(Math.max(0, disc));
    const ts = disc < 1e-9 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    return ts.filter((t) => inLin(t, p.mode)).map((t) => add(p.a, mul(d, t))).filter((x) => onCirc(q, x));
  }
  if (p.kind === 'circ' && q.kind === 'circ') {
    const dd = dist(p.c, q.c);
    if (dd < EPS || dd > p.r + q.r + 1e-9 || dd < Math.abs(p.r - q.r) - 1e-9) return [];
    const a = (p.r * p.r - q.r * q.r + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const u = mul(sub(q.c, p.c), 1 / dd);
    const base = add(p.c, mul(u, a));
    const n = { x: -u.y, y: u.x };
    const pts = h < 1e-9 ? [base] : [add(base, mul(n, h)), sub(base, mul(n, h))];
    return pts.filter((x) => onCirc(p, x) && onCirc(q, x));
  }
  return [];
}

/** Точки пересечения двух фигур (порядок устойчив: по кускам первой, затем второй). */
export function intersections(s1: FigureShape, s2: FigureShape): Point[] {
  const out: Point[] = [];
  for (const p of prims(s1)) for (const q of prims(s2)) for (const x of intersectPrims(p, q)) if (!out.some((y) => dist(x, y) < 1e-6)) out.push(x);
  return out;
}

/** Ближайшая точка формы к p и её параметр (для точки на объекте). */
export function paramOf(s: FigureShape, p: Point): number {
  switch (s.kind) {
    case 'linear': {
      const t = projectT(p, s.a, s.b);
      return s.mode === 'segment' || s.mode === 'vector' ? Math.min(1, Math.max(0, t)) : s.mode === 'ray' ? Math.max(0, t) : t;
    }
    case 'circle':
      return normAngle(angleOf(s.c, p));
    case 'arc': {
      // Доля дуги 0..1 от начала.
      const off = normAngle(s.g.start - angleOf(s.g.center, p));
      if (off <= s.g.sweep) return off / s.g.sweep;
      return off - s.g.sweep < Math.PI * 2 - off ? 1 : 0;
    }
    case 'ellipse': {
      // Параметр эллипса по ближайшей точке ломаной.
      const pts = ellipsePoints(s.g, 360);
      let best = 0;
      pts.forEach((q, i) => {
        if (dist(q, p) < dist(pts[best]!, p)) best = i;
      });
      return (best / 360) * Math.PI * 2;
    }
    case 'poly': {
      // Номер стороны + доля стороны.
      const n = s.closed ? s.pts.length : s.pts.length - 1;
      let best = { d: Infinity, t: 0 };
      for (let i = 0; i < n; i++) {
        const a = s.pts[i]!;
        const b = s.pts[(i + 1) % s.pts.length]!;
        const t = Math.min(1, Math.max(0, projectT(p, a, b)));
        const d = dist(p, add(a, mul(sub(b, a), t)));
        if (d < best.d) best = { d, t: i + t };
      }
      return best.t;
    }
  }
}

/** Точка формы по параметру (обратное к paramOf). */
export function pointAt(s: FigureShape, t: number): Point {
  switch (s.kind) {
    case 'linear':
      return add(s.a, mul(sub(s.b, s.a), t));
    case 'circle':
      return polar(s.c, s.r, t);
    case 'arc':
      return polar(s.g.center, s.g.radius, s.g.start - s.g.sweep * Math.min(1, Math.max(0, t)));
    case 'ellipse':
      return ellipsePoint(s.g, t);
    case 'poly': {
      const n = s.closed ? s.pts.length : s.pts.length - 1;
      const i = Math.min(n - 1, Math.max(0, Math.floor(t)));
      const a = s.pts[i]!;
      const b = s.pts[(i + 1) % s.pts.length]!;
      return add(a, mul(sub(b, a), Math.min(1, Math.max(0, t - i))));
    }
  }
}

/** Преобразование плоскости (подобие): образ точки, меняет ли ориентацию, коэффициент. */
export interface Xform {
  map(p: Point): Point;
  flips: boolean;
  k: number;
}

export function reflectLine(a: Point, b: Point): Xform {
  return {
    map: (p) => {
      const f = add(a, mul(sub(b, a), projectT(p, a, b)));
      return sub(mul(f, 2), p);
    },
    flips: true,
    k: 1,
  };
}

export const reflectPoint = (c: Point): Xform => ({ map: (p) => sub(mul(c, 2), p), flips: false, k: 1 });

/** Поворот на угол (градусы, против часовой стрелки на экране). */
export function rotate(c: Point, deg: number): Xform {
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { map: (p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }), flips: false, k: 1 };
}

export const translate = (v: Point): Xform => ({ map: (p) => add(p, v), flips: false, k: 1 });

export const homothety = (c: Point, k: number): Xform => ({ map: (p) => add(c, mul(sub(p, c), k)), flips: false, k: Math.abs(k) });

/** Образ формы: через образы определяющих точек. */
export function transformShape(s: FigureShape, x: Xform): FigureShape {
  switch (s.kind) {
    case 'linear':
      return { ...s, a: x.map(s.a), b: x.map(s.b) };
    case 'poly':
      return { ...s, pts: s.pts.map(x.map) };
    case 'circle':
      return { kind: 'circle', c: x.map(s.c), r: s.r * x.k };
    case 'arc': {
      const c = x.map(s.g.center);
      const a = x.map(polar(s.g.center, s.g.radius, s.g.start));
      const b = x.map(polar(s.g.center, s.g.radius, s.g.start - s.g.sweep));
      // Отражение меняет направление обхода: начало и конец меняются местами.
      return { ...s, g: x.flips ? arcGeom(c, b, a) : arcGeom(c, a, b) };
    }
    case 'ellipse':
      return { kind: 'ellipse', g: ellipseGeom(x.map(s.g.center), x.map(ellipsePoint(s.g, 0)), x.map(ellipsePoint(s.g, Math.PI / 2))) };
  }
}

export function transformGeom(g: Geom, x: Xform): Geom {
  return g.kind === 'point' ? { kind: 'point', p: x.map(g.p) } : transformShape(g, x);
}

// ---------------------------------------------------------------------
//  Треугольник: замечательные точки
// ---------------------------------------------------------------------

export const centroid = (a: Point, b: Point, c: Point): Point => ({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });

export function circumcenter(a: Point, b: Point, c: Point): Point | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < EPS) return null;
  const a2 = dot(a, a);
  const b2 = dot(b, b);
  const c2 = dot(c, c);
  return { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
}

export function incenter(a: Point, b: Point, c: Point): { c: Point; r: number } | null {
  const la = dist(b, c);
  const lb = dist(a, c);
  const lc = dist(a, b);
  const p = la + lb + lc;
  if (p < EPS) return null;
  const center = { x: (la * a.x + lb * b.x + lc * c.x) / p, y: (la * a.y + lb * b.y + lc * c.y) / p };
  const area = Math.abs(cross(sub(b, a), sub(c, a))) / 2;
  if (area < EPS) return null;
  return { c: center, r: (2 * area) / p };
}

export function orthocenter(a: Point, b: Point, c: Point): Point | null {
  const o = circumcenter(a, b, c);
  // H = A + B + C − 2O.
  return o ? { x: a.x + b.x + c.x - 2 * o.x, y: a.y + b.y + c.y - 2 * o.y } : null;
}

/** Основание перпендикуляра из p на прямую ab. */
export const foot = (p: Point, a: Point, b: Point): Point => add(a, mul(sub(b, a), projectT(p, a, b)));

/** Угол ABC (вершина b) в градусах, 0..180. */
export function angleDeg(a: Point, b: Point, c: Point): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const l = len(u) * len(v);
  if (l < EPS) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * 180) / Math.PI;
}
