import { create, all, type MathNode } from 'mathjs';

/**
 * Калькулятор на math.js: числа с десятичной запятой, функции школьной
 * записи (tg, ctg, lg, ln, √), градусы, единицы измерения по-русски
 * («72 км/ч в м/с», «2 кг * 9,8 м/с^2») и переменные («x = 5», затем «x^2»).
 * Результат — текст для показа и LaTeX для объекта на доске.
 */

const math = create(all!, { number: 'number' });
const parse = math.parse;
const evaluateNode = (node: MathNode, scope: Map<string, unknown>) => node.compile().evaluate(scope);

// Выражения пользователя не должны менять сам math.js (рекомендация документации math.js).
const blocked = (name: string) => () => {
  throw new Error(`Функция ${name} недоступна`);
};
math.import(
  Object.fromEntries(['import', 'createUnit', 'evaluate', 'parse', 'compile', 'simplify', 'derivative', 'resolve', 'reviver'].map((n) => [n, blocked(n)])),
  { override: true },
);

/** Русские обозначения единиц → имена math.js. Порядок важен для обратного перевода. */
const UNITS: [string, string][] = [
  ['мм', 'mm'], ['см', 'cm'], ['дм', 'dm'], ['км', 'km'], ['м', 'm'],
  ['мг', 'mg'], ['кг', 'kg'], ['г', 'g'], ['т', 'tonne'],
  ['мс', 'ms'], ['мин', 'minute'], ['ч', 'h'], ['сут', 'day'], ['с', 's'],
  ['кН', 'kN'], ['Н', 'N'], ['кДж', 'kJ'], ['МДж', 'MJ'], ['Дж', 'J'], ['кВт', 'kW'], ['МВт', 'MW'], ['Вт', 'W'],
  ['кПа', 'kPa'], ['МПа', 'MPa'], ['Па', 'Pa'], ['атм', 'atm'], ['бар', 'bar'],
  ['мА', 'mA'], ['А', 'A'], ['кВ', 'kV'], ['мВ', 'mV'], ['В', 'V'], ['кОм', 'kohm'], ['МОм', 'Mohm'], ['Ом', 'ohm'],
  ['мКл', 'mC'], ['Кл', 'C'], ['кГц', 'kHz'], ['МГц', 'MHz'], ['Гц', 'Hz'], ['мкФ', 'uF'], ['Ф', 'F'], ['Тл', 'T'], ['Гн', 'H'],
  ['мл', 'mL'], ['л', 'L'], ['К', 'K'], ['моль', 'mol'], ['эВ', 'eV'], ['кВтч', 'kWh'], ['град', 'deg'], ['рад', 'rad'],
];
const RU_TO_EN = new Map(UNITS);
const EN_TO_RU = new Map(UNITS.map(([ru, en]) => [en, ru]));
EN_TO_RU.set('minutes', 'мин').set('hour', 'ч').set('kg', 'кг');

/** Школьные имена функций → math.js. */
const FUNCTIONS: Record<string, string> = { tg: 'tan', ctg: 'cot', arctg: 'atan', arcctg: 'acot', lg: 'log10', ln: 'log' };

export class CalcError extends Error {}

/** Запись пользователя → выражение math.js. */
export function prepareExpression(input: string): string {
  let s = input
    .replace(/[×·∙⋅]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    // √16, √x — корень из числа или имени; √(…) — из скобок.
    .replace(/√\s*(\d+(?:[.,]\d+)?|[A-Za-z]\w*)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/°/g, ' deg ')
    .replace(/π/g, 'pi');
  // Десятичная запятая между цифрами; аргументы функций — через точку с запятой.
  s = s.replace(/(\d),(?=\d)/g, '$1.').replace(/;/g, ',');
  s = s.replace(/\b(arcctg|arctg|ctg|tg|lg|ln)\b/g, (w) => FUNCTIONS[w]!);
  s = s.replace(/[А-Яа-яЁё]+/g, (w) => {
    if (w === 'в' || w === 'во') return ' to ';
    if (w === 'пи') return ' pi ';
    const en = RU_TO_EN.get(w);
    if (!en) throw new CalcError(`Неизвестное обозначение «${w}»`);
    return ` ${en} `;
  });
  return s.replace(/\s+/g, ' ').trim();
}

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** «m / s^2» → «м/с²» для показа и «\text{м}/\text{с}^{2}» для LaTeX. */
function formatUnits(units: string): { text: string; tex: string } {
  const parts = units.replace(/\s*\/\s*/g, ' / ').split(' ').filter(Boolean);
  const text: string[] = [];
  const tex: string[] = [];
  let prevUnit = false;
  for (const p of parts) {
    if (p === '/') {
      text.push('/');
      tex.push('/');
      prevUnit = false;
      continue;
    }
    const m = /^\(?([A-Za-z]+)\)?(?:\^\(?(-?\d+(?:\.\d+)?)\)?)?$/.exec(p);
    const name = m ? (EN_TO_RU.get(m[1]!) ?? m[1]!) : p;
    const pow = m?.[2];
    if (prevUnit) {
      text.push('·');
      tex.push('\\cdot ');
    }
    text.push(name + (pow ? [...pow].map((c) => SUPERSCRIPT[c] ?? c).join('') : ''));
    tex.push(`\\text{${name}}${pow ? `^{${pow}}` : ''}`);
    prevUnit = true;
  }
  return { text: text.join(''), tex: tex.join('') };
}

/** Число: запятая, степень десяти; для LaTeX — «{,}» и «\cdot 10^{n}». */
function formatNumber(n: number): { text: string; tex: string } {
  if (Number.isNaN(n)) return { text: 'не число', tex: '\\text{не число}' };
  if (!Number.isFinite(n)) return { text: n > 0 ? '∞' : '−∞', tex: n > 0 ? '\\infty' : '-\\infty' };
  const s = math.format(n, { precision: 12 });
  const [mant, exp] = s.split('e');
  const m = mant!.replace('.', ',');
  if (!exp) return { text: m.replace('-', '−'), tex: m.replace(',', '{,}') };
  const e = String(Number(exp));
  return {
    text: `${m.replace('-', '−')}·10${[...e].map((c) => SUPERSCRIPT[c] ?? c).join('')}`,
    tex: `${m.replace(',', '{,}')}\\cdot 10^{${e}}`,
  };
}

export interface CalcValue {
  text: string;
  tex: string;
}

function formatValue(v: unknown): CalcValue {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? { text: 'верно', tex: '\\text{верно}' } : { text: 'неверно', tex: '\\text{неверно}' };
  if (math.isUnit(v)) {
    const s = math.format(v, { precision: 12 });
    const sp = s.indexOf(' ');
    if (sp < 0) return formatUnits(s);
    const num = Number(s.slice(0, sp));
    const n = Number.isFinite(num) ? formatNumber(num) : { text: s.slice(0, sp), tex: s.slice(0, sp) };
    const u = formatUnits(s.slice(sp + 1));
    return { text: `${n.text} ${u.text}`, tex: `${n.tex}\\,${u.tex}` };
  }
  if (math.isComplex(v)) {
    const s = math.format(v, { precision: 12 }).replace(/\./g, ',');
    return { text: s, tex: s.replace(/,/g, '{,}') };
  }
  if (typeof v === 'function') {
    const name = (v as { syntax?: string; name?: string }).syntax ?? (v as { name?: string }).name ?? 'f';
    return { text: `задана функция ${name}`, tex: `\\text{${name}}` };
  }
  const s = math.format(v, { precision: 12 });
  return { text: s, tex: `\\text{${s.replace(/[\\{}$]/g, '')}}` };
}

/** LaTeX записи: единицы — русскими буквами, десятичная запятая. */
function expressionTex(node: MathNode): string {
  // У перевода единиц «a в b» на доске показывается только «a».
  const n = node as unknown as { type: string; fn?: string; args?: MathNode[] };
  const shown = n.type === 'OperatorNode' && n.fn === 'to' && n.args ? n.args[0]! : node;
  return shown
    .toTex({ implicit: 'hide', parenthesis: 'auto' })
    .replace(/\\mathrm\{([A-Za-z]+)\}/g, (all, u: string) => (EN_TO_RU.has(u) ? `\\text{${EN_TO_RU.get(u)}}` : all))
    .replace(/~\s*\^\\circ/g, '^{\\circ}')
    .replace(/(\d)\.(\d)/g, '$1{,}$2')
    .replace(/10\^\{\+(\d+)\}/g, '10^{$1}')
    .trim();
}

export interface CalcResult {
  /** Запись пользователя. */
  input: string;
  /** Результат для показа. */
  value: string;
  /** Формула «запись = результат» для доски. */
  latex: string;
  /** Присваивание переменной или функции («x = 5»). */
  assignment: boolean;
}

/** Понятное сообщение вместо английского текста ошибки math.js. */
function explain(err: unknown): string {
  if (err instanceof CalcError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  let m = /Undefined (?:symbol|function) (\S+)/.exec(msg);
  if (m) return `Неизвестное имя «${m[1]}»`;
  if (/Units do not match|Cannot convert|not match/i.test(msg)) return 'Единицы измерения не согласуются';
  if (/Parenthesis \) expected|Parenthesis.*expected/.test(msg)) return 'Не закрыта скобка';
  m = /Unexpected (?:operator|type of argument) ?(\S*)/.exec(msg);
  if (m) return 'Ошибка в записи выражения';
  if (/Unexpected end of expression/.test(msg)) return 'Выражение не закончено';
  if (/недоступна/.test(msg)) return msg;
  return 'Не удалось вычислить: проверьте запись';
}

/** Калькулятор с собственными переменными (одна панель — один экземпляр). */
export class Calculator {
  private scope = new Map<string, unknown>();

  /** Вычислить без сохранения переменных (предпросмотр при наборе). */
  preview(input: string): CalcResult | { error: string } | null {
    return this.run(input, new Map(this.scope));
  }

  /** Вычислить и сохранить переменные. */
  evaluate(input: string): CalcResult | { error: string } | null {
    return this.run(input, this.scope);
  }

  reset(): void {
    this.scope.clear();
  }

  private run(input: string, scope: Map<string, unknown>): CalcResult | { error: string } | null {
    const src = input.trim();
    if (!src) return null;
    if (src.length > 500) return { error: 'Слишком длинное выражение' };
    try {
      const node = parse(prepareExpression(src));
      const value = formatValue(evaluateNode(node, scope));
      const type = (node as unknown as { type: string }).type;
      const assignment = type === 'AssignmentNode' || type === 'FunctionAssignmentNode';
      const tex = expressionTex(node);
      return {
        input: src,
        value: value.text,
        latex: assignment ? tex : `${tex}=${value.tex}`,
        assignment,
      };
    } catch (err) {
      return { error: explain(err) };
    }
  }
}

/** Вычислить одно выражение (тесты и единичные вызовы). */
export function calculate(input: string): CalcResult | { error: string } | null {
  return new Calculator().evaluate(input);
}
