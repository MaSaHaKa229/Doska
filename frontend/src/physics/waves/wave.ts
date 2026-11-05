/**
 * Волны (этап 7.5b): чистые функции по школьным формулам.
 */

// =====================================================================
//  Бегущая волна: s(x, t) = A sin(ωt − kx)
// =====================================================================

export interface Travelling {
  k: number;
  omega: number;
  /** Частота и период: ν = v/λ, T = 1/ν. */
  nu: number;
  T: number;
  s(x: number, t: number): number;
}

export function travelling(A: number, lambda: number, v: number): Travelling {
  const k = (2 * Math.PI) / lambda;
  const nu = v / lambda;
  const omega = 2 * Math.PI * nu;
  return { k, omega, nu, T: 1 / nu, s: (x, t) => A * Math.sin(omega * t - k * x) };
}

// =====================================================================
//  Стоячая волна на струне с закреплёнными концами
// =====================================================================

export interface Standing {
  lambda: number;
  nu: number;
  omega: number;
  /** Узлы и пучности — координаты вдоль струны. */
  nodes: number[];
  antinodes: number[];
  y(x: number, t: number): number;
  envelope(x: number): number;
}

/** n-я гармоника струны длиной L: λ = 2L/n, ν = nv/(2L). */
export function standing(L: number, n: number, v: number, A: number): Standing {
  const lambda = (2 * L) / n;
  const nu = v / lambda;
  const omega = 2 * Math.PI * nu;
  const k = (2 * Math.PI) / lambda;
  return {
    lambda,
    nu,
    omega,
    nodes: Array.from({ length: n + 1 }, (_, i) => (i * L) / n),
    antinodes: Array.from({ length: n }, (_, i) => ((i + 0.5) * L) / n),
    y: (x, t) => 2 * A * Math.sin(k * x) * Math.cos(omega * t),
    envelope: (x) => 2 * A * Math.abs(Math.sin(k * x)),
  };
}

// =====================================================================
//  Интерференция от двух когерентных источников
// =====================================================================

/** Разность хода от точки до источников S₁(−d/2, 0) и S₂(d/2, 0). */
export function pathDiff(x: number, y: number, d: number): number {
  return Math.hypot(x + d / 2, y) - Math.hypot(x - d / 2, y);
}

/** Относительная интенсивность: cos²(πΔ/λ) — 1 в максимумах, 0 в минимумах. */
export const intensity = (delta: number, lambda: number) => Math.cos((Math.PI * delta) / lambda) ** 2;

/** Условие: «максимум (Δ = kλ)», «минимум (Δ = (k + ½)λ)» или промежуточная точка. */
export function condition(delta: number, lambda: number): { kind: 'max' | 'min' | 'mid'; order: number } {
  const m = delta / lambda;
  const r = Math.round(m);
  if (Math.abs(m - r) < 0.08) return { kind: 'max', order: Math.abs(r) };
  const h = Math.floor(m) + 0.5;
  if (Math.abs(m - h) < 0.08) return { kind: 'min', order: Math.floor(Math.abs(m)) };
  return { kind: 'mid', order: 0 };
}

/** Число максимумов на линии источников: |k| ≤ d/λ. */
export const maximaCount = (d: number, lambda: number) => 2 * Math.floor(d / lambda + 1e-9) + 1;

// =====================================================================
//  Звук
// =====================================================================

/** Скорость звука в воздухе, м/с. */
export const SOUND_V = 340;

/** Длина звуковой волны и характеристика тона по частоте. */
export function soundInfo(nu: number): { lambda: number; pitch: string } {
  const pitch = nu < 20 ? 'инфразвук — не слышен' : nu > 20000 ? 'ультразвук — не слышен' : nu < 250 ? 'низкий тон' : nu < 2000 ? 'средний тон' : 'высокий тон';
  return { lambda: SOUND_V / nu, pitch };
}
