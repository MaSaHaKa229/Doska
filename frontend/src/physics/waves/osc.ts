/**
 * Колебания (этап 7.5a): чистые функции по школьным формулам. СИ.
 */

const rad = (d: number) => (d * Math.PI) / 180;

// =====================================================================
//  Математический маятник (малые колебания)
// =====================================================================

export interface Pendulum {
  omega: number;
  T: number;
  /** Угол отклонения, рад. */
  theta(t: number): number;
  /** Угловая скорость, рад/с. */
  dtheta(t: number): number;
  /** Натяжение нити: m(g cos θ + v²/l). */
  tension(t: number): number;
}

export function pendulum(l: number, g: number, amplitudeDeg: number, m: number): Pendulum {
  const omega = Math.sqrt(g / l);
  const a = rad(amplitudeDeg);
  const theta = (t: number) => a * Math.cos(omega * t);
  const dtheta = (t: number) => -a * omega * Math.sin(omega * t);
  return { omega, T: (2 * Math.PI) / omega, theta, dtheta, tension: (t) => m * (g * Math.cos(theta(t)) + l * dtheta(t) ** 2) };
}

// =====================================================================
//  Затухающие и вынужденные колебания
// =====================================================================

export interface Oscillator {
  omega0: number;
  /** Коэффициент затухания β = b/(2m). */
  beta: number;
  /** Частота затухающих колебаний (0 — апериодический режим). */
  omegaD: number;
  /** Свободные затухающие колебания из x(0) = A0, v(0) = 0 (при ω_d > 0). */
  free(t: number): number;
  envelope(t: number): number;
  /** Установившаяся амплитуда вынужденных колебаний A(ω). */
  amplitude(w: number): number;
  /** Сдвиг фазы φ(ω): x = A cos(ωt − φ). */
  phase(w: number): number;
  /** Резонансная частота (максимум A(ω)); 0, если резонанса нет. */
  resonance: number;
}

/** k — Н/м, m — кг, b — коэффициент сопротивления, кг/с, F0 — Н. */
export function oscillator(k: number, m: number, b: number, A0: number, F0: number): Oscillator {
  const omega0 = Math.sqrt(k / m);
  const beta = b / (2 * m);
  const wd2 = omega0 * omega0 - beta * beta;
  const omegaD = wd2 > 0 ? Math.sqrt(wd2) : 0;
  const amplitude = (w: number) => F0 / m / Math.sqrt((omega0 * omega0 - w * w) ** 2 + 4 * beta * beta * w * w);
  const r2 = omega0 * omega0 - 2 * beta * beta;
  return {
    omega0,
    beta,
    omegaD,
    free: (t) => (omegaD > 0 ? A0 * Math.exp(-beta * t) * (Math.cos(omegaD * t) + (beta / omegaD) * Math.sin(omegaD * t)) : A0 * Math.exp(-beta * t) * (1 + beta * t)),
    envelope: (t) => A0 * Math.exp(-beta * t),
    amplitude,
    phase: (w) => Math.atan2(2 * beta * w, omega0 * omega0 - w * w),
    resonance: r2 > 0 ? Math.sqrt(r2) : 0,
  };
}

// =====================================================================
//  Сложение колебаний одного направления (биения)
// =====================================================================

export interface Beats {
  x1(t: number): number;
  x2(t: number): number;
  sum(t: number): number;
  /** Частота биений |f₁ − f₂|, Гц. */
  fb: number;
}

export function beats(A1: number, f1: number, A2: number, f2: number): Beats {
  const x1 = (t: number) => A1 * Math.cos(2 * Math.PI * f1 * t);
  const x2 = (t: number) => A2 * Math.cos(2 * Math.PI * f2 * t);
  return { x1, x2, sum: (t) => x1(t) + x2(t), fb: Math.abs(f1 - f2) };
}

// =====================================================================
//  Колебательный контур
// =====================================================================

export interface LC {
  omega: number;
  T: number;
  q(t: number): number;
  i(t: number): number;
  /** Энергия электрического поля конденсатора и магнитного поля катушки, Дж. */
  wc(t: number): number;
  wl(t: number): number;
  W: number;
}

/** L — Гн, C — Ф, q0 — Кл. Формула Томсона: T = 2π√(LC). */
export function lc(L: number, C: number, q0: number): LC {
  const omega = 1 / Math.sqrt(L * C);
  const q = (t: number) => q0 * Math.cos(omega * t);
  const i = (t: number) => -q0 * omega * Math.sin(omega * t);
  return { omega, T: (2 * Math.PI) / omega, q, i, wc: (t) => q(t) ** 2 / (2 * C), wl: (t) => (L * i(t) ** 2) / 2, W: (q0 * q0) / (2 * C) };
}
