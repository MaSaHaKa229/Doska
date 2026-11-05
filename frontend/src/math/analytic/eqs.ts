import type { Point } from '@doska/shared';
import { fmtNum, parseCurve, type ParsedCurve } from '../analysis/expr';

/**
 * Аналитическая геометрия (6.3a): прямая Ax + By + C = 0 и кривая второго
 * порядка Ax² + Bxy + Cy² + Dx + Ey + F = 0 по уравнению в любой записи
 * («y = 2x + 1», «2x − 3y + 6 = 0», «x²/25 + y²/9 = 1», «y = x² − 4x»).
 * Коэффициенты находятся подстановкой точек в F(x, y) = левая − правая часть.
 */

type F2 = (x: number, y: number) => number;

/** F(x, y) по записи: функция y = f(x) даёт y − f(x), уравнение — левая − правая часть. */
export function equationFn(parsed: ParsedCurve, params: Record<string, number>): F2 | null {
  if (parsed.kind === 'function') return (x, y) => y - parsed.f({ ...params, x });
  if (parsed.kind === 'implicit') return (x, y) => parsed.f({ ...params, x, y });
  return null;
}

/** Проверка: F совпадает с многочленом по коэффициентам в «случайных» точках. */
function matches(F: F2, P: F2): boolean {
  for (const [x, y] of [
    [1.37, -2.11],
    [-3.3, 0.71],
    [0.29, 4.4],
    [5.1, 2.3],
  ] as const) {
    const a = F(x, y);
    const b = P(x, y);
    if (!Number.isFinite(a) || Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(a))) return false;
  }
  return true;
}

export interface LineEq {
  A: number;
  B: number;
  C: number;
}

/** Прямая по записи; ошибка — если запись не уравнение прямой. */
export function parseLine(text: string, params: Record<string, number>): LineEq | { error: string } {
  const parsed = parseCurve(text);
  if ('error' in parsed) return parsed;
  const F = equationFn(parsed, params);
  if (!F) return { error: 'Нужно уравнение: «y = 2x + 1» или «2x − 3y + 6 = 0»' };
  const C = F(0, 0);
  const A = F(1, 0) - C;
  const B = F(0, 1) - C;
  if (!matches(F, (x, y) => A * x + B * y + C)) return { error: 'Это не уравнение прямой (есть x², xy, sin…)' };
  if (Math.abs(A) < 1e-12 && Math.abs(B) < 1e-12) return { error: 'Нет x и y — это не прямая' };
  return { A, B, C };
}

/** Коэффициенты, приведённые к целым, если это возможно (2x − 3y + 6 = 0). */
function niceCoeffs(cs: number[]): number[] {
  const nz = cs.filter((c) => Math.abs(c) > 1e-12);
  if (!nz.length) return cs;
  // Знак: первый ненулевой коэффициент при переменной — положительный.
  const sign = Math.sign(nz[0]!);
  let k = sign / Math.min(...nz.map(Math.abs));
  for (const m of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    const t = cs.map((c) => c * k * m);
    if (t.every((v) => Math.abs(v - Math.round(v)) < 1e-9)) return t.map((v) => Math.round(v) + 0);
  }
  k = sign;
  return cs.map((c) => c * k);
}

/** «2x − 3y + 6 = 0». */
export function lineText(l: LineEq): string {
  const [A, B, C] = niceCoeffs([l.A, l.B, l.C]) as [number, number, number];
  return polyText([
    [A, 'x'],
    [B, 'y'],
    [C, ''],
  ]);
}

function polyText(terms: [number, string][]): string {
  let s = '';
  for (const [c, v] of terms) {
    if (Math.abs(c) < 1e-12) continue;
    const abs = Math.abs(c);
    const num = v && Math.abs(abs - 1) < 1e-12 ? '' : fmtNum(abs, 4);
    s += s ? (c < 0 ? ' − ' : ' + ') : c < 0 ? '−' : '';
    s += num + v;
  }
  return `${s || '0'} = 0`;
}

/** Точка прямой, ближайшая к началу координат, и направляющий вектор. */
export function lineGeometry(l: LineEq): { p: Point; dir: Point; normal: Point } {
  const n2 = l.A * l.A + l.B * l.B;
  return { p: { x: (-l.A * l.C) / n2, y: (-l.B * l.C) / n2 }, dir: { x: -l.B, y: l.A }, normal: { x: l.A, y: l.B } };
}

/** Расстояние от точки до прямой: |Ax₀ + By₀ + C| / √(A² + B²). */
export const distanceToLine = (l: LineEq, p: Point) => Math.abs(l.A * p.x + l.B * p.y + l.C) / Math.hypot(l.A, l.B);

/** Основание перпендикуляра из точки на прямую. */
export function footOnLine(l: LineEq, p: Point): Point {
  const t = (l.A * p.x + l.B * p.y + l.C) / (l.A * l.A + l.B * l.B);
  return { x: p.x - l.A * t, y: p.y - l.B * t };
}

/** Угол между прямыми (0…90°) и точка пересечения (null — параллельны). */
export function angleBetween(a: LineEq, b: LineEq): { deg: number; at: Point | null } {
  const cos = Math.abs(a.A * b.A + a.B * b.B) / (Math.hypot(a.A, a.B) * Math.hypot(b.A, b.B));
  const deg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
  const det = a.A * b.B - a.B * b.A;
  const at = Math.abs(det) < 1e-12 ? null : { x: (a.B * b.C - b.B * a.C) / det, y: (b.A * a.C - a.A * b.C) / det };
  return { deg, at };
}

// ---------------------------------------------------------------------
//  Кривые второго порядка
// ---------------------------------------------------------------------

export interface QuadEq {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
}

export function parseQuadratic(text: string, params: Record<string, number>): QuadEq | { error: string } {
  const parsed = parseCurve(text);
  if ('error' in parsed) return parsed;
  const Fn = equationFn(parsed, params);
  if (!Fn) return { error: 'Нужно уравнение кривой: «x²/25 + y²/9 = 1», «y = x² − 4x»' };
  const F = Fn(0, 0);
  const D = (Fn(1, 0) - Fn(-1, 0)) / 2;
  const A = (Fn(1, 0) + Fn(-1, 0)) / 2 - F;
  const E = (Fn(0, 1) - Fn(0, -1)) / 2;
  const C = (Fn(0, 1) + Fn(0, -1)) / 2 - F;
  const B = Fn(1, 1) - A - C - D - E - F;
  const q = { A, B, C, D, E, F };
  if (!matches(Fn, (x, y) => A * x * x + B * x * y + C * y * y + D * x + E * y + F)) return { error: 'Это не кривая второго порядка (степень выше второй или sin, √…)' };
  if ([A, B, C].every((v) => Math.abs(v) < 1e-12)) return { error: 'Нет x², xy, y² — это прямая, а не кривая второго порядка' };
  return q;
}

export type ConicKind = 'ellipse' | 'circle' | 'hyperbola' | 'parabola' | 'degenerate' | 'empty';

/** Кривая в своих осях X, Y (поворот theta, начало — центр или вершина). */
export interface Conic {
  kind: ConicKind;
  /** Центр (вершина параболы) в координатах графика. */
  center: Point;
  /** Поворот осей X, Y относительно x, y (рад). */
  theta: number;
  a: number;
  b: number;
  c: number;
  e: number;
  /** Параметр параболы: Y² = 2pX. */
  p: number;
}

export const CONIC_TITLES: Record<ConicKind, string> = {
  ellipse: 'Эллипс',
  circle: 'Окружность',
  hyperbola: 'Гипербола',
  parabola: 'Парабола',
  degenerate: 'Вырожденная кривая (точка или пара прямых)',
  empty: 'Мнимая кривая — точек нет',
};

const EPS = 1e-9;

/** Эллипс и гипербола симметричны относительно центра: угол осей — в (−π/2; π/2]. */
function halfTurn(th: number): number {
  let t = th % Math.PI;
  if (t > Math.PI / 2 + 1e-12) t -= Math.PI;
  if (t <= -Math.PI / 2 + 1e-12) t += Math.PI;
  return t;
}

function rotated(q: QuadEq, th: number) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return {
    A: q.A * c * c + q.B * c * s + q.C * s * s,
    C: q.A * s * s - q.B * c * s + q.C * c * c,
    D: q.D * c + q.E * s,
    E: -q.D * s + q.E * c,
    F: q.F,
  };
}

/** Приведение к каноническому виду: поворот (убирает xy) и перенос. */
export function analyzeConic(q: QuadEq): Conic {
  const scale = Math.max(Math.abs(q.A), Math.abs(q.B), Math.abs(q.C));
  let th = 0.5 * Math.atan2(q.B, q.A - q.C);
  let r = rotated(q, th);
  const small = (v: number) => Math.abs(v) < EPS * scale * 1e3;
  const toXY = (u: number, v: number): Point => ({ x: u * Math.cos(th) - v * Math.sin(th), y: u * Math.sin(th) + v * Math.cos(th) });
  const base = { a: 0, b: 0, c: 0, e: 0, p: 0 };

  if (!small(r.A) && !small(r.C)) {
    const u0 = -r.D / (2 * r.A);
    const v0 = -r.E / (2 * r.C);
    const K = r.F - r.A * u0 * u0 - r.C * v0 * v0;
    const center = toXY(u0, v0);
    if (Math.abs(K) < 1e-9 * Math.max(1, Math.abs(r.F))) return { ...base, kind: 'degenerate', center, theta: th };
    const pa = -K / r.A;
    const pb = -K / r.C;
    if (pa > 0 && pb > 0) {
      let a = Math.sqrt(pa);
      let b = Math.sqrt(pb);
      // Большая ось — X.
      if (a < b) {
        [a, b] = [b, a];
        th += Math.PI / 2;
      }
      const c = Math.sqrt(Math.max(0, a * a - b * b));
      const kind = c < 1e-9 * a ? 'circle' : 'ellipse';
      return { kind, center, theta: halfTurn(th), a, b, c, e: c / a, p: 0 };
    }
    if (pa < 0 && pb < 0) return { ...base, kind: 'empty', center, theta: th };
    // Гипербола: действительная ось — та, где коэффициент положительный.
    const a = Math.sqrt(Math.abs(pa > 0 ? pa : pb));
    const b = Math.sqrt(Math.abs(pa > 0 ? pb : pa));
    if (pa < 0) th += Math.PI / 2;
    const c = Math.hypot(a, b);
    return { kind: 'hyperbola', center, theta: halfTurn(th), a, b, c, e: c / a, p: 0 };
  }

  // Парабола: квадрат только по одной оси — делаем её осью Y (Y² = 2pX).
  if (small(r.C)) {
    th += Math.PI / 2;
    r = rotated(q, th);
  }
  if (small(r.D)) return { ...base, kind: 'degenerate', center: { x: 0, y: 0 }, theta: th };
  // C'(v − v₀)² + D'(u − u₀) = 0 ⇒ (v − v₀)² = 2p(u − u₀), p = −D' / (2C').
  const v0 = -r.E / (2 * r.C);
  const u0 = -(r.F - r.C * v0 * v0) / r.D;
  const vertex = toXY(u0, v0);
  let p = -r.D / (2 * r.C);
  if (p < 0) {
    // Ветви в сторону −X: поворот осей на 180° (Y² не меняется, X меняет знак).
    th += Math.PI;
    p = -p;
  }
  return { kind: 'parabola', center: vertex, theta: th, a: 0, b: 0, c: 0, e: 1, p };
}

/** Точка кривой: из её осей X, Y в координаты графика. */
export function fromConic(k: Conic, X: number, Y: number): Point {
  const c = Math.cos(k.theta);
  const s = Math.sin(k.theta);
  return { x: k.center.x + X * c - Y * s, y: k.center.y + X * s + Y * c };
}

/** Ветви кривой точками (в координатах графика) на «размахе» R. */
export function conicBranches(k: Conic, R: number): Point[][] {
  const n = 400;
  switch (k.kind) {
    case 'ellipse':
    case 'circle':
      return [Array.from({ length: n + 1 }, (_, i) => fromConic(k, k.a * Math.cos((2 * Math.PI * i) / n), k.b * Math.sin((2 * Math.PI * i) / n)))];
    case 'hyperbola': {
      const T = Math.asinh((R * 3) / k.b);
      const branch = (sgn: number) => Array.from({ length: n + 1 }, (_, i) => {
        const t = -T + (2 * T * i) / n;
        return fromConic(k, sgn * k.a * Math.cosh(t), k.b * Math.sinh(t));
      });
      return [branch(1), branch(-1)];
    }
    case 'parabola': {
      const L = Math.sqrt(2 * k.p * R * 3) + R;
      return [Array.from({ length: n + 1 }, (_, i) => {
        const Y = -L + (2 * L * i) / n;
        return fromConic(k, (Y * Y) / (2 * k.p), Y);
      })];
    }
    default:
      return [];
  }
}

/** Фокусы, директрисы и асимптоты (прямые — точкой и направлением) в координатах графика. */
export function conicElements(k: Conic): { foci: Point[]; directrices: { p: Point; d: Point }[]; asymptotes: { p: Point; d: Point }[] } {
  const dirY = { x: -Math.sin(k.theta), y: Math.cos(k.theta) };
  const along = (X: number, Y: number) => sub(fromConic(k, X, Y), k.center);
  switch (k.kind) {
    case 'ellipse':
      return { foci: [fromConic(k, k.c, 0), fromConic(k, -k.c, 0)], directrices: k.e > 0 ? [{ p: fromConic(k, k.a / k.e, 0), d: dirY }, { p: fromConic(k, -k.a / k.e, 0), d: dirY }] : [], asymptotes: [] };
    case 'circle':
      return { foci: [k.center], directrices: [], asymptotes: [] };
    case 'hyperbola':
      return {
        foci: [fromConic(k, k.c, 0), fromConic(k, -k.c, 0)],
        directrices: [{ p: fromConic(k, k.a / k.e, 0), d: dirY }, { p: fromConic(k, -k.a / k.e, 0), d: dirY }],
        asymptotes: [{ p: k.center, d: along(k.a, k.b) }, { p: k.center, d: along(k.a, -k.b) }],
      };
    case 'parabola':
      return { foci: [fromConic(k, k.p / 2, 0)], directrices: [{ p: fromConic(k, -k.p / 2, 0), d: dirY }], asymptotes: [] };
    default:
      return { foci: [], directrices: [], asymptotes: [] };
  }
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** Каноническое уравнение и параметры для подписи. */
export function conicText(k: Conic): string {
  const f = (v: number) => fmtNum(v, 4);
  const sq = (v: number) => f(v * v);
  const shifted = Math.hypot(k.center.x, k.center.y) > 1e-9 || Math.abs(Math.sin(k.theta)) > 1e-9 && k.kind !== 'circle';
  const axes = shifted ? ` (оси X, Y: центр ${k.kind === 'parabola' ? 'вершина ' : ''}(${f(k.center.x)}; ${f(k.center.y)}), поворот ${f((((k.theta * 180) / Math.PI) % 360 + 360) % 360)}°)` : '';
  const X = shifted ? 'X' : 'x';
  const Y = shifted ? 'Y' : 'y';
  switch (k.kind) {
    case 'circle':
      return `${CONIC_TITLES.circle}: ${shifted ? `(x − ${f(k.center.x)})² + (y − ${f(k.center.y)})²`.replace(/− −/g, '+ ') : 'x² + y²'} = ${sq(k.a)}, r = ${f(k.a)}`;
    case 'ellipse':
      return `${CONIC_TITLES.ellipse}: ${X}²/${sq(k.a)} + ${Y}²/${sq(k.b)} = 1${axes}; a = ${f(k.a)}, b = ${f(k.b)}, c = ${f(k.c)}, e = ${f(k.e)}`;
    case 'hyperbola':
      return `${CONIC_TITLES.hyperbola}: ${X}²/${sq(k.a)} − ${Y}²/${sq(k.b)} = 1${axes}; a = ${f(k.a)}, b = ${f(k.b)}, c = ${f(k.c)}, e = ${f(k.e)}`;
    case 'parabola':
      return `${CONIC_TITLES.parabola}: ${Y}² = ${f(2 * k.p)}${X}${axes}; p = ${f(k.p)}`;
    default:
      return CONIC_TITLES[k.kind];
  }
}

// ---------------------------------------------------------------------
//  Векторы
// ---------------------------------------------------------------------

export const vlen = (v: Point) => Math.hypot(v.x, v.y);
export const vdot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
/** Угол между векторами, градусы (NaN — нулевой вектор). */
export const vangle = (a: Point, b: Point) => (Math.acos(Math.max(-1, Math.min(1, vdot(a, b) / (vlen(a) * vlen(b))))) * 180) / Math.PI;
