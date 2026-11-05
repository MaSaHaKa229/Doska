/**
 * Динамика, законы сохранения, статика (этап 7.2b): чистые функции по
 * школьным формулам. Единицы — СИ.
 */

const rad = (deg: number) => (deg * Math.PI) / 180;

// =====================================================================
//  Наклонная плоскость
// =====================================================================

export interface InclineIn {
  /** Угол наклона, градусы. */
  alpha: number;
  m: number;
  /** Коэффициент трения скольжения. */
  mu: number;
  g: number;
  /** Длина наклонной плоскости, м. */
  len: number;
}

export interface InclineInfo {
  N: number;
  /** Сила трения: скольжения (μN) или покоя (mg·sin α). */
  Ffr: number;
  a: number;
  slides: boolean;
  /** Путь вдоль плоскости от начала до низа, м. */
  dist: number;
  tEnd: number;
  s(t: number): number;
  v(t: number): number;
}

export function incline(p: InclineIn): InclineInfo {
  const al = rad(p.alpha);
  const N = p.m * p.g * Math.cos(al);
  const pull = p.m * p.g * Math.sin(al);
  // Брусок сдвинется, если скатывающая сила больше наибольшей силы трения покоя: tg α > μ.
  const slides = Math.tan(al) > p.mu + 1e-12;
  const a = slides ? p.g * (Math.sin(al) - p.mu * Math.cos(al)) : 0;
  const Ffr = slides ? p.mu * N : pull;
  const dist = p.len * 0.75;
  const tEnd = slides ? Math.sqrt((2 * dist) / a) : 3;
  return { N, Ffr, a, slides, dist, tEnd, s: (t) => Math.min(dist, (a * t * t) / 2), v: (t) => a * Math.min(t, tEnd) };
}

// =====================================================================
//  Блок с двумя грузами (машина Атвуда)
// =====================================================================

export interface AtwoodInfo {
  /** Ускорение второго (правого) груза вниз; отрицательное — вверх. */
  a: number;
  /** Натяжение нити. */
  T: number;
  travel: number;
  tEnd: number;
  /** Смещение правого груза вниз к моменту t, м. */
  s(t: number): number;
}

export function atwood(m1: number, m2: number, g: number, travel = 1.2): AtwoodInfo {
  const a = ((m2 - m1) * g) / (m1 + m2);
  const T = (2 * m1 * m2 * g) / (m1 + m2);
  const tEnd = Math.abs(a) > 1e-9 ? Math.sqrt((2 * travel) / Math.abs(a)) : 3;
  return { a, T, travel, tEnd, s: (t) => Math.sign(a) * Math.min(travel, (Math.abs(a) * t * t) / 2) };
}

// =====================================================================
//  Пружинный маятник
// =====================================================================

export interface SpringInfo {
  omega: number;
  period: number;
  tEnd: number;
  x(t: number): number;
  v(t: number): number;
  /** Энергии: кинетическая, потенциальная (упругая), полная. */
  energy(t: number): { ek: number; ep: number; e: number };
}

export function spring(k: number, m: number, A: number, periods = 3): SpringInfo {
  const omega = Math.sqrt(k / m);
  const period = (2 * Math.PI) / omega;
  const x = (t: number) => A * Math.cos(omega * t);
  const v = (t: number) => -A * omega * Math.sin(omega * t);
  return {
    omega,
    period,
    tEnd: period * periods,
    x,
    v,
    energy: (t) => {
      const ek = (m * v(t) ** 2) / 2;
      const ep = (k * x(t) ** 2) / 2;
      return { ek, ep, e: (k * A * A) / 2 };
    },
  };
}

// =====================================================================
//  Столкновение шаров на прямой
// =====================================================================

export interface CollisionIn {
  m1: number;
  v1: number;
  m2: number;
  v2: number;
  /** true — абсолютно упругий удар, false — неупругий (шары слипаются). */
  elastic: boolean;
}

export interface CollisionInfo {
  r1: number;
  r2: number;
  /** Момент удара (null — шары не сближаются). */
  tc: number | null;
  u1: number;
  u2: number;
  p: number;
  pAfter: number;
  ek: number;
  ekAfter: number;
  tEnd: number;
  x1(t: number): number;
  x2(t: number): number;
}

/** Начальные положения центров, м. */
export const X1 = -2;
export const X2 = 2;

export function collision(c: CollisionIn): CollisionInfo {
  const r1 = 0.25 * Math.cbrt(c.m1);
  const r2 = 0.25 * Math.cbrt(c.m2);
  const M = c.m1 + c.m2;
  let u1: number;
  let u2: number;
  if (c.elastic) {
    u1 = ((c.m1 - c.m2) * c.v1 + 2 * c.m2 * c.v2) / M;
    u2 = ((c.m2 - c.m1) * c.v2 + 2 * c.m1 * c.v1) / M;
  } else u1 = u2 = (c.m1 * c.v1 + c.m2 * c.v2) / M;
  const gap = X2 - X1 - r1 - r2;
  const tc = c.v1 > c.v2 ? gap / (c.v1 - c.v2) : null;
  const ek = (c.m1 * c.v1 ** 2 + c.m2 * c.v2 ** 2) / 2;
  const ekAfter = tc === null ? ek : (c.m1 * u1 ** 2 + c.m2 * u2 ** 2) / 2;
  const tEnd = tc === null ? 3 : tc * 2 + 0.5;
  const pos = (x0: number, v: number, u: number) => (t: number) => (tc === null || t <= tc ? x0 + v * t : x0 + v * tc + u * (t - tc));
  return {
    r1,
    r2,
    tc,
    u1: tc === null ? c.v1 : u1,
    u2: tc === null ? c.v2 : u2,
    p: c.m1 * c.v1 + c.m2 * c.v2,
    pAfter: c.m1 * (tc === null ? c.v1 : u1) + c.m2 * (tc === null ? c.v2 : u2),
    ek,
    ekAfter,
    tEnd,
    x1: pos(X1, c.v1, u1),
    x2: pos(X2, c.v2, u2),
  };
}

// =====================================================================
//  Рычаг
// =====================================================================

export interface LeverInfo {
  M1: number;
  M2: number;
  /** −1 — перевешивает левое плечо, 1 — правое, 0 — равновесие. */
  side: -1 | 0 | 1;
}

export function lever(m1: number, l1: number, m2: number, l2: number, g: number): LeverInfo {
  const M1 = m1 * g * l1;
  const M2 = m2 * g * l2;
  const d = M2 - M1;
  return { M1, M2, side: Math.abs(d) <= 1e-9 * Math.max(M1, M2, 1) ? 0 : d > 0 ? 1 : -1 };
}
