import type { BoardObject, ResolveContext } from '@doska/shared';
import { derivatives, parseCurve, type ParsedCurve } from './expr';
import { AXES_TYPE, CURVE_TYPE, frameOf, paramsOf, type CurveProps, type Frame } from './plot';

/**
 * Численный анализ функций графика (6.2b): корни, экстремумы, производная,
 * интеграл, суммы Римана, многочлен Тейлора, частичные суммы Фурье.
 */

export type Fn = (x: number) => number;

/** Функция графика y = f(x) с параметрами из слайдеров и кадр её осей; null — не функция или нет данных. */
export interface Graph {
  f: Fn;
  parsed: ParsedCurve;
  params: Record<string, number>;
  frame: Frame;
  curve: BoardObject;
}

export function graphOf(id: string, ctx: ResolveContext): Graph | null {
  const curve = ctx.getObject(id);
  if (!curve || curve.type !== CURVE_TYPE) return null;
  const axes = ctx.getObject(curve.deps[0] ?? '');
  if (!axes || axes.type !== AXES_TYPE) return null;
  const parsed = parseCurve((curve.props as unknown as CurveProps).text);
  if ('error' in parsed || parsed.kind !== 'function') return null;
  const params = paramsOf(curve, ctx);
  if (parsed.params.some((p) => !(p in params))) return null;
  return { f: (x) => parsed.f({ ...params, x }), parsed, params, frame: frameOf(axes), curve };
}

const ok = Number.isFinite;

/** Производная: символьная, если берётся, иначе центральная разность. */
export function derivativeAt(g: Graph, x: number, order = 1): number {
  const d = derivatives(g.parsed, order);
  if (d) {
    const v = d[order]!({ ...g.params, x });
    if (ok(v)) return v;
  }
  const h = 1e-4 * Math.max(1, Math.abs(x));
  if (order === 1) return (g.f(x + h) - g.f(x - h)) / (2 * h);
  return (g.f(x + h) - 2 * g.f(x) + g.f(x - h)) / (h * h);
}

/** Уточнение корня делением пополам (f(a) и f(b) разных знаков). */
function bisect(f: Fn, a: number, b: number): number {
  let fa = f(a);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

/**
 * Нули функции на отрезке: смены знака на сетке и касания (|f| мал в
 * локальном минимуме |f|). Разрыв со сменой знака (1/x) корнем не считается.
 */
export function roots(f: Fn, a: number, b: number, n = 1200): number[] {
  const out: number[] = [];
  const h = (b - a) / n;
  const add = (x: number) => {
    if (!out.some((y) => Math.abs(y - x) < h)) out.push(x);
  };
  let x0 = a;
  let y0 = f(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + i * h;
    const y1 = f(x1);
    if (ok(y0) && ok(y1)) {
      if (y0 === 0) add(x0);
      else if (Math.sign(y0) !== Math.sign(y1) && y1 !== 0) {
        const r = bisect(f, x0, x1);
        // Разрыв: значение у «корня» не мало.
        if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) add(r);
      }
    }
    x0 = x1;
    y0 = y1;
  }
  if (ok(y0) && y0 === 0) add(x0);
  // Касание оси (x² в нуле): локальный минимум |f| около нуля.
  for (const e of extrema(f, a, b, n)) if (Math.abs(f(e.x)) < 1e-7 && !out.some((y) => Math.abs(y - e.x) < h * 2)) out.push(e.x);
  return out.sort((p, q) => p - q);
}

/** Точки локального максимума и минимума (по смене знака производной). */
export function extrema(f: Fn, a: number, b: number, n = 1200): { x: number; y: number; kind: 'max' | 'min' }[] {
  const h = (b - a) / n;
  const d = (x: number) => (f(x + h / 10) - f(x - h / 10)) / (h / 5);
  const out: { x: number; y: number; kind: 'max' | 'min' }[] = [];
  let x0 = a + h;
  let d0 = d(x0);
  for (let i = 2; i < n; i++) {
    const x1 = a + i * h;
    const d1 = d(x1);
    if (ok(d0) && ok(d1) && Math.sign(d0) !== Math.sign(d1) && d0 !== 0) {
      const x = bisect(d, x0, x1);
      const y = f(x);
      // Острый пик разрыва (1/x²) отсекается: значения рядом конечны и близки.
      if (ok(y) && Math.abs(f(x - h) - y) < Math.abs(y) + 1e3 * h + 1) out.push({ x, y, kind: d0 > 0 ? 'max' : 'min' });
    }
    x0 = x1;
    d0 = d1;
  }
  return out;
}

/** Интеграл (Симпсон); NaN — функция не определена на части отрезка. */
export function integrate(f: Fn, a: number, b: number, n = 600): number {
  if (a === b) return 0;
  const m = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

export type RiemannMethod = 'left' | 'right' | 'mid' | 'trap';

/** Сумма Римана и её прямоугольники (трапеции): x, ширина, высоты слева и справа. */
export function riemann(f: Fn, a: number, b: number, n: number, method: RiemannMethod): { sum: number; parts: { x: number; w: number; y0: number; y1: number }[] } {
  const w = (b - a) / n;
  const parts: { x: number; w: number; y0: number; y1: number }[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = a + i * w;
    if (method === 'trap') {
      const y0 = f(x);
      const y1 = f(x + w);
      parts.push({ x, w, y0, y1 });
      sum += ((y0 + y1) / 2) * w;
    } else {
      const y = f(method === 'left' ? x : method === 'right' ? x + w : x + w / 2);
      parts.push({ x, w, y0: y, y1: y });
      sum += y * w;
    }
  }
  return { sum, parts };
}

/** Многочлен Тейлора степени n в точке x0; null — производные не берутся. */
export function taylor(g: Graph, x0: number, n: number): { p: Fn; coeffs: number[] } | null {
  const d = derivatives(g.parsed, n);
  let coeffs: number[];
  if (d) coeffs = d.map((fk, k) => fk({ ...g.params, x: x0 }) / factorial(k));
  else return null;
  if (!coeffs.every(ok)) return null;
  return { coeffs, p: (x) => coeffs.reduce((s, c, k) => s + c * (x - x0) ** k, 0) };
}

const factorial = (k: number): number => (k <= 1 ? 1 : k * factorial(k - 1));

/**
 * Частичная сумма ряда Фурье по периоду [a; b] (функция продолжается
 * периодически): S_n(x) = a₀/2 + Σ aₖ cos(kωx) + bₖ sin(kωx).
 */
export function fourier(f: Fn, a: number, b: number, n: number): { s: Fn; a0: number; ak: number[]; bk: number[] } {
  const T = b - a;
  const w = (2 * Math.PI) / T;
  const N = 2000;
  const xs = Array.from({ length: N + 1 }, (_, i) => a + (T * i) / N);
  const ys = xs.map((x) => (ok(f(x)) ? f(x) : 0));
  const simpson = (g: (i: number) => number) => {
    let s = g(0) + g(N);
    for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * g(i);
    return ((s * (T / N)) / 3) * (2 / T);
  };
  const a0 = simpson((i) => ys[i]!);
  const ak: number[] = [];
  const bk: number[] = [];
  for (let k = 1; k <= n; k++) {
    ak.push(simpson((i) => ys[i]! * Math.cos(k * w * xs[i]!)));
    bk.push(simpson((i) => ys[i]! * Math.sin(k * w * xs[i]!)));
  }
  return { a0, ak, bk, s: (x) => a0 / 2 + ak.reduce((s, c, i) => s + c * Math.cos((i + 1) * w * x) + bk[i]! * Math.sin((i + 1) * w * x), 0) };
}
