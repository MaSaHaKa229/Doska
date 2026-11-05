/**
 * Дифференциальные уравнения (этап 6.5b): задача Коши для y′ = f(x, y)
 * методами Эйлера и Рунге — Кутты, особые точки автономной системы и их
 * тип, линейное уравнение второго порядка с постоянными коэффициентами.
 */

import type { F2, Range2 } from '../multivar/multivar';

export type Method = 'euler' | 'rk4';

/** Один шаг метода для y′ = f(x, y). */
export function step(f: F2, x: number, y: number, h: number, method: Method): number {
  if (method === 'euler') return y + h * f(x, y);
  const k1 = f(x, y);
  const k2 = f(x + h / 2, y + (h / 2) * k1);
  const k3 = f(x + h / 2, y + (h / 2) * k2);
  const k4 = f(x + h, y + h * k3);
  return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

/**
 * Интегральная кривая через (x0, y0) с шагом h в обе стороны до краёв
 * области; при уходе y далеко за пределы — обрыв (решение «уходит в бесконечность»).
 */
export function solveCurve(f: F2, x0: number, y0: number, r: Range2, h: number, method: Method): [number, number][] {
  const span = r.yMax - r.yMin;
  const run = (dir: number) => {
    const pts: [number, number][] = [];
    let x = x0;
    let y = y0;
    const maxSteps = Math.ceil((r.xMax - r.xMin) / h) + 2;
    for (let k = 0; k < maxSteps; k++) {
      const ny = step(f, x, y, dir * h, method);
      x += dir * h;
      if (!Number.isFinite(ny) || x < r.xMin - h || x > r.xMax + h) break;
      y = ny;
      pts.push([x, y]);
      if (y < r.yMin - 2 * span || y > r.yMax + 2 * span) break;
    }
    return pts;
  };
  return [...run(-1).reverse(), [x0, y0], ...run(1)];
}

/** Значение решения задачи Коши в точке x (идём от x0 шагами h, последний шаг — укороченный). */
export function solveAt(f: F2, x0: number, y0: number, x: number, h: number, method: Method): number {
  const dir = x >= x0 ? 1 : -1;
  let cx = x0;
  let y = y0;
  for (let k = 0; k < 1e6 && Math.abs(x - cx) > 1e-12; k++) {
    const s = dir * Math.min(h, Math.abs(x - cx));
    y = step(f, cx, y, s, method);
    cx += s;
    if (!Number.isFinite(y)) return NaN;
  }
  return y;
}

// =====================================================================
//  Автономная система x′ = P(x, y), y′ = Q(x, y)
// =====================================================================

export interface Jacobian {
  a: number;
  b: number;
  c: number;
  d: number;
}

export type PointKind = 'saddle' | 'node-stable' | 'node-unstable' | 'focus-stable' | 'focus-unstable' | 'center' | 'degenerate';

export const POINT_TITLE: Record<PointKind, string> = {
  saddle: 'седло',
  'node-stable': 'устойчивый узел',
  'node-unstable': 'неустойчивый узел',
  'focus-stable': 'устойчивый фокус',
  'focus-unstable': 'неустойчивый фокус',
  center: 'центр',
  degenerate: 'вырожденная точка',
};

export interface Equilibrium {
  x: number;
  y: number;
  kind: PointKind;
  /** Собственные числа: re ± i·im (im = 0 — вещественные l1, l2). */
  l1: number;
  l2: number;
  im: number;
}

/** Тип особой точки по следу T и определителю D якобиана. */
export function classify(J: Jacobian, eps = 1e-9): Pick<Equilibrium, 'kind' | 'l1' | 'l2' | 'im'> {
  const T = J.a + J.d;
  const D = J.a * J.d - J.b * J.c;
  const disc = T * T - 4 * D;
  if (Math.abs(D) < eps) return { kind: 'degenerate', l1: T, l2: 0, im: 0 };
  if (D < 0) {
    const s = Math.sqrt(disc);
    return { kind: 'saddle', l1: (T - s) / 2, l2: (T + s) / 2, im: 0 };
  }
  if (disc >= -eps) {
    const s = Math.sqrt(Math.max(0, disc));
    return { kind: T < 0 ? 'node-stable' : 'node-unstable', l1: (T - s) / 2, l2: (T + s) / 2, im: 0 };
  }
  const im = Math.sqrt(-disc) / 2;
  if (Math.abs(T) < eps) return { kind: 'center', l1: 0, l2: 0, im };
  return { kind: T < 0 ? 'focus-stable' : 'focus-unstable', l1: T / 2, l2: T / 2, im };
}

export interface System {
  P: F2;
  Q: F2;
  Px: F2;
  Py: F2;
  Qx: F2;
  Qy: F2;
}

/** Особые точки в области: метод Ньютона из узлов сетки, совпадающие — склеиваются. */
export function equilibria(s: System, r: Range2, seeds = 9): Equilibrium[] {
  const out: Equilibrium[] = [];
  const tol = Math.max(r.xMax - r.xMin, r.yMax - r.yMin) * 1e-4;
  for (let i = 0; i <= seeds; i++)
    for (let j = 0; j <= seeds; j++) {
      let x = r.xMin + ((r.xMax - r.xMin) * i) / seeds;
      let y = r.yMin + ((r.yMax - r.yMin) * j) / seeds;
      let ok = false;
      for (let k = 0; k < 40; k++) {
        const p = s.P(x, y);
        const q = s.Q(x, y);
        if (!Number.isFinite(p) || !Number.isFinite(q)) break;
        if (Math.hypot(p, q) < 1e-11) {
          ok = true;
          break;
        }
        const a = s.Px(x, y);
        const b = s.Py(x, y);
        const c = s.Qx(x, y);
        const d = s.Qy(x, y);
        const det = a * d - b * c;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-14) break;
        x -= (d * p - b * q) / det;
        y -= (a * q - c * p) / det;
      }
      if (!ok || x < r.xMin || x > r.xMax || y < r.yMin || y > r.yMax) continue;
      if (out.some((e) => Math.hypot(e.x - x, e.y - y) < tol)) continue;
      const cx = Math.abs(x) < 1e-9 ? 0 : x;
      const cy = Math.abs(y) < 1e-9 ? 0 : y;
      out.push({ x: cx, y: cy, ...classify({ a: s.Px(x, y), b: s.Py(x, y), c: s.Qx(x, y), d: s.Qy(x, y) }) });
    }
  return out.slice(0, 12);
}

/**
 * Фазовая траектория во времени (Рунге — Кутта): вперёд и назад до tMax,
 * пока точка в расширенной области. dt подбирается по скорости.
 */
export function trajectory(P: F2, Q: F2, x0: number, y0: number, r: Range2, tMax: number, n = 600): [number, number][] {
  const w = Math.max(r.xMax - r.xMin, r.yMax - r.yMin);
  const run = (dir: number) => {
    const pts: [number, number][] = [];
    let x = x0;
    let y = y0;
    let t = 0;
    for (let k = 0; k < n * 4 && t < tMax; k++) {
      const v = Math.hypot(P(x, y), Q(x, y));
      if (!Number.isFinite(v) || v < 1e-10) break;
      const dt = Math.min(tMax / n, (w / 300) / v) * dir;
      const f = (a: number, b: number): [number, number] => [P(a, b), Q(a, b)];
      const k1 = f(x, y);
      const k2 = f(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1]);
      const k3 = f(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1]);
      const k4 = f(x + dt * k3[0], y + dt * k3[1]);
      x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      t += Math.abs(dt);
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      pts.push([x, y]);
      if (x < r.xMin - w || x > r.xMax + w || y < r.yMin - w || y > r.yMax + w) break;
    }
    return pts;
  };
  return [...run(-1).reverse(), [x0, y0], ...run(1)];
}

// =====================================================================
//  y″ + p·y′ + q·y = 0
// =====================================================================

export interface Second {
  /** Дискриминант характеристического уравнения r² + pr + q = 0. */
  D: number;
  kind: 'real' | 'double' | 'complex';
  r1: number;
  r2: number;
  /** Для комплексных корней: α ± iβ. */
  alpha: number;
  beta: number;
  C1: number;
  C2: number;
  y(t: number): number;
  general: string;
  behaviour: string;
}

const n3 = (v: number) => {
  const r = Number(v.toPrecision(3));
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',').replace('-', '−');
};

/** Решение задачи Коши y(0) = y0, y′(0) = v0. */
export function second(p: number, q: number, y0: number, v0: number): Second {
  const D = p * p - 4 * q;
  const eps = 1e-12;
  if (D > eps) {
    const s = Math.sqrt(D);
    const r1 = (-p - s) / 2;
    const r2 = (-p + s) / 2;
    // C1 + C2 = y0, r1C1 + r2C2 = v0.
    const C2 = (v0 - r1 * y0) / (r2 - r1);
    const C1 = y0 - C2;
    return {
      D, kind: 'real', r1, r2, alpha: 0, beta: 0, C1, C2,
      y: (t) => C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t),
      general: `y = C₁e^(${n3(r1)}t) + C₂e^(${n3(r2)}t)`,
      behaviour: r2 < 0 ? 'апериодическое затухание (без колебаний)' : r1 > 0 ? 'неограниченный рост' : 'одно слагаемое растёт, другое затухает',
    };
  }
  if (D >= -eps) {
    const r = -p / 2;
    const C1 = y0;
    const C2 = v0 - r * y0;
    return {
      D: 0, kind: 'double', r1: r, r2: r, alpha: 0, beta: 0, C1, C2,
      y: (t) => (C1 + C2 * t) * Math.exp(r * t),
      general: `y = (C₁ + C₂t)e^(${n3(r)}t)`,
      behaviour: r < 0 ? 'критическое затухание — быстрее всего без колебаний' : r > 0 ? 'неограниченный рост' : 'равномерное движение: y = C₁ + C₂t',
    };
  }
  const alpha = -p / 2;
  const beta = Math.sqrt(-D) / 2;
  const C1 = y0;
  const C2 = (v0 - alpha * y0) / beta;
  return {
    D, kind: 'complex', r1: alpha, r2: alpha, alpha, beta, C1, C2,
    y: (t) => Math.exp(alpha * t) * (C1 * Math.cos(beta * t) + C2 * Math.sin(beta * t)),
    general: Math.abs(alpha) < eps ? `y = C₁cos ${n3(beta)}t + C₂sin ${n3(beta)}t` : `y = e^(${n3(alpha)}t)(C₁cos ${n3(beta)}t + C₂sin ${n3(beta)}t)`,
    behaviour: Math.abs(alpha) < eps ? `гармонические колебания с периодом ${n3((2 * Math.PI) / beta)}` : alpha < 0 ? 'затухающие колебания' : 'нарастающие колебания',
  };
}
