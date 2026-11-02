import { useEffect, useState } from 'react';
import type { MathNode, MathJsInstance } from 'mathjs';

/**
 * Выражения графиков на math.js. Библиотека грузится отдельной частью при
 * первом графике на доске (`loadMath`); до загрузки графики не рисуются.
 */

let math: MathJsInstance | null = null;
let loading: Promise<void> | null = null;
const waiters = new Set<() => void>();

export function loadMath(): Promise<void> {
  loading ??= import('mathjs').then(({ create, all }) => {
    const m = create(all!, { number: 'number' });
    // Выражения с доски не должны менять сам math.js.
    const blocked = (name: string) => () => {
      throw new Error(`Функция ${name} недоступна`);
    };
    m.import(Object.fromEntries(['import', 'createUnit', 'evaluate', 'compile', 'simplify', 'derivative', 'resolve', 'reviver'].map((n) => [n, blocked(n)])), { override: true });
    math = m;
    waiters.forEach((w) => w());
    waiters.clear();
  });
  return loading;
}

export const mathReady = () => !!math;

/** Перерисовка компонента, когда math.js загрузится. */
export function useMathReady(): boolean {
  const [ready, setReady] = useState(mathReady());
  useEffect(() => {
    if (ready) return;
    const w = () => setReady(true);
    waiters.add(w);
    void loadMath();
    return () => {
      waiters.delete(w);
    };
  }, [ready]);
  return ready;
}

/** Переменные, которые не являются параметрами. */
const VARIABLES = new Set(['x', 'y', 't']);
const CONSTANTS = new Set(['pi', 'e', 'E', 'PI', 'Infinity', 'i']);

export type CurveKind = 'function' | 'parametric' | 'polar' | 'implicit' | 'inequality';
export type Relation = '<' | '<=' | '>' | '>=';

type Fn = (scope: Record<string, number>) => number;

export interface ParsedCurve {
  kind: CurveKind;
  /** function/polar: f(x) / r(t); implicit/inequality: F(x, y) (левая − правая часть); parametric: x(t). */
  f: Fn;
  /** parametric: y(t). */
  g?: Fn;
  relation?: Relation;
  /** Параметры (a, b, k…) — их значения дают слайдеры. */
  params: string[];
  /** Запись для подписи графика. */
  caption: string;
}

export const KIND_TITLES: Record<CurveKind, string> = {
  function: 'Функция y = f(x)',
  parametric: 'Параметрическая кривая (x(t); y(t))',
  polar: 'Кривая в полярных координатах r(t)',
  implicit: 'Кривая F(x, y) = 0',
  inequality: 'Неравенство (область закрашена)',
};

/** Школьная запись → math.js: запятая, ×, √, ², tg, ln, θ… */
export function prepare(src: string): string {
  return src
    .replace(/[×·∙⋅]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/π/g, 'pi')
    .replace(/[θφ]/g, 't')
    .replace(/√\s*(\d+(?:[.,]\d+)?|[A-Za-z]\w*)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/\b(arcctg|arctg|ctg|tg|lg|ln)\b/g, (w) => ({ tg: 'tan', ctg: 'cot', arctg: 'atan', arcctg: 'acot', lg: 'log10', ln: 'log' })[w]!)
    .trim();
}

class ParseError extends Error {}

function compile(m: MathJsInstance, src: string): { fn: Fn; node: MathNode } {
  let node: MathNode;
  try {
    node = m.parse(src);
  } catch {
    throw new ParseError('Ошибка в записи');
  }
  const code = node.compile();
  return {
    node,
    fn: (scope) => {
      try {
        const v = code.evaluate({ ...scope });
        return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
      } catch {
        return NaN;
      }
    },
  };
}

function symbols(nodes: MathNode[]): string[] {
  const fnNames = new Set<string>();
  const out = new Set<string>();
  for (const n of nodes) {
    n.traverse((x) => {
      const f = x as unknown as { type: string; fn?: { name?: string }; name?: string };
      if (f.type === 'FunctionNode' && f.fn?.name) fnNames.add(f.fn.name);
    });
    n.traverse((x) => {
      const s = x as unknown as { type: string; name: string };
      if (s.type === 'SymbolNode' && !fnNames.has(s.name) && !VARIABLES.has(s.name) && !CONSTANTS.has(s.name)) out.add(s.name);
    });
  }
  return [...out].sort();
}

const cache = new Map<string, ParsedCurve | { error: string }>();

/**
 * Разбор записи графика. Вид определяется по записи:
 *   x^2 − 2x, y = sin(x), f(x) = …     → функция
 *   (cos(t); sin(t))                    → параметрическая
 *   r = 1 + cos(t)                      → полярная
 *   x^2 + y^2 = 25                      → неявная
 *   y > x^2, x^2 + y^2 <= 9             → неравенство
 */
export function parseCurve(text: string): ParsedCurve | { error: string } {
  if (!math) return { error: 'Загрузка…' };
  const key = text;
  const hit = cache.get(key);
  if (hit) return hit;
  let res: ParsedCurve | { error: string };
  try {
    res = parseUncached(math, text);
  } catch (e) {
    res = { error: e instanceof ParseError ? e.message : 'Ошибка в записи' };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, res);
  return res;
}

function parseUncached(m: MathJsInstance, text: string): ParsedCurve {
  const src = prepare(text);
  if (!src) throw new ParseError('Введите функцию или уравнение');
  if (src.length > 300) throw new ParseError('Слишком длинная запись');
  const caption = text.trim();
  // Параметрическая: (x(t); y(t)).
  const par = /^\(\s*([^;]+);([^;]+)\)$/.exec(src);
  if (par) {
    const x = compile(m, par[1]!);
    const y = compile(m, par[2]!);
    return { kind: 'parametric', f: x.fn, g: y.fn, params: symbols([x.node, y.node]), caption };
  }
  const rel = /(<=|>=|<|>)/.exec(src);
  if (rel) {
    const [lhs, rhs] = [src.slice(0, rel.index), src.slice(rel.index + rel[0].length)];
    if (!lhs.trim() || !rhs.trim() || /<|>/.test(rhs)) throw new ParseError('Неравенство: одна часть слева, одна справа');
    const l = compile(m, lhs);
    const r = compile(m, rhs);
    return { kind: 'inequality', f: (s) => l.fn(s) - r.fn(s), relation: rel[0] as Relation, params: symbols([l.node, r.node]), caption };
  }
  const parts = src.split('=');
  if (parts.length > 2) throw new ParseError('Знак «=» встречается больше одного раза');
  if (parts.length === 2) {
    const [lhs, rhs] = parts.map((p) => p.trim()) as [string, string];
    if (/^r$/.test(lhs)) {
      const r = compile(m, rhs);
      return { kind: 'polar', f: r.fn, params: symbols([r.node]), caption };
    }
    if (/^(y|[a-zA-Z]\s*\(\s*x\s*\))$/.test(lhs)) {
      const f = compile(m, rhs);
      return { kind: 'function', f: f.fn, params: symbols([f.node]), caption };
    }
    if (rhs === 'y') {
      const f = compile(m, lhs);
      return { kind: 'function', f: f.fn, params: symbols([f.node]), caption };
    }
    const l = compile(m, lhs);
    const r = compile(m, rhs);
    return { kind: 'implicit', f: (s) => l.fn(s) - r.fn(s), params: symbols([l.node, r.node]), caption };
  }
  const f = compile(m, src);
  return { kind: 'function', f: f.fn, params: symbols([f.node]), caption: `y = ${caption}` };
}

/** Подходящий шаг делений: 1, 2, 5 × 10ⁿ не меньше минимального. */
export function niceStep(min: number): number {
  const p = 10 ** Math.floor(Math.log10(min));
  for (const k of [1, 2, 5, 10]) if (k * p >= min) return k * p;
  return 10 * p;
}

/** Число для подписи делений и значений: запятая, без лишних нулей. */
export function fmtNum(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  const r = Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(digits));
  return String(r).replace('.', ',').replace('-', '−');
}
