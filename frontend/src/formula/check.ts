import { create, all, type MathNode } from 'mathjs';
import { splitEquation } from './latex-to-mathjs';

const math = create(all!, { number: 'number' });

/** Результат проверки перехода от шага к шагу. */
export type StepCheck = 'ok' | 'bad' | 'unknown';

const CONSTANTS = new Set(['pi', 'e']);
const SAMPLES = 8;

/** Детерминированный генератор (одинаковые отметки у всех участников). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Compiled {
  vars: Set<string>;
  /** f(x): выражение или «левая − правая» для уравнения. */
  f: (scope: Record<string, number>) => number;
  equation: boolean;
}

function compileStep(latex: string): Compiled | null {
  const parts = splitEquation(latex.trim());
  if (!parts) return null;
  const src = parts.rhs === null ? parts.lhs : `(${parts.lhs}) - (${parts.rhs})`;
  let node: MathNode;
  try {
    node = math.parse(src);
  } catch {
    return null;
  }
  const vars = new Set<string>();
  const fnNames = new Set<string>();
  node.traverse((n) => {
    if ((n as { type: string }).type === 'FunctionNode') fnNames.add((n as unknown as { fn: { name: string } }).fn.name);
  });
  node.traverse((n) => {
    const s = n as unknown as { type: string; name: string };
    if (s.type === 'SymbolNode' && !fnNames.has(s.name) && !CONSTANTS.has(s.name)) vars.add(s.name);
  });
  const code = node.compile();
  return {
    vars,
    equation: parts.rhs !== null,
    f: (scope) => {
      const v = code.evaluate({ ...scope });
      return typeof v === 'number' ? v : NaN;
    },
  };
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Проверка перехода «шаг A → шаг B» подстановкой случайных значений.
 *  - выражения: равны в точках → ok, различаются → bad;
 *  - уравнения: «левая − правая» пропорциональны (перенос слагаемых,
 *    умножение на число, деление на общий множитель) → ok; иначе — unknown
 *    (возведение в квадрат, логарифмирование и т. п. автоматически не
 *    проверяются, это не обязательно ошибка);
 *  - что-то не разобралось или смешаны выражение и уравнение → unknown.
 */
export function checkTransition(a: string, b: string, seed = 1): StepCheck {
  const A = compileStep(a);
  const B = compileStep(b);
  if (!A || !B || A.equation !== B.equation) return 'unknown';
  const vars = [...new Set([...A.vars, ...B.vars])];
  const rand = rng(seed + vars.length * 7919);
  let valid = 0;
  let ratio: number | null = null;
  let bothZero = 0;
  for (let k = 0; k < SAMPLES * 4 && valid < SAMPLES; k++) {
    const scope = Object.fromEntries(vars.map((v) => [v, 0.5 + rand() * 3]));
    let fa: number;
    let fb: number;
    try {
      fa = A.f(scope);
      fb = B.f(scope);
    } catch {
      continue;
    }
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
    valid++;
    if (!A.equation) {
      if (!close(fa, fb)) return 'bad';
      continue;
    }
    if (close(fa, 0) && close(fb, 0)) {
      bothZero++;
      continue;
    }
    if (close(fb, 0) || close(fa, 0)) return 'unknown';
    const r = fa / fb;
    if (ratio === null) ratio = r;
    else if (!close(r, ratio)) return 'unknown';
  }
  if (valid < 3) return 'unknown';
  if (A.equation && ratio === null && bothZero < valid) return 'unknown';
  return 'ok';
}

/** Отметки для всех переходов: result[i] — переход от шага i к шагу i+1. */
export function checkSteps(latex: string[]): StepCheck[] {
  const out: StepCheck[] = [];
  for (let i = 0; i + 1 < latex.length; i++) {
    out.push(latex[i]!.trim() && latex[i + 1]!.trim() ? checkTransition(latex[i]!, latex[i + 1]!, i + 1) : 'unknown');
  }
  return out;
}
