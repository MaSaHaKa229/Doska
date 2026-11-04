/**
 * Вероятность и статистика (этап 6.5d): опыты, формулы полной вероятности
 * и Байеса, распределения, описательная статистика. Чистые функции.
 */

// =====================================================================
//  Опыты: монета, кубик, урна
// =====================================================================

/** Псевдослучайные числа от зерна — серия опытов одинакова у всех участников. */
export function rng(seed: number): () => number {
  let a = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ExperimentKind = 'coin' | 'die' | 'urn';

export interface Experiment {
  /** Названия исходов и их вероятности. */
  outcomes: string[];
  probs: number[];
  /** Номера исходов, благоприятных событию A, и его описание. */
  favourable: number[];
  event: string;
}

/** Описание опыта. Для урны: red — красных, blue — синих шаров. */
export function experiment(kind: ExperimentKind, event: string, red: number, blue: number): Experiment {
  if (kind === 'coin') {
    return { outcomes: ['орёл', 'решка'], probs: [0.5, 0.5], favourable: event === 'tails' ? [1] : [0], event: event === 'tails' ? 'выпала решка' : 'выпал орёл' };
  }
  if (kind === 'die') {
    const outcomes = ['1', '2', '3', '4', '5', '6'];
    const fav = event === 'even' ? [1, 3, 5] : event === 'gt4' ? [4, 5] : [5];
    return { outcomes, probs: outcomes.map(() => 1 / 6), favourable: fav, event: event === 'even' ? 'выпало чётное число' : event === 'gt4' ? 'выпало больше 4' : 'выпала шестёрка' };
  }
  const total = red + blue;
  return { outcomes: ['красный', 'синий'], probs: [red / total, blue / total], favourable: event === 'blue' ? [1] : [0], event: event === 'blue' ? 'вынут синий шар' : 'вынут красный шар' };
}

/** Исходы первых n опытов серии (с возвращением шара). */
export function trials(e: Experiment, seed: number, n: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let u = r();
    let i = 0;
    while (i < e.probs.length - 1 && u >= e.probs[i]!) u -= e.probs[i++]!;
    out.push(i);
  }
  return out;
}

/** Классическая вероятность события: сумма вероятностей благоприятных исходов. */
export const eventProb = (e: Experiment) => e.favourable.reduce((s, i) => s + e.probs[i]!, 0);

// =====================================================================
//  Полная вероятность и формула Байеса
// =====================================================================

export interface TreeResult {
  /** P(A) = Σ P(Hᵢ)·P(A|Hᵢ). */
  pA: number;
  /** Произведения по ветвям и апостериорные P(Hᵢ|A). */
  joint: number[];
  posterior: number[];
  /** Сумма P(Hᵢ) — должна быть 1. */
  sumH: number;
}

export function tree(pH: number[], pAH: number[]): TreeResult {
  const joint = pH.map((p, i) => p * pAH[i]!);
  const pA = joint.reduce((s, v) => s + v, 0);
  return { pA, joint, posterior: joint.map((j) => (pA > 0 ? j / pA : 0)), sumH: pH.reduce((s, v) => s + v, 0) };
}

// =====================================================================
//  Распределения
// =====================================================================

export type DistKind = 'binomial' | 'poisson' | 'normal' | 'uniform';

export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i;
  return r;
}

export const binomialPmf = (n: number, p: number, k: number) => binom(n, k) * p ** k * (1 - p) ** (n - k);

export function poissonPmf(lambda: number, k: number): number {
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

/** Функция ошибок (Абрамовиц — Стиган 7.1.26, погрешность < 1,5·10⁻⁷). */
export function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export const normalPdf = (mu: number, sigma: number, x: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
export const normalCdf = (mu: number, sigma: number, x: number) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));

export interface DistParams {
  n: number;
  p: number;
  lambda: number;
  mu: number;
  sigma: number;
  a: number;
  b: number;
}

export interface DistInfo {
  discrete: boolean;
  /** Матожидание и дисперсия. */
  E: number;
  D: number;
  /** P(lo ≤ X ≤ hi). */
  prob(lo: number, hi: number): number;
  /** Плотность (непрерывные) или вероятность значения (дискретные). */
  f(x: number): number;
  /** Пределы для рисунка. */
  xMin: number;
  xMax: number;
  formula: string;
}

export function distribution(kind: DistKind, d: DistParams): DistInfo {
  if (kind === 'binomial') {
    const n = Math.round(d.n);
    return {
      discrete: true, E: n * d.p, D: n * d.p * (1 - d.p), xMin: 0, xMax: n,
      f: (k) => (Number.isInteger(k) ? binomialPmf(n, d.p, k) : 0),
      prob: (lo, hi) => { let s = 0; for (let k = Math.max(0, Math.ceil(lo - 1e-9)); k <= Math.min(n, Math.floor(hi + 1e-9)); k++) s += binomialPmf(n, d.p, k); return s; },
      formula: 'P(X = k) = Cₙᵏ·pᵏ·(1 − p)ⁿ⁻ᵏ;  E = np,  D = np(1 − p)',
    };
  }
  if (kind === 'poisson') {
    const top = Math.ceil(d.lambda + 4 * Math.sqrt(d.lambda) + 3);
    return {
      discrete: true, E: d.lambda, D: d.lambda, xMin: 0, xMax: top,
      f: (k) => (Number.isInteger(k) && k >= 0 ? poissonPmf(d.lambda, k) : 0),
      prob: (lo, hi) => { let s = 0; for (let k = Math.max(0, Math.ceil(lo - 1e-9)); k <= Math.floor(hi + 1e-9) && k <= top + 200; k++) s += poissonPmf(d.lambda, k); return s; },
      formula: 'P(X = k) = λᵏe^(−λ)/k!;  E = D = λ',
    };
  }
  if (kind === 'normal') {
    return {
      discrete: false, E: d.mu, D: d.sigma ** 2, xMin: d.mu - 4 * d.sigma, xMax: d.mu + 4 * d.sigma,
      f: (x) => normalPdf(d.mu, d.sigma, x),
      prob: (lo, hi) => Math.max(0, normalCdf(d.mu, d.sigma, hi) - normalCdf(d.mu, d.sigma, lo)),
      formula: 'f(x) = e^(−(x − μ)²/(2σ²)) / (σ√(2π));  E = μ,  D = σ²;  правило трёх сигм: P(|X − μ| < 3σ) ≈ 0,997',
    };
  }
  const w = d.b - d.a;
  return {
    discrete: false, E: (d.a + d.b) / 2, D: (w * w) / 12, xMin: d.a - w * 0.25, xMax: d.b + w * 0.25,
    f: (x) => (x >= d.a && x <= d.b && w > 0 ? 1 / w : 0),
    prob: (lo, hi) => (w > 0 ? Math.max(0, Math.min(hi, d.b) - Math.max(lo, d.a)) / w : 0),
    formula: 'f(x) = 1/(b − a) на [a; b];  E = (a + b)/2,  D = (b − a)²/12',
  };
}

// =====================================================================
//  Описательная статистика
// =====================================================================

/**
 * Данные → числа: «5; 7,5; 8» (с «;» запятая — десятичная), «5, 7,5, 8»
 * (запятая с пробелом — разделитель, без пробела — десятичная), «5,7,8» и
 * «5 7 8» — разделители. Ошибка — с указанием записи.
 */
export function parseData(src: string): number[] | { error: string } {
  const minus = src.replace(/[−–]/g, '-');
  const text = minus.includes(';') ? minus.replace(/,/g, '.') : /,\s/.test(minus) ? minus.replace(/(\d),(\d)/g, '$1.$2') : minus;
  const parts = text.split(/[\s;,]+/).filter(Boolean);
  if (!parts.length) return { error: 'нет данных' };
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v)) return { error: `«${p}» — не число` };
    out.push(v);
  }
  return out;
}

export interface Stats {
  n: number;
  mean: number;
  median: number;
  modes: number[];
  min: number;
  max: number;
  range: number;
  /** Дисперсия — среднее квадратов отклонений (как в школьном курсе); σ = √D. */
  variance: number;
  sd: number;
  q1: number;
  q3: number;
  /** Различные значения и их частоты (по возрастанию). */
  values: number[];
  counts: number[];
}

const medianOf = (s: number[]) => {
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};

export function stats(data: number[]): Stats {
  const s = [...data].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const values: number[] = [];
  const counts: number[] = [];
  for (const v of s) {
    if (values.length && values[values.length - 1] === v) counts[counts.length - 1]!++;
    else {
      values.push(v);
      counts.push(1);
    }
  }
  const top = Math.max(...counts);
  // Мода — значения с наибольшей частотой; если все встречаются одинаково часто, моды нет.
  const modes = top > 1 || values.length === 1 ? values.filter((_, i) => counts[i] === top) : [];
  // Квартили — медианы нижней и верхней половин (без медианы при нечётном n).
  const half = Math.floor(n / 2);
  const lower = s.slice(0, half);
  const upper = s.slice(n % 2 ? half + 1 : half);
  return {
    n, mean, median: medianOf(s), modes, min: s[0]!, max: s[n - 1]!, range: s[n - 1]! - s[0]!, variance, sd: Math.sqrt(variance),
    q1: lower.length ? medianOf(lower) : s[0]!, q3: upper.length ? medianOf(upper) : s[n - 1]!, values, counts,
  };
}

/** Гистограмма: k равных интервалов от min до max, последний — включая max. */
export function histogram(data: number[], k: number): { from: number; to: number; count: number }[] {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const w = (max - min) / k || 1;
  const bins = Array.from({ length: k }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const v of data) bins[Math.min(k - 1, Math.floor((v - min) / w))]!.count++;
  return bins;
}
