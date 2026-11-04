import type { MathJsInstance } from 'mathjs';

/**
 * Кинематика (этап 7.2a): закон движения x(t), y(t) по записи и бросок под
 * углом к горизонту. Единицы — СИ (м, с, м/с); y вверх.
 */

export interface Law {
  x(t: number): number;
  y(t: number): number;
}

/** Школьная запись закона → math.js: «5 + 2t», «0,5t²», «3·cos(2t)». */
export const prepareLaw = (s: string) =>
  (s.trim() || '0')
    .replace(/[·×]/g, '*')
    .replace(/[−–]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .replace(/(\d),(?=\d)/g, '$1.');

export function compileLaw(math: MathJsInstance, xs: string, ys: string): Law | { error: string } {
  const fns: ((t: number) => number)[] = [];
  for (const [name, src] of [['x', xs], ['y', ys]] as const) {
    let code: { evaluate(scope: Record<string, number>): unknown };
    try {
      code = math.parse(prepareLaw(src)).compile();
    } catch {
      return { error: `Ошибка в записи ${name}(t)` };
    }
    const f = (t: number) => Number(code.evaluate({ t }));
    try {
      for (const t of [0, 0.37, 1.9]) if (typeof f(t) !== 'number') throw new Error();
    } catch {
      return { error: `В записи ${name}(t) — неизвестное имя (время — t)` };
    }
    fns.push(f);
  }
  return { x: fns[0]!, y: fns[1]! };
}

/** Скорость по закону — центральной разностью. */
export function velocity(law: Law, t: number): { vx: number; vy: number } {
  const h = 1e-4;
  return { vx: (law.x(t + h) - law.x(t - h)) / (2 * h), vy: (law.y(t + h) - law.y(t - h)) / (2 * h) };
}

/** Точки траектории на [0, tEnd]. */
export function sample(law: Law, tEnd: number, n = 240): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (tEnd * i) / n;
    const x = law.x(t);
    const y = law.y(t);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

// =====================================================================
//  Бросок под углом к горизонту
// =====================================================================

export interface Throw {
  v0: number;
  /** Угол к горизонту, градусы. */
  angle: number;
  /** Начальная высота, м. */
  h0: number;
  g: number;
}

export interface ThrowInfo {
  vx: number;
  vy0: number;
  /** Время полёта, наибольшая высота (над землёй), дальность, время подъёма. */
  T: number;
  H: number;
  L: number;
  tTop: number;
  law: Law;
}

export function throwInfo(p: Throw): ThrowInfo {
  const a = (p.angle * Math.PI) / 180;
  const vx = p.v0 * Math.cos(a);
  const vy0 = p.v0 * Math.sin(a);
  const T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * p.g * p.h0)) / p.g;
  const tTop = Math.max(0, vy0 / p.g);
  return {
    vx,
    vy0,
    T,
    tTop,
    H: p.h0 + (vy0 > 0 ? (vy0 * vy0) / (2 * p.g) : 0),
    L: vx * T,
    law: { x: (t) => vx * t, y: (t) => p.h0 + vy0 * t - (p.g * t * t) / 2 },
  };
}

/** Шаг делений оси: 1, 2, 5, 10… единиц, не чаще чем через minPx пикселей. */
export function tickStep(scale: number, minPx = 40): number {
  for (let k = -2; k < 7; k++) for (const m of [1, 2, 5]) if (m * 10 ** k * scale >= minPx) return m * 10 ** k;
  return 1e7;
}

/** Число в записи для графика: «4,9», «−2,5». */
export const numText = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');
