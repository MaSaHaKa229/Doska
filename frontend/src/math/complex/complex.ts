/**
 * Комплексные числа (этап 6.5c): действия, формы записи, степени и корни.
 * Чистые функции; разбор условий областей — через math.js (передаётся снаружи).
 */

import type { MathJsInstance } from 'mathjs';
import { prepare } from '../analysis/expr';

export interface Cx {
  re: number;
  im: number;
}

export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
export const abs = (a: Cx) => Math.hypot(a.re, a.im);
/** Аргумент в (−π; π]. */
export const arg = (a: Cx) => Math.atan2(a.im, a.re);

/** Деление; null — на ноль. */
export function div(a: Cx, b: Cx): Cx | null {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return null;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export const polar = (r: number, phi: number): Cx => ({ re: r * Math.cos(phi), im: r * Math.sin(phi) });

/** Формула Муавра: zⁿ = rⁿ(cos nφ + i sin nφ). */
export const power = (a: Cx, n: number): Cx => polar(abs(a) ** n, arg(a) * n);

/** Корни n-й степени: ⁿ√r·(cos((φ + 2πk)/n) + i sin((φ + 2πk)/n)), k = 0…n − 1. */
export function roots(a: Cx, n: number): Cx[] {
  const r = abs(a) ** (1 / n);
  const phi = arg(a);
  return Array.from({ length: n }, (_, k) => polar(r, (phi + 2 * Math.PI * k) / n));
}

// =====================================================================
//  Запись
// =====================================================================

/** Число по-русски, без «−0». */
export function num(v: number, digits = 3): string {
  const r = Number(v.toPrecision(digits));
  const t = Math.abs(r) < 1e-12 ? 0 : r;
  return String(t).replace('.', ',').replace('-', '−');
}

/** Алгебраическая форма: «3 + 2i», «−i», «4», «2,5 − 0,5i». */
export function algebraic(z: Cx, digits = 3): string {
  const re = Math.abs(z.re) < 1e-10 ? 0 : z.re;
  const im = Math.abs(z.im) < 1e-10 ? 0 : z.im;
  const imPart = (v: number) => (Math.abs(Math.abs(v) - 1) < 1e-12 ? 'i' : `${num(Math.abs(v), digits)}i`);
  if (im === 0) return num(re, digits);
  if (re === 0) return `${im < 0 ? '−' : ''}${imPart(im)}`;
  return `${num(re, digits)} ${im < 0 ? '−' : '+'} ${imPart(im)}`;
}

/** Угол как доля π, если он «круглый» (кратен π/12): «π/4», «−2π/3», иначе null. */
export function piFraction(phi: number): string | null {
  const k = (phi / Math.PI) * 12;
  const r = Math.round(k);
  if (Math.abs(k - r) > 1e-9) return null;
  if (r === 0) return '0';
  const g = gcd(Math.abs(r), 12);
  const p = r / g;
  const q = 12 / g;
  const top = Math.abs(p) === 1 ? 'π' : `${Math.abs(p)}π`;
  return `${p < 0 ? '−' : ''}${top}${q === 1 ? '' : `/${q}`}`;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Угол: «π/4» или «0,588» (рад) и градусы. */
export function angleText(phi: number): { rad: string; deg: string } {
  return { rad: piFraction(phi) ?? num(phi), deg: `${num((phi * 180) / Math.PI, 4)}°` };
}

export interface Forms {
  alg: string;
  trig: string;
  exp: string;
  r: number;
  phi: number;
}

/** Три формы записи: алгебраическая, тригонометрическая, показательная. */
export function forms(z: Cx): Forms {
  const r = abs(z);
  const phi = arg(z);
  const a = angleText(phi);
  const rt = num(r);
  return {
    alg: algebraic(z),
    trig: r === 0 ? '0' : `${rt === '1' ? '' : rt}(cos ${a.rad} + i·sin ${a.rad})`,
    exp: r === 0 ? '0' : `${rt === '1' ? '' : rt}e^(i·${a.rad})`,
    r,
    phi,
  };
}

// =====================================================================
//  Множества на плоскости
// =====================================================================

/**
 * Условие на z → math.js: |…| → abs(…), Re/Im/arg → re/im/arg, «и»/«или»,
 * школьная запись (≤, π, √). Возвращает функцию (x, y) → выполнено ли.
 */
export function compileRegion(m: MathJsInstance, src: string): ((x: number, y: number) => boolean) | { error: string } {
  let text = prepare(src)
    .replace(/\bRe\b/g, 're')
    .replace(/\bIm\b/g, 'im')
    .replace(/\bArg\b/g, 'arg')
    .replace(/\s+и\s+|\s*∧\s*|\s*&&?\s*/g, ' and ')
    .replace(/\s+или\s+|\s*∨\s*|\s*\|\|\s*/g, ' or ')
    .replace(/(re|im|arg)\s+z\b/g, '$1(z)');
  // |…| без вложенности — модуль.
  for (let k = 0; k < 4 && /\|[^|]+\|/.test(text); k++) text = text.replace(/\|([^|]+)\|/g, 'abs($1)');
  if (text.includes('|')) return { error: 'непарные знаки модуля |…|' };
  if (!text) return { error: 'пустое условие' };
  let code: { evaluate: (s: Record<string, unknown>) => unknown };
  try {
    const node = m.parse(text);
    let bad: string | null = null;
    const fnNames = new Set<string>();
    node.traverse((n) => {
      const f = n as unknown as { type: string; fn?: { name?: string } };
      if (f.type === 'FunctionNode' && f.fn?.name) fnNames.add(f.fn.name);
    });
    node.traverse((n) => {
      const s = n as unknown as { type: string; name: string };
      if (s.type === 'SymbolNode' && !fnNames.has(s.name) && !['z', 'x', 'y', 'i', 'pi', 'e'].includes(s.name)) bad ??= s.name;
    });
    if (bad) return { error: `неизвестное обозначение «${bad}»: пишите через z (или x, y)` };
    code = node.compile();
  } catch {
    return { error: 'ошибка в записи условия' };
  }
  const probe = (() => {
    try {
      return code.evaluate({ z: m.complex(0.3, 0.7), x: 0.3, y: 0.7 });
    } catch (e) {
      return e;
    }
  })();
  if (typeof probe !== 'boolean') return { error: 'нужно условие: сравнение (<, ≤, >, ≥, =), можно с «и», «или»' };
  return (x, y) => {
    try {
      return code.evaluate({ z: m.complex(x, y), x, y }) === true;
    } catch {
      return false;
    }
  };
}
