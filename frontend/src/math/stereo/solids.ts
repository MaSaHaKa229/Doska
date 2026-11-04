import { z } from 'zod';

/**
 * Геометрия стереометрии (этап 6.4a): тела, проекция и чертёж «как в
 * учебнике». Всё — чистые функции без Konva и three.js: их используют
 * отрисовка на доске, SVG-экспорт, 3D-редактор и тесты.
 *
 * Система координат сцены — правая, ось z вверх (как в задачниках).
 * Проекция параллельная (ортогональная): вид задаётся азимутом yaw и
 * высотой pitch направления на зрителя.
 */

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// =====================================================================
//  Тела
// =====================================================================

export const BODY_KINDS = ['cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'tcone', 'sphere'] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

export const BODY_TITLES: Record<BodyKind, string> = {
  cube: 'Куб',
  box: 'Прямоугольный параллелепипед',
  prism: 'Призма',
  pyramid: 'Пирамида',
  frustum: 'Усечённая пирамида',
  cylinder: 'Цилиндр',
  cone: 'Конус',
  tcone: 'Усечённый конус',
  sphere: 'Шар',
};

export const ROUND_KINDS: readonly BodyKind[] = ['cylinder', 'cone', 'tcone', 'sphere'];
/** Тела с многоугольником в основании (правильным или заданным вершинами). */
export const POLY_BASE_KINDS: readonly BodyKind[] = ['prism', 'pyramid', 'frustum'];

const size = z.number().finite().min(0.05).max(1000);
const coord = z.number().finite().min(-1e4).max(1e4);

export const bodySchema = z.object({
  id: z.string().min(1).max(16),
  kind: z.enum(BODY_KINDS),
  /** Ребро куба; длина параллелепипеда (по x). */
  a: size,
  /** Ширина параллелепипеда (по y). */
  b: size,
  /** Высота (у параллелепипеда — третье измерение). */
  h: size,
  /** Число сторон правильного основания. */
  n: z.number().int().min(3).max(12),
  /** Радиус описанной окружности основания; радиус цилиндра, конуса, шара. */
  r: size,
  /** Радиус верхнего основания усечённого конуса. */
  r2: size,
  /** Усечённая пирамида: отношение верхнего основания к нижнему. */
  k: z.number().finite().min(0.05).max(0.95),
  /** Своё основание (вершины на плоскости z = 0, выпуклое); пусто — правильный n-угольник. */
  base: z.array(z.tuple([coord, coord])).max(12),
  /** Сдвиг верхнего основания призмы или вершины пирамиды (наклонные тела). */
  shift: z.tuple([coord, coord]),
  /** Положение тела (центр нижнего основания; у шара — центр). */
  pos: z.tuple([coord, coord, coord]),
  fill: z.string().max(32),
  /** Непрозрачность граней 0…1. */
  opacity: z.number().finite().min(0).max(1),
  edge: z.string().max(32),
  /** Свои подписи вершин через запятую (пустая позиция — подпись по умолчанию). */
  labels: z.string().max(200),
  showLabels: z.boolean(),
  /** Ось и центры оснований (у шара — центр). */
  axis: z.boolean(),
});
export type Body = z.infer<typeof bodySchema>;

const BASE_DEFAULTS: Omit<Body, 'id' | 'kind'> = {
  a: 4,
  b: 3,
  h: 4,
  n: 4,
  r: 2.5,
  r2: 1.2,
  k: 0.5,
  base: [],
  shift: [0, 0],
  pos: [0, 0, 0],
  fill: 'accent-2',
  opacity: 0.12,
  edge: 'ink',
  labels: '',
  showLabels: true,
  axis: false,
};

/** Тело «как в учебнике» по умолчанию. */
export function newBody(kind: BodyKind, id: string): Body {
  const b: Body = { ...BASE_DEFAULTS, id, kind, base: [], shift: [0, 0], pos: [0, 0, 0] };
  switch (kind) {
    case 'cube':
      return { ...b, a: 4 };
    case 'box':
      return { ...b, a: 5, b: 3, h: 3 };
    case 'prism':
      return { ...b, n: 3, r: 2.5, h: 4 };
    case 'pyramid':
      return { ...b, n: 4, r: 2.8, h: 4 };
    case 'frustum':
      return { ...b, n: 4, r: 3, h: 3, k: 0.5 };
    case 'cylinder':
      return { ...b, r: 2, h: 4, axis: true };
    case 'cone':
      return { ...b, r: 2, h: 4, axis: true };
    case 'tcone':
      return { ...b, r: 2.5, r2: 1.2, h: 3, axis: true };
    case 'sphere':
      return { ...b, r: 2.5, axis: true, pos: [0, 0, 2.5] };
  }
}

// ---------------------------------------------------------------------
//  Многоугольник основания
// ---------------------------------------------------------------------

type P2 = [number, number];

const area2 = (pts: P2[]) =>
  pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

/** Многоугольник выпуклый (без самопересечений и вырожденных вершин)? */
export function isConvex(pts: readonly P2[]): boolean {
  if (pts.length < 3) return false;
  let sign = 0;
  let turn = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = pts[(i + 2) % pts.length]!;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) return false;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
    turn += Math.atan2(cr, (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
  }
  // Сумма внешних углов выпуклого многоугольника — ровно один оборот.
  return Math.abs(Math.abs(turn) - 2 * Math.PI) < 1e-6;
}

/** Основание тела против часовой стрелки (вид сверху), с центром масс вершин в (0, 0) у правильного. */
export function basePolygon(b: Body): P2[] {
  if (b.kind === 'cube')
    return [
      [-b.a / 2, -b.a / 2],
      [b.a / 2, -b.a / 2],
      [b.a / 2, b.a / 2],
      [-b.a / 2, b.a / 2],
    ];
  if (b.kind === 'box')
    return [
      [-b.a / 2, -b.b / 2],
      [b.a / 2, -b.b / 2],
      [b.a / 2, b.b / 2],
      [-b.a / 2, b.b / 2],
    ];
  if (b.base.length >= 3) {
    const pts = b.base.map((p) => [p[0], p[1]] as P2);
    return area2(pts) < 0 ? pts.reverse() : pts;
  }
  // Первое ребро AB — ближнее к зрителю и горизонтальное (как в учебнике).
  const start = -Math.PI / 2 - Math.PI / b.n;
  return Array.from({ length: b.n }, (_, i) => {
    const t = start + (i * 2 * Math.PI) / b.n;
    return [b.r * Math.cos(t), b.r * Math.sin(t)] as P2;
  });
}

const centroid2 = (pts: P2[]): P2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

// ---------------------------------------------------------------------
//  Многогранник: вершины, грани, рёбра
// ---------------------------------------------------------------------

export interface Polyhedron {
  verts: V3[];
  /** Грани — индексы вершин против часовой стрелки при взгляде снаружи. */
  faces: number[][];
  edges: [number, number][];
  /** Подписи вершин по умолчанию. */
  names: string[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N'];

export function isPolyhedron(kind: BodyKind): boolean {
  return !ROUND_KINDS.includes(kind);
}

export function polyhedron(b: Body): Polyhedron {
  const base = basePolygon(b);
  const n = base.length;
  const [px, py, pz] = b.pos;
  const bottom: V3[] = base.map((p) => [p[0] + px, p[1] + py, pz]);
  const c = centroid2(base);
  const names = LETTERS.slice(0, n);
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  const bottomFace = Array.from({ length: n }, (_, i) => n - 1 - i);
  if (b.kind === 'pyramid') {
    const apex: V3 = [c[0] + b.shift[0] + px, c[1] + b.shift[1] + py, pz + b.h];
    const faces = [bottomFace, ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n])];
    for (let i = 0; i < n; i++) edges.push([i, n]);
    return { verts: [...bottom, apex], faces, edges, names: [...names, 'S'] };
  }
  const top: V3[] =
    b.kind === 'frustum'
      ? base.map((p) => [c[0] + b.shift[0] + b.k * (p[0] - c[0]) + px, c[1] + b.shift[1] + b.k * (p[1] - c[1]) + py, pz + b.h])
      : base.map((p) => [p[0] + (b.kind === 'prism' ? b.shift[0] : 0) + px, p[1] + (b.kind === 'prism' ? b.shift[1] : 0) + py, pz + (b.kind === 'cube' ? b.a : b.h)]);
  const faces = [bottomFace, Array.from({ length: n }, (_, i) => n + i), ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])];
  for (let i = 0; i < n; i++) edges.push([n + i, n + ((i + 1) % n)], [i, n + i]);
  return { verts: [...bottom, ...top], faces, edges, names: [...names, ...names.map((l) => `${l}₁`)] };
}

/** Подписи вершин с учётом своих (через запятую). */
export function labelsOf(b: Body, defaults: string[]): string[] {
  const own = b.labels.split(',').map((s) => s.trim());
  return defaults.map((d, i) => (own[i] ? own[i]!.slice(0, 8) : d));
}

// ---------------------------------------------------------------------
//  Тела вращения
// ---------------------------------------------------------------------

/** Радиусы оснований и высота тела вращения (у шара — радиус). */
function roundDims(b: Body): { r1: number; r2: number; h: number } {
  if (b.kind === 'cylinder') return { r1: b.r, r2: b.r, h: b.h };
  if (b.kind === 'cone') return { r1: b.r, r2: 0, h: b.h };
  return { r1: b.r, r2: b.r2, h: b.h };
}

/** Точки тела для габарита (вершины многогранника или опорные точки тела вращения). */
export function bodyPoints(b: Body): V3[] {
  if (isPolyhedron(b.kind)) return polyhedron(b).verts;
  const [px, py, pz] = b.pos;
  if (b.kind === 'sphere') {
    const r = b.r;
    return [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => [px + sx * r, py + sy * r, pz + sz * r] as V3)));
  }
  const { r1, r2, h } = roundDims(b);
  const ring = (r: number, z: number): V3[] =>
    [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ].map(([x, y]) => [px + x!, py + y!, pz + z] as V3);
  return [...ring(r1, 0), ...(r2 > 0 ? ring(r2, h) : [[px, py, pz + h] as V3])];
}

// =====================================================================
//  Вид и проекция
// =====================================================================

export interface View {
  /** Азимут направления на зрителя, рад (0 — с оси x, против часовой). */
  yaw: number;
  /** Высота направления на зрителя над плоскостью xy, рад. */
  pitch: number;
  /** Пикселей доски на единицу длины. */
  scale: number;
}

export interface Projection {
  /** Направление на зрителя. */
  d: V3;
  /** Орты экрана: вправо и вверх. */
  e1: V3;
  e2: V3;
  center: V3;
  scale: number;
  /** Точка сцены → локальные координаты чертежа (y вниз, центр сцены — в (0, 0)). */
  project(p: V3): { x: number; y: number };
}

export function viewDir(yaw: number, pitch: number): V3 {
  return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
}

/** Центр сцены — середина габарита всех тел (не зависит от вида). */
export function sceneCenter(bodies: readonly Body[]): V3 {
  const pts = bodies.flatMap(bodyPoints);
  if (!pts.length) return [0, 0, 0];
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p[i]!);
      hi[i] = Math.max(hi[i]!, p[i]!);
    }
  return mul(add(lo, hi), 0.5);
}

export function projection(view: View, center: V3): Projection {
  const d = viewDir(view.yaw, view.pitch);
  // Как у камеры three.js с up = z: вправо — z × d, вверх — d × вправо.
  let e1 = cross([0, 0, 1], d);
  if (Math.hypot(...e1) < 1e-9) e1 = [-Math.sin(view.yaw), Math.cos(view.yaw), 0];
  e1 = norm(e1);
  const e2 = norm(cross(d, e1));
  return {
    d,
    e1,
    e2,
    center,
    scale: view.scale,
    project(p) {
      const q = sub(p, center);
      return { x: dot(q, e1) * view.scale, y: -dot(q, e2) * view.scale };
    },
  };
}

// =====================================================================
//  Видимость: луч от точки к зрителю через «уменьшенное» тело
// =====================================================================

/** Отрезок параметра t, на котором луч p + t·d внутри тела (null — не пересекает). */
type Occluder = (p: V3, d: V3) => [number, number] | null;

function clipSlab(p: number, d: number, lo: number, hi: number, iv: [number, number]): [number, number] | null {
  if (Math.abs(d) < 1e-12) return p > lo && p < hi ? iv : null;
  let t0 = (lo - p) / d;
  let t1 = (hi - p) / d;
  if (t0 > t1) [t0, t1] = [t1, t0];
  const a = Math.max(iv[0], t0);
  const b = Math.min(iv[1], t1);
  return a < b ? [a, b] : null;
}

/** Выпуклый многогранник как пересечение полупространств, сжатый на eps. */
function polyOccluder(ph: Polyhedron, eps: number): Occluder {
  const c = mul(
    ph.verts.reduce((s, v) => add(s, v), [0, 0, 0] as V3),
    1 / ph.verts.length,
  );
  const planes = ph.faces.map((f) => {
    const a = ph.verts[f[0]!]!;
    let n = norm(cross(sub(ph.verts[f[1]!]!, a), sub(ph.verts[f[2]!]!, a)));
    if (dot(n, sub(c, a)) > 0) n = mul(n, -1);
    return { n, off: dot(n, a) - eps };
  });
  return (p, d) => {
    let iv: [number, number] = [-Infinity, Infinity];
    for (const { n, off } of planes) {
      const pn = dot(n, p) - off;
      const dn = dot(n, d);
      if (Math.abs(dn) < 1e-12) {
        if (pn >= 0) return null;
        continue;
      }
      const t = -pn / dn;
      if (dn > 0) iv = [iv[0], Math.min(iv[1], t)];
      else iv = [Math.max(iv[0], t), iv[1]];
      if (iv[0] >= iv[1]) return null;
    }
    return iv;
  };
}

/** Усечённый конус (цилиндр, конус) с осью z от pos, сжатый на eps. */
function roundOccluder(b: Body, eps: number): Occluder {
  const { r1, r2, h } = roundDims(b);
  const [px, py, pz] = b.pos;
  const k = (r2 - r1) / h;
  return (p0, d) => {
    const p: V3 = [p0[0] - px, p0[1] - py, p0[2] - pz];
    const slab = clipSlab(p[2], d[2], eps, h - eps, [-Infinity, Infinity]);
    if (!slab) return null;
    // x² + y² ≤ (r1 + k·z − eps)², z на отрезке оси: f(t) = A t² + B t + C ≤ 0.
    const r0 = r1 - eps + k * p[2];
    const A = d[0] * d[0] + d[1] * d[1] - k * k * d[2] * d[2];
    const B = 2 * (p[0] * d[0] + p[1] * d[1] - r0 * k * d[2]);
    const C = p[0] * p[0] + p[1] * p[1] - r0 * r0;
    const f = (t: number) => (A * t + B) * t + C;
    const cand = [slab[0], slab[1]];
    const disc = B * B - 4 * A * C;
    if (Math.abs(A) > 1e-12 && disc > 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t > slab[0] && t < slab[1]) cand.push(t);
    } else if (Math.abs(A) <= 1e-12 && Math.abs(B) > 1e-12) {
      const t = -C / B;
      if (t > slab[0] && t < slab[1]) cand.push(t);
    }
    cand.sort((x, y) => x - y);
    // Тело выпукло — подходящие куски идут подряд.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i + 1 < cand.length; i++) {
      const a = cand[i]!;
      const bb = cand[i + 1]!;
      const m = Number.isFinite(a) && Number.isFinite(bb) ? (a + bb) / 2 : Number.isFinite(a) ? a + 1 : Number.isFinite(bb) ? bb - 1 : 0;
      // Внутри «двойного конуса» по другую сторону вершины: r(z) < 0.
      if (f(m) < 0 && r0 + k * d[2] * m > 0) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, bb);
      }
    }
    return lo < hi ? [lo, hi] : null;
  };
}

function sphereOccluder(b: Body, eps: number): Occluder {
  const r = b.r - eps;
  return (p0, d) => {
    const p = sub(p0, b.pos as V3);
    const B = dot(p, d);
    const C = dot(p, p) - r * r;
    const disc = B * B - C;
    if (disc <= 0) return null;
    const s = Math.sqrt(disc);
    return [-B - s, -B + s];
  };
}

function occluderOf(b: Body, eps: number): Occluder {
  if (b.kind === 'sphere') return sphereOccluder(b, eps);
  if (isPolyhedron(b.kind)) return polyOccluder(polyhedron(b), eps);
  return roundOccluder(b, eps);
}

// =====================================================================
//  Чертёж
// =====================================================================

export type HiddenMode = 'dashed' | 'hide' | 'solid';

export interface DrawLine {
  /** Плоские координаты [x0, y0, x1, y1, …]. */
  pts: number[];
  hidden: boolean;
  color: string;
  /** Линия измерения (общий перпендикуляр, расстояние) — толще. */
  accent?: boolean;
}

export interface DrawFill {
  pts: number[];
  color: string;
  opacity: number;
}

export interface DrawLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  /** Подпись невидимой вершины. */
  hidden: boolean;
  /** Значение (расстояние, угол): прямым шрифтом, а не курсивом, как имя точки. */
  value?: boolean;
}

/**
 * Дополнительный слой чертежа — построения в пространстве (6.4b): линии с
 * той же проверкой видимости, заливки (сечения, плоскости), точки с
 * подписями и значения измерений. Координаты — точки сцены.
 */
export interface ExtraLayer {
  /** Ломаные; tol — допуск видимости (линия на приближённой поверхности тела вращения). */
  lines: { pts: V3[]; color: string; tol?: number; accent?: boolean }[];
  fills: { pts: V3[]; color: string; opacity: number }[];
  points: { p: V3; name: string; color: string }[];
  values: { p: V3; text: string; color: string }[];
}

export interface Drawing {
  fills: DrawFill[];
  lines: DrawLine[];
  labels: DrawLabel[];
  /** Точки (центры оснований, центр шара). */
  dots: { x: number; y: number; color: string }[];
  /** Габарит чертежа без подписей (локальные координаты). */
  bounds: { x: number; y: number; width: number; height: number };
}

/** 3D-линия чертежа: отрезок или точная кривая (окружность), параметр t ∈ [0, 1]. */
interface Feature {
  at(t: number): V3;
  /** Кривая: выводится ломаной по всем точкам выборки. */
  curve: boolean;
  color: string;
  /** Допуск видимости: точки чуть внутри тела (хорды приближённой поверхности) не считаются закрытыми. */
  tol?: number;
  accent?: boolean;
}

const RING = 72;

const segment = (a: V3, b: V3, color: string): Feature => ({ at: (t) => lerp(a, b, t), curve: false, color });

function circleAt(c: V3, u: V3, v: V3, r: number): (t: number) => V3 {
  return (t) => {
    const a = t * 2 * Math.PI;
    return add(c, add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a))));
  };
}

function circle(c: V3, u: V3, v: V3, r: number, n = RING): V3[] {
  const at = circleAt(c, u, v, r);
  return Array.from({ length: n + 1 }, (_, i) => at(i / n));
}

const circleFeature = (c: V3, u: V3, v: V3, r: number, color: string): Feature => ({ at: circleAt(c, u, v, r), curve: true, color });

/** Точки линии для габаритов. */
const featurePoints = (f: Feature): V3[] => (f.curve ? Array.from({ length: RING + 1 }, (_, i) => f.at(i / RING)) : [f.at(0), f.at(1)]);

/** Образующие-очертания тела вращения при взгляде по d. */
export function silhouetteAngles(b: Body, d: V3): number[] {
  const { r1, r2, h } = roundDims(b);
  const rho = Math.hypot(d[0], d[1]);
  if (rho < 1e-9) return [];
  const alpha = Math.atan2(d[1], d[0]);
  // Нормаль боковой поверхности ∝ (cos φ, sin φ, (r1 − r2)/h): n·d = 0.
  const c = (-d[2] * (r1 - r2)) / h / rho;
  if (Math.abs(c) >= 1) return [];
  const delta = Math.acos(c);
  return [alpha + delta, alpha - delta];
}

/** Линии тела (рёбра, окружности оснований, очертания) — без учёта видимости. */
function features(b: Body, proj: Projection): Feature[] {
  const color = b.edge;
  if (isPolyhedron(b.kind)) {
    const ph = polyhedron(b);
    return ph.edges.map(([i, j]) => segment(ph.verts[i]!, ph.verts[j]!, color));
  }
  const pos = b.pos as V3;
  if (b.kind === 'sphere') {
    // Очертание — окружность в плоскости экрана; экватор.
    return [circleFeature(pos, proj.e1, proj.e2, b.r, color), circleFeature(pos, [1, 0, 0], [0, 1, 0], b.r, color)];
  }
  const { r1, r2, h } = roundDims(b);
  const top: V3 = add(pos, [0, 0, h]);
  const out: Feature[] = [circleFeature(pos, [1, 0, 0], [0, 1, 0], r1, color)];
  if (r2 > 0) out.push(circleFeature(top, [1, 0, 0], [0, 1, 0], r2, color));
  for (const phi of silhouetteAngles(b, proj.d)) {
    const u: V3 = [Math.cos(phi), Math.sin(phi), 0];
    out.push(segment(add(pos, mul(u, r1)), add(top, mul(u, r2)), color));
  }
  return out;
}

/** Внутренние линии (ось, радиус шара) — по видимости тоже делятся. */
function axisFeatures(b: Body): Feature[] {
  if (!b.axis || isPolyhedron(b.kind)) return [];
  if (b.kind === 'sphere') return [];
  const pos = b.pos as V3;
  return [segment(pos, add(pos, [0, 0, b.h]), b.edge)];
}

/** Центры с подписями (O, O₁; у конуса — вершина S). */
function roundMarks(b: Body): { p: V3; name: string; dot: boolean }[] {
  const pos = b.pos as V3;
  if (b.kind === 'sphere') return b.axis ? [{ p: pos, name: 'O', dot: true }] : [];
  const top = add(pos, [0, 0, b.h]);
  if (b.kind === 'cone') return [{ p: top, name: 'S', dot: false }, ...(b.axis ? [{ p: pos, name: 'O', dot: true }] : [])];
  return b.axis
    ? [
        { p: pos, name: 'O', dot: true },
        { p: top, name: 'O₁', dot: true },
      ]
    : [];
}

function hull2(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cr(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cr(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Масштаб тела для допусков (eps видимости). */
function bodyExtent(bodies: readonly Body[]): number {
  const pts = bodies.flatMap(bodyPoints);
  let m = 1;
  for (const p of pts) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  return m;
}

/**
 * Чертёж сцены: грани (полупрозрачная заливка видимых граней), линии с
 * делением на видимые и невидимые куски, подписи вершин.
 */
export function drawScene(bodies: readonly Body[], view: View, hidden: HiddenMode = 'dashed', labelGap = 12, extra?: ExtraLayer): Drawing {
  const proj = projection(view, sceneCenter(bodies));
  const eps = bodyExtent(bodies) * 1e-6;
  const occluders = bodies.map((b) => occluderOf(b, eps));
  const visible = (p: V3, tol = 0) => {
    for (const occ of occluders) {
      const iv = occ(p, proj.d);
      if (iv && iv[1] > Math.max(iv[0], 0) + eps + tol) return false;
    }
    return true;
  };

  const lines: DrawLine[] = [];
  const pushRun = (pts: V3[], isHidden: boolean, color: string, accent?: boolean) => {
    if (pts.length < 2) return;
    if (isHidden && hidden === 'hide') return;
    const flat = pts.flatMap((p) => {
      const q = proj.project(p);
      return [q.x, q.y];
    });
    const last = lines[lines.length - 1];
    // Продолжение предыдущего куска того же вида — одна ломаная.
    if (
      last &&
      last.hidden === (isHidden && hidden === 'dashed') &&
      last.color === color &&
      !!last.accent === !!accent &&
      last.pts[last.pts.length - 2] === flat[0] &&
      last.pts[last.pts.length - 1] === flat[1]
    ) {
      last.pts.push(...flat.slice(2));
      return;
    }
    lines.push({ pts: flat, hidden: isHidden && hidden === 'dashed', color, ...(accent ? { accent } : {}) });
  };

  /** Делит линию на видимые и невидимые куски (выборка и уточнение границы делением пополам). */
  const splitLine = (f: Feature) => {
    const p0 = proj.project(f.at(0));
    const p1 = proj.project(f.at(f.curve ? 0.5 : 1));
    const n = f.curve ? 4 * RING : Math.max(2, Math.min(64, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 6)));
    // Концы отрезка проверяются чуть внутри: вершина лежит сразу на нескольких гранях.
    const probe = (t: number) => visible(f.at(f.curve ? t : Math.min(1 - 1e-4, Math.max(1e-4, t))), f.tol);
    let prevVis = probe(0);
    let run: V3[] = [f.at(0)];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const vis = probe(t);
      if (vis !== prevVis) {
        let lo = (i - 1) / n;
        let hi = t;
        for (let k = 0; k < 16; k++) {
          const mid = (lo + hi) / 2;
          if (probe(mid) === prevVis) lo = mid;
          else hi = mid;
        }
        const cut = f.at((lo + hi) / 2);
        run.push(cut);
        pushRun(run, !prevVis, f.color, f.accent);
        run = [cut];
        prevVis = vis;
      }
      if (f.curve || i === n) run.push(f.at(t));
    }
    pushRun(run, !prevVis, f.color, f.accent);
  };

  const fills: { fill: DrawFill; depth: number }[] = [];
  const labels: DrawLabel[] = [];
  const dots: Drawing['dots'] = [];
  const lo = { x: Infinity, y: Infinity };
  const hi = { x: -Infinity, y: -Infinity };
  const grow = (x: number, y: number) => {
    lo.x = Math.min(lo.x, x);
    lo.y = Math.min(lo.y, y);
    hi.x = Math.max(hi.x, x);
    hi.y = Math.max(hi.y, y);
  };

  for (const b of bodies) {
    const fs = [...features(b, proj), ...axisFeatures(b)];
    fs.forEach(splitLine);
    for (const f of fs)
      for (const p of featurePoints(f)) {
        const q = proj.project(p);
        grow(q.x, q.y);
      }
    const centerDepth = dot(sceneCenterOf(b), proj.d);

    // Заливка видимых граней.
    if (b.opacity > 0) {
      if (isPolyhedron(b.kind)) {
        const ph = polyhedron(b);
        const c = mul(
          ph.verts.reduce((s, v) => add(s, v), [0, 0, 0] as V3),
          1 / ph.verts.length,
        );
        for (const f of ph.faces) {
          const a = ph.verts[f[0]!]!;
          let n = cross(sub(ph.verts[f[1]!]!, a), sub(ph.verts[f[2]!]!, a));
          if (dot(n, sub(c, a)) > 0) n = mul(n, -1);
          if (dot(n, proj.d) <= 1e-9) continue;
          fills.push({ fill: { pts: f.flatMap((i) => Object.values(proj.project(ph.verts[i]!))), color: b.fill, opacity: b.opacity }, depth: centerDepth });
        }
      } else {
        const outline =
          b.kind === 'sphere'
            ? circle(b.pos as V3, proj.e1, proj.e2, b.r, 64)
            : features(b, proj)
                .slice(0, 2)
                .flatMap(featurePoints)
                .concat(b.kind === 'cone' ? [add(b.pos as V3, [0, 0, b.h])] : []);
        const h = hull2(outline.map((p) => proj.project(p)));
        fills.push({ fill: { pts: h.flatMap((q) => [q.x, q.y]), color: b.fill, opacity: b.opacity }, depth: centerDepth });
      }
    }

    // Подписи: вершины многогранника, центры и вершина конуса.
    if (b.showLabels) {
      const marks: { p: V3; name: string; dot: boolean }[] = isPolyhedron(b.kind)
        ? (() => {
            const ph = polyhedron(b);
            return ph.verts.map((p, i) => ({ p, name: ph.names[i]!, dot: false }));
          })()
        : roundMarks(b);
      const names = labelsOf(
        b,
        marks.map((m) => m.name),
      );
      const c2 = proj.project(sceneCenterOf(b));
      marks.forEach((m, i) => {
        const q = proj.project(m.p);
        let dx = q.x - c2.x;
        let dy = q.y - c2.y;
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) [dx, dy] = [0.7, 0.7];
        else [dx, dy] = [dx / l, dy / l];
        labels.push({ x: q.x + dx * labelGap, y: q.y + dy * labelGap, text: names[i]!, color: b.edge, hidden: !visible(m.p) });
        if (m.dot) dots.push({ x: q.x, y: q.y, color: b.edge });
      });
    } else {
      for (const m of roundMarks(b))
        if (m.dot) {
          const q = proj.project(m.p);
          dots.push({ x: q.x, y: q.y, color: b.edge });
        }
    }
  }

  fills.sort((a, b) => a.depth - b.depth);

  // Построения: поверх тел, заливки — после граней.
  const extraFills: DrawFill[] = [];
  if (extra) {
    for (const f of extra.fills) extraFills.push({ pts: f.pts.flatMap((p) => Object.values(proj.project(p))), color: f.color, opacity: f.opacity });
    for (const l of extra.lines) for (let i = 0; i + 1 < l.pts.length; i++) splitLine({ ...segment(l.pts[i]!, l.pts[i + 1]!, l.color), tol: l.tol, accent: l.accent });
    for (const pt of extra.points) {
      const q = proj.project(pt.p);
      grow(q.x, q.y);
      dots.push({ x: q.x, y: q.y, color: pt.color });
      if (pt.name) labels.push({ x: q.x + labelGap * 0.6, y: q.y - labelGap * 0.6, text: pt.name, color: pt.color, hidden: !visible(pt.p) });
    }
    // Значения не налезают друг на друга: следующее — строкой ниже (ширина — по числу знаков).
    const placed: { x: number; y: number; w: number }[] = [];
    const lineH = labelGap * 1.25;
    for (const v of extra.values) {
      const q = proj.project(v.p);
      const w = v.text.length * labelGap * 0.6;
      let y = q.y - labelGap * 0.8;
      while (placed.some((o) => Math.abs(o.y - y) < lineH && Math.abs(o.x - q.x) < (o.w + w) / 2)) y += lineH;
      placed.push({ x: q.x, y, w });
      labels.push({ x: q.x, y, text: v.text, color: v.color, hidden: false, value: true });
    }
  }
  const bounds = Number.isFinite(lo.x) ? { x: lo.x, y: lo.y, width: hi.x - lo.x, height: hi.y - lo.y } : { x: 0, y: 0, width: 0, height: 0 };
  return { fills: [...fills.map((f) => f.fill), ...extraFills], lines, labels, dots, bounds };
}

/** Центр тела (для порядка заливки и направления подписей). */
function sceneCenterOf(b: Body): V3 {
  if (b.kind === 'sphere') return b.pos as V3;
  return sceneCenter([b]);
}

/** Масштаб, при котором сцена в виде view вписывается в рамку w × h с полями. */
export function fitScale(bodies: readonly Body[], view: Omit<View, 'scale'>, w: number, h: number, margin = 36): number {
  if (!bodies.length) return 30;
  const proj = projection({ ...view, scale: 1 }, sceneCenter(bodies));
  let mx = 1e-6;
  let my = 1e-6;
  for (const b of bodies) {
    const pts = b.kind === 'sphere' ? circle(b.pos as V3, proj.e1, proj.e2, b.r, 32) : isPolyhedron(b.kind) ? polyhedron(b).verts : features(b, proj).flatMap(featurePoints);
    for (const p of pts) {
      const q = proj.project(p);
      mx = Math.max(mx, Math.abs(q.x));
      my = Math.max(my, Math.abs(q.y));
    }
  }
  const s = Math.min((w / 2 - margin) / mx, (h / 2 - margin) / my);
  return Math.max(2, Math.min(400, s));
}

/** Сетка тела для 3D-редактора: треугольники (позиции по 9 чисел) — только многогранники. */
export function polyTriangles(b: Body): number[] {
  const ph = polyhedron(b);
  const c = mul(
    ph.verts.reduce((s, v) => add(s, v), [0, 0, 0] as V3),
    1 / ph.verts.length,
  );
  const out: number[] = [];
  for (const f of ph.faces) {
    const a = ph.verts[f[0]!]!;
    const n = cross(sub(ph.verts[f[1]!]!, a), sub(ph.verts[f[2]!]!, a));
    const flip = dot(n, sub(c, a)) > 0;
    for (let i = 1; i + 1 < f.length; i++) {
      const tri = [f[0]!, f[i]!, f[i + 1]!];
      if (flip) tri.reverse();
      for (const k of tri) out.push(...ph.verts[k]!);
    }
  }
  return out;
}

/**
 * Выпуклый многогранник, приближающий тело вращения (для сечений): цилиндр
 * и усечённый конус — призма и усечённая пирамида с n гранями, конус —
 * пирамида. Вершины лежат на поверхности тела. Шар — отдельно (сечение — круг).
 */
export function convexPolyhedron(b: Body, n = 72): Polyhedron {
  if (isPolyhedron(b.kind)) return polyhedron(b);
  const { r1, r2, h } = roundDims(b);
  const [px, py, pz] = b.pos;
  const ring = (r: number, z: number): V3[] => Array.from({ length: n }, (_, i) => [px + r * Math.cos((2 * Math.PI * i) / n), py + r * Math.sin((2 * Math.PI * i) / n), pz + z] as V3);
  const bottom = ring(r1, 0);
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  const bottomFace = Array.from({ length: n }, (_, i) => n - 1 - i);
  if (r2 <= 0) {
    for (let i = 0; i < n; i++) edges.push([i, n]);
    return { verts: [...bottom, [px, py, pz + h]], faces: [bottomFace, ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n])], edges, names: [] };
  }
  for (let i = 0; i < n; i++) edges.push([n + i, n + ((i + 1) % n)], [i, n + i]);
  return {
    verts: [...bottom, ...ring(r2, h)],
    faces: [bottomFace, Array.from({ length: n }, (_, i) => n + i), ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])],
    edges,
    names: [],
  };
}

/** Характерные точки тела: вершины многогранника; центры оснований и вершина конуса; центр шара. */
export function keyPoints(b: Body): { p: V3; name: string }[] {
  if (isPolyhedron(b.kind)) {
    const ph = polyhedron(b);
    const names = labelsOf(b, ph.names);
    return ph.verts.map((p, i) => ({ p, name: names[i]! }));
  }
  const pos = b.pos as V3;
  const top = add(pos, [0, 0, b.h]);
  const marks =
    b.kind === 'sphere'
      ? [{ p: pos, name: 'O' }]
      : b.kind === 'cone'
        ? [
            { p: top, name: 'S' },
            { p: pos, name: 'O' },
          ]
        : [
            { p: pos, name: 'O' },
            { p: top, name: 'O₁' },
          ];
  const names = labelsOf(
    b,
    marks.map((m) => m.name),
  );
  return marks.map((m, i) => ({ p: m.p, name: names[i]! }));
}

export { roundDims };
