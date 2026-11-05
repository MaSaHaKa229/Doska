import type { MathJsInstance, MathNode } from 'mathjs';
import { differentiate, prepare } from '../analysis/expr';
import { marchingSquares } from '../analysis/plot';

/**
 * Функции нескольких переменных и векторный анализ (этап 6.5a): разбор
 * f(x, y), частные производные, линии уровня, линии тока, дивергенция и
 * ротор, проекция поверхности. Чистые функции; math.js передаётся снаружи.
 */

export type F2 = (x: number, y: number) => number;

export interface Compiled {
  f: F2;
  /** Частные производные: символьные (запись) и вычисляемые. */
  fx: F2;
  fy: F2;
  dxText: string | null;
  dyText: string | null;
}

const ALLOWED = new Set(['x', 'y', 'pi', 'e', 'E', 'PI']);

function toFn(node: MathNode): F2 {
  const code = node.compile();
  return (x, y) => {
    try {
      const v = code.evaluate({ x, y });
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

/** Численная производная (центральная разность) — если символьная не получилась. */
const numeric = (f: F2, byX: boolean): F2 => (x, y) => {
  const h = 1e-5 * Math.max(1, Math.abs(byX ? x : y));
  return byX ? (f(x + h, y) - f(x - h, y)) / (2 * h) : (f(x, y + h) - f(x, y - h)) / (2 * h);
};

const cache = new Map<string, Compiled | { error: string }>();

/** Разбор записи f(x, y): «x^2 − y^2», «sin(x)·cos(y)», «√(x² + y²)». */
export function compile2(m: MathJsInstance, src: string): Compiled | { error: string } {
  const key = src;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = ((): Compiled | { error: string } => {
    const text = prepare(src.replace(/^\s*[a-zA-Z]\s*\(\s*x\s*[,;]\s*y\s*\)\s*=/, '').replace(/^\s*z\s*=/, ''));
    if (!text) return { error: 'пустая запись' };
    let node: MathNode;
    try {
      node = m.parse(text);
    } catch {
      return { error: 'ошибка в записи' };
    }
    const fnNames = new Set<string>();
    node.traverse((n) => {
      const f = n as unknown as { type: string; fn?: { name?: string } };
      if (f.type === 'FunctionNode' && f.fn?.name) fnNames.add(f.fn.name);
    });
    let bad: string | null = null;
    node.traverse((n) => {
      const s = n as unknown as { type: string; name: string };
      if (s.type === 'SymbolNode' && !fnNames.has(s.name) && !ALLOWED.has(s.name)) bad ??= s.name;
    });
    if (bad) return { error: `неизвестное обозначение «${bad}»${/^[xy]{2,}$/.test(bad) ? ' — пишите x·y' : ''}` };
    const f = toFn(node);
    const dxText = differentiate(text, 'x');
    const dyText = differentiate(text, 'y');
    const fromText = (t: string | null, byX: boolean): F2 => {
      if (t) {
        try {
          return toFn(m.parse(t));
        } catch {
          // ниже — численно
        }
      }
      return numeric(f, byX);
    };
    return { f, fx: fromText(dxText, true), fy: fromText(dyText, false), dxText, dyText };
  })();
  if (cache.size > 200) cache.clear();
  cache.set(key, res);
  return res;
}

// =====================================================================
//  Сетка значений, линии уровня
// =====================================================================

export interface Range2 {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Grid {
  n: number;
  /** v[i][j] — значение в узле (xMin + i·dx, yMin + j·dy). */
  v: number[][];
  min: number;
  max: number;
}

export function sampleGrid(f: F2, r: Range2, n: number): Grid {
  const v: number[][] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= n; i++) {
    const col: number[] = [];
    for (let j = 0; j <= n; j++) {
      const z = f(r.xMin + ((r.xMax - r.xMin) * i) / n, r.yMin + ((r.yMax - r.yMin) * j) / n);
      col.push(z);
      if (Number.isFinite(z)) {
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
    }
    v.push(col);
  }
  return { n, v, min, max };
}

/** «Красивые» уровни внутри (min, max): около count штук с круглым шагом. */
export function levels(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [];
  const raw = (max - min) / count;
  const e = 10 ** Math.floor(Math.log10(raw));
  const m = raw / e;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  const out: number[] = [];
  for (let c = Math.ceil(min / step) * step; c < max; c += step) if (c > min) out.push(Math.round(c / step) * step);
  return out;
}

/** Линия уровня f = c — отрезки x1, y1, x2, y2 в координатах функции. */
export function contour(g: Grid, r: Range2, c: number): number[] {
  const shifted = g.v.map((col) => col.map((z) => z - c));
  return marchingSquares(shifted, g.n, g.n, (i, j) => ({ x: r.xMin + ((r.xMax - r.xMin) * i) / g.n, y: r.yMin + ((r.yMax - r.yMin) * j) / g.n }));
}

// =====================================================================
//  Векторное поле
// =====================================================================

export interface FieldAt {
  P: number;
  Q: number;
  /** Дивергенция ∂P/∂x + ∂Q/∂y и ротор (z-составляющая) ∂Q/∂x − ∂P/∂y. */
  div: number;
  rot: number;
}

export function fieldAt(P: Compiled, Q: Compiled, x: number, y: number): FieldAt {
  return { P: P.f(x, y), Q: Q.f(x, y), div: P.fx(x, y) + Q.fy(x, y), rot: Q.fx(x, y) - P.fy(x, y) };
}

/** Смысл дивергенции и ротора одной фразой. */
export function fieldMeaning(div: number, rot: number, eps = 1e-6): string {
  const d = Math.abs(div) < eps ? 'div = 0 — поток через малый контур равен нулю' : div > 0 ? 'div > 0 — источник: поле «вытекает» из точки' : 'div < 0 — сток: поле «втекает» в точку';
  const r = Math.abs(rot) < eps ? 'rot = 0 — без вращения' : rot > 0 ? 'rot > 0 — вращение против часовой стрелки' : 'rot < 0 — вращение по часовой стрелке';
  return `${d}; ${r}`;
}

/**
 * Линия тока: решение x′ = P, y′ = Q методом Рунге — Кутты с шагом h по
 * длине дуги (направление нормируется), в обе стороны от начальной точки.
 */
export function streamline(P: F2, Q: F2, x0: number, y0: number, r: Range2, h: number, maxSteps = 400): [number, number][] {
  const dir = (x: number, y: number, s: number): [number, number] | null => {
    const p = P(x, y);
    const q = Q(x, y);
    const l = Math.hypot(p, q);
    if (!Number.isFinite(l) || l < 1e-9) return null;
    return [(s * p) / l, (s * q) / l];
  };
  const inside = (x: number, y: number) => x >= r.xMin && x <= r.xMax && y >= r.yMin && y <= r.yMax;
  const run = (s: number) => {
    const pts: [number, number][] = [];
    let x = x0;
    let y = y0;
    for (let k = 0; k < maxSteps; k++) {
      const k1 = dir(x, y, s);
      if (!k1) break;
      const k2 = dir(x + (h / 2) * k1[0], y + (h / 2) * k1[1], s);
      if (!k2) break;
      const k3 = dir(x + (h / 2) * k2[0], y + (h / 2) * k2[1], s);
      if (!k3) break;
      const k4 = dir(x + h * k3[0], y + h * k3[1], s);
      if (!k4) break;
      x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      if (!inside(x, y)) break;
      pts.push([x, y]);
      // Замкнулась (вихрь): дальше идти незачем.
      if (k > 10 && Math.hypot(x - x0, y - y0) < h * 0.6) break;
    }
    return pts;
  };
  const back = run(-1).reverse();
  return [...back, [x0, y0], ...run(1)];
}

// =====================================================================
//  Поверхность: проекция
// =====================================================================

export interface View3 {
  /** Поворот вокруг оси z и наклон взгляда (градусы). */
  yaw: number;
  pitch: number;
}

/** Ортогональная проекция: экранные координаты (вправо, вверх) и глубина (больше — дальше). */
export function project(v: View3, x: number, y: number, z: number): { u: number; up: number; depth: number } {
  const a = (v.yaw * Math.PI) / 180;
  const p = (v.pitch * Math.PI) / 180;
  const u = x * Math.cos(a) - y * Math.sin(a);
  const w = x * Math.sin(a) + y * Math.cos(a);
  return { u, up: z * Math.cos(p) + w * Math.sin(p), depth: w * Math.cos(p) - z * Math.sin(p) };
}

/** Пределы по z для рисунка: без выбросов (2 % с краёв), чтобы полюса не сплющивали поверхность. */
export function zRange(g: Grid): [number, number] {
  const all = g.v.flat().filter(Number.isFinite).sort((a, b) => a - b);
  if (!all.length) return [-1, 1];
  const lo = all[Math.floor(all.length * 0.02)]!;
  const hi = all[Math.min(all.length - 1, Math.ceil(all.length * 0.98))]!;
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

/** Цвет по высоте: синий — низко, красный — высоко; light ∈ [0, 1] — освещённость. */
export function heightColor(t: number, light = 1): string {
  const s = Math.max(0, Math.min(1, t));
  const hue = 240 - 240 * s;
  return `hsl(${hue.toFixed(0)}, 70%, ${(28 + 40 * light).toFixed(0)}%)`;
}

/** Формат числа для подписей. */
export function num(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toPrecision(digits));
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',').replace('-', '−');
}

/** Запись math.js → школьная: «2 * x» → «2x», «^» оставляем. */
export function pretty(t: string | null): string {
  if (!t) return '—';
  return t.replace(/\s*\*\s*/g, '·').replace(/(\d)·([a-z(])/g, '$1$2').replace(/-/g, '−').replace(/\bpi\b/g, 'π');
}
