/**
 * Перевод LaTeX школьных и вузовских выражений в синтаксис math.js — для
 * числовой проверки шагов решения и калькулятора. Поддерживается частое
 * подмножество: числа, переменные (в том числе с индексами и греческие),
 * + − · × ÷, дроби, корни, степени, скобки всех видов, модуль, факториал,
 * элементарные функции, π и e. Для остального (знаки неравенств, ±, ∞,
 * суммы, интегралы, матрицы…) возвращается null — такое выражение просто не
 * проверяется.
 */

const FUNCTIONS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  tg: 'tan',
  cot: 'cot',
  ctg: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arctg: 'atan',
  arccot: 'acot',
  arcctg: 'acot',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  exp: 'exp',
  ln: 'log',
  lg: 'log10',
};

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);

/** Пробелы и оформление, не влияющие на значение. */
const IGNORED = new Set([',', ';', '!', ':', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'limits']);

class Unsupported extends Error {}

type Tok = { t: 'cmd'; v: string } | { t: 'ch'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      let j = i + 1;
      if (/[a-zA-Z]/.test(src[j] ?? '')) {
        while (/[a-zA-Z]/.test(src[j] ?? '')) j++;
      } else j++;
      out.push({ t: 'cmd', v: src.slice(i + 1, j) });
      i = j;
    } else if (/\s/.test(c)) i++;
    else {
      out.push({ t: 'ch', v: c });
      i++;
    }
  }
  return out;
}

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new Unsupported('конец выражения');
    return t;
  }

  done(): boolean {
    return this.i >= this.toks.length;
  }

  /** Последовательность до закрывающего символа (не включая его). */
  seq(close: string | null): string {
    const parts: string[] = [];
    while (!this.done()) {
      const t = this.peek()!;
      if (t.t === 'ch' && close !== null && t.v === close) break;
      if (t.t === 'ch' && t.v === '|') {
        // |…| — модуль: группа до парной черты.
        this.i++;
        const inner = this.seq('|');
        if (this.peek()?.v !== '|') throw new Unsupported('нет закрывающей черты');
        this.i++;
        parts.push(this.postfix(`abs(${inner})`));
        continue;
      }
      parts.push(this.item());
    }
    // Соседние операнды — умножение (2x, x(y+1), 2\sin x). Явный знак нужен:
    // в math.js «x (y+1)» означало бы вызов функции x.
    let out = '';
    let prevOperand = false;
    for (const p of parts) {
      if (!p.trim()) continue;
      const isOp = /^\s*[+\-*/]\s*$/.test(p);
      if (!isOp && prevOperand) out += ' * ';
      out += p;
      prevOperand = !isOp;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /** Операция или операнд (с постфиксами ^, _, !). */
  private item(): string {
    const t = this.next();
    if (t.t === 'ch') {
      const v = t.v;
      if ('+-*/'.includes(v)) return ` ${v} `;
      if (v === '=') throw new Unsupported('знак равенства внутри части');
      if (v === '<' || v === '>') throw new Unsupported('неравенство');
      if (OPEN[v]) {
        const inner = this.seq(OPEN[v]!);
        if (this.next().v !== OPEN[v]) throw new Unsupported('скобки');
        return this.postfix(`(${inner})`);
      }
      if (/[0-9.]/.test(v)) {
        let num = v;
        while (/[0-9.]/.test(this.peek()?.v ?? '') && this.peek()!.t === 'ch') num += this.next().v;
        // Десятичная запятая: 2{,}5 или 2,5 между цифрами.
        const at = (k: number) => this.toks[this.i + k]?.v ?? '';
        const braced = at(0) === '{' && at(1) === ',' && at(2) === '}' && /[0-9]/.test(at(3));
        if (braced || (at(0) === ',' && /[0-9]/.test(at(1)))) {
          this.i += braced ? 3 : 1;
          num += '.';
          while (/[0-9]/.test(this.peek()?.v ?? '') && this.peek()!.t === 'ch') num += this.next().v;
        }
        return this.postfix(num);
      }
      if (/[a-zA-Z]/.test(v)) return this.postfix(this.subscript(v));
      if (v === "'") throw new Unsupported('штрих (производная)');
      throw new Unsupported(`символ ${v}`);
    }
    const c = t.v;
    if (IGNORED.has(c)) {
      // \left( … \right) — скобки обрабатываются по самому символу.
      return '';
    }
    if (c === 'cdot' || c === 'times' || c === 'ast') return ' * ';
    if (c === 'div') return ' / ';
    if (c === 'pi') return this.postfix('pi');
    if (c === '{' || c === '}') throw new Unsupported('фигурные скобки');
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') {
      const a = this.group();
      const b = this.group();
      return this.postfix(`((${a}) / (${b}))`);
    }
    if (c === 'sqrt') {
      if (this.peek()?.v === '[') {
        this.i++;
        const n = this.seq(']');
        this.next();
        return this.postfix(`nthRoot(${this.group()}, ${n})`);
      }
      return this.postfix(`sqrt(${this.group()})`);
    }
    if (c === 'log') {
      if (this.peek()?.v === '_') {
        this.i++;
        const base = this.group();
        return this.postfix(`log(${this.funcArg()}, ${base})`);
      }
      return this.postfix(`log10(${this.funcArg()})`);
    }
    if (FUNCTIONS[c]) {
      const name = FUNCTIONS[c]!;
      // sin^2 x → (sin x)^2
      if (this.peek()?.v === '^') {
        this.i++;
        const p = this.group();
        return `(${name}(${this.funcArg()}))^(${p})`;
      }
      return this.postfix(`${name}(${this.funcArg()})`);
    }
    if (GREEK.has(c)) return this.postfix(this.subscript(c));
    if (c === 'operatorname') {
      const name = this.group().replace(/\s/g, '');
      if (!FUNCTIONS[name]) throw new Unsupported(`функция ${name}`);
      return this.postfix(`${FUNCTIONS[name]}(${this.funcArg()})`);
    }
    throw new Unsupported(`команда \\${c}`);
  }

  /**
   * Аргумент {…} или один символ — как в LaTeX: x^23 — это x², умноженное
   * на 3, а \log_2 8 — логарифм 8 по основанию 2.
   */
  group(): string {
    const t = this.next();
    if (t.t === 'ch' && t.v === '{') {
      const inner = this.seq('}');
      if (this.next().v !== '}') throw new Unsupported('фигурные скобки');
      return inner;
    }
    if (t.t === 'ch' && /[0-9a-zA-Z]/.test(t.v)) return t.v;
    this.i--;
    return this.item();
  }

  /** Аргумент функции без скобок: до ближайшего + − = или закрывающей скобки. */
  private funcArg(): string {
    const t = this.peek();
    if (t?.t === 'ch' && (t.v === '(' || t.v === '{')) {
      return this.group().replace(/^\((.*)\)$/, '$1');
    }
    if (t?.t === 'cmd' && t.v === 'left') {
      this.i++;
      return this.item();
    }
    const parts: string[] = [];
    while (!this.done()) {
      const n = this.peek()!;
      if (n.t === 'ch' && ('+-=)]}|'.includes(n.v) || n.v === ',')) break;
      if (n.t === 'cmd' && (n.v === 'right' || FUNCTIONS[n.v] || n.v === 'log')) break;
      parts.push(this.item());
    }
    if (!parts.length) throw new Unsupported('пустой аргумент функции');
    return parts.join(' ');
  }

  /** Индекс в имени переменной: x_1, x_{12}, \alpha_0 → x_1, x_12, alpha_0. */
  private subscript(name: string): string {
    if (this.peek()?.v !== '_') return name;
    this.i++;
    const sub = this.group().replace(/[^a-zA-Z0-9]/g, '');
    if (!sub) throw new Unsupported('индекс');
    return `${name}_${sub}`;
  }

  private postfix(base: string): string {
    let out = base;
    for (;;) {
      const t = this.peek();
      if (t?.t === 'ch' && t.v === '^') {
        this.i++;
        out = `(${out})^(${this.group()})`;
      } else if (t?.t === 'ch' && t.v === '!') {
        this.i++;
        out = `(${out})!`;
      } else return out;
    }
  }
}

/** Выражение math.js или null (запись не поддерживается). */
export function latexToMathjs(latex: string): string | null {
  try {
    const p = new Parser(tokenize(latex));
    const out = p.seq(null);
    if (!p.done() || !out) return null;
    return out;
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

/** Части уравнения: одно «=» — две стороны; без «=» — выражение. */
export function splitEquation(latex: string): { lhs: string; rhs: string | null } | null {
  const parts = latex.split('=');
  if (parts.length > 2) return null;
  const lhs = latexToMathjs(parts[0]!);
  if (lhs === null) return null;
  if (parts.length === 1) return { lhs, rhs: null };
  const rhs = latexToMathjs(parts[1]!);
  return rhs === null ? null : { lhs, rhs };
}
