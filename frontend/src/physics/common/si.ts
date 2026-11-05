import type { MathJsInstance, MathNode, Unit } from 'mathjs';
import { enUnitToRu, ruUnitToEn } from '../../formula/units';
import { constantBySym } from './constants';

/**
 * «Дано / СИ / Ответ» (этап 7.1b): перевод величин в СИ и расчёт ответа по
 * формуле с проверкой размерности. Функции получают уже загруженный
 * math.js — сама библиотека грузится отдельной частью (analysis/expr).
 */

export interface GivenRow {
  sym: string;
  value: string;
  unit: string;
}
export interface FindRow {
  sym: string;
  unit: string;
}

/** Имя величины для формул: латиница или греческая буква, затем буквы, цифры, «_». */
export const SYM_RE = /^[A-Za-zΑ-Ωα-ω][A-Za-z0-9_Α-Ωα-ω]{0,11}$/;

const SUPER: Record<string, string> = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Число по-школьному: «0,5», «−2», «1,6·10⁻¹⁹», «1,6·10^-19», «6e23». */
export function parseNum(src: string): number | null {
  let s = src.trim().replace(/\s+/g, '').replace(/[−–]/g, '-').replace(',', '.');
  s = s.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (w) => `^${[...w].map((c) => SUPER[c]).join('')}`);
  const m = /^(-?\d+(?:\.\d+)?)(?:[·*×x]10\^?\(?(-?\d+)\)?)?$/.exec(s);
  if (m) return Number(m[1]) * 10 ** Number(m[2] ?? 0);
  if (/^-?\d+(?:\.\d+)?e-?\d+$/i.test(s)) return Number(s);
  return null;
}

const SUP_OUT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** Число для доски: 4 значащие цифры, очень большие и малые — «1,6·10⁻¹⁹». */
export function fmtSI(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e-3 && a < 1e6) return sign + String(Number(a.toPrecision(4))).replace('.', ',');
  const e = Math.floor(Math.log10(a));
  const m = Number((a / 10 ** e).toPrecision(3));
  return `${sign}${String(m).replace('.', ',')}·10${[...String(e)].map((c) => SUP_OUT[c]).join('')}`;
}

/** Кратные и внесистемные единицы → основная единица СИ того же рода. */
const SI_OF: Record<string, string> = {
  mm: 'm', cm: 'm', dm: 'm', km: 'm', m: 'm',
  mg: 'kg', g: 'kg', kg: 'kg', tonne: 'kg',
  ms: 's', minute: 's', h: 's', day: 's', s: 's',
  kN: 'N', N: 'N', kJ: 'J', MJ: 'J', J: 'J', eV: 'J', kWh: 'J', kW: 'W', MW: 'W', W: 'W',
  kPa: 'Pa', MPa: 'Pa', Pa: 'Pa', atm: 'Pa', bar: 'Pa',
  mA: 'A', A: 'A', kV: 'V', mV: 'V', V: 'V', kohm: 'ohm', Mohm: 'ohm', ohm: 'ohm',
  mC: 'C', C: 'C', kHz: 'Hz', MHz: 'Hz', Hz: 'Hz', uF: 'F', F: 'F', T: 'T', H: 'H',
  mL: 'm^3', L: 'm^3', K: 'K', mol: 'mol', deg: 'deg', rad: 'rad',
};

/** Единица СИ для записи math.js («km / h» → «m / s»). */
export function siTarget(unitEn: string): string {
  return unitEn.replace(/[A-Za-z]+/g, (w) => SI_OF[w] ?? w);
}

export interface RowSI {
  /** Значение в СИ (math.js Unit) или число для безразмерной величины; null — ошибка. */
  value: Unit | number | null;
  /** Запись в столбце «СИ» («0,5 кг») или null, если величина уже в СИ. */
  si: string | null;
  error: string | null;
}

export function rowSI(math: MathJsInstance, row: GivenRow): RowSI {
  const n = parseNum(row.value);
  if (n === null) return { value: null, si: null, error: row.value.trim() ? 'не число' : null };
  if (!row.unit.trim()) return { value: n, si: null, error: null };
  const en = ruUnitToEn(row.unit);
  if (typeof en !== 'string') return { value: null, si: null, error: en.error };
  try {
    const target = siTarget(en);
    const u = math.unit(n, en);
    const conv = u.to(target);
    const same = en.replace(/\s+/g, '') === target.replace(/\s+/g, '');
    return { value: conv, si: same ? null : `${fmtSI(conv.toNumber(target))} ${enUnitToRu(target)}`, error: null };
  } catch {
    return { value: null, si: null, error: `неизвестная единица «${row.unit}»` };
  }
}

export interface Answer {
  /** «a = 4 м/с²». */
  text: string;
  /** true — размерность сходится; false — нет; null — проверить нельзя (ошибка). */
  ok: boolean | null;
  message: string;
}

/** Формула ответа: школьная запись → math.js. */
const prepareFormula = (s: string) =>
  s
    .replace(/[·×∙⋅]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/(\d),(?=\d)/g, '$1.');

/**
 * Ответ по формуле через обозначения «Дано» (и постоянные g, G, k, e, c…):
 * значения подставляются в СИ, результат переводится в ожидаемую единицу.
 * Размерность не совпала — ok: false и понятное сообщение.
 */
export function solveAnswer(math: MathJsInstance, rows: GivenRow[], find: FindRow, formula: string): Answer | null {
  if (!formula.trim()) return null;
  const scope = new Map<string, unknown>();
  for (const r of rows) {
    if (!SYM_RE.test(r.sym)) continue;
    const v = rowSI(math, r).value;
    if (v !== null) scope.set(r.sym, v);
  }
  const head = `${find.sym || '?'} = `;
  let node: MathNode;
  try {
    node = math.parse(prepareFormula(formula));
  } catch {
    return { text: `${head}?`, ok: null, message: 'Ошибка в записи формулы' };
  }
  // Имена в формуле: величины «Дано» или постоянные; функции (sqrt, sin) — math.js.
  const names = new Set<string>();
  node.traverse((n, _path, parent) => {
    const s = n as unknown as { isSymbolNode?: boolean; name?: string };
    const p = parent as unknown as { isFunctionNode?: boolean; fn?: unknown } | null;
    if (s.isSymbolNode && !(p?.isFunctionNode && p.fn === n)) names.add(s.name!);
  });
  for (const name of names) {
    if (scope.has(name) || name === 'pi') continue;
    const c = constantBySym(name);
    const en = c ? ruUnitToEn(c.unit) : null;
    if (c && typeof en === 'string') scope.set(name, math.unit(c.value, en));
    else return { text: `${head}?`, ok: null, message: `Нет величины «${name}» в «Дано»` };
  }
  let r: unknown;
  try {
    r = node.compile().evaluate(scope);
  } catch {
    return { text: `${head}?`, ok: false, message: 'Размерности не согласуются: нельзя сложить или сравнить разные величины' };
  }
  const want = find.unit.trim();
  if (typeof r === 'number') {
    if (!want) return { text: `${head}${fmtSI(r)}`, ok: true, message: 'Безразмерная величина' };
    return { text: `${head}${fmtSI(r)}`, ok: false, message: `Получилась безразмерная величина, а ожидалась «${want}»` };
  }
  if (!math.isUnit(r)) return { text: `${head}?`, ok: null, message: 'Результат — не число' };
  const u = r as Unit;
  const got = enUnitToRu(u.toSI().formatUnits());
  if (!want) return { text: `${head}${fmtSI(u.toSI().toNumber())} ${got}`, ok: null, message: 'Укажите единицу искомой величины, чтобы проверить размерность' };
  const en = ruUnitToEn(want);
  if (typeof en !== 'string') return { text: `${head}?`, ok: null, message: en.error };
  try {
    if (!u.equalBase(math.unit(1, en))) return { text: `${head}${fmtSI(u.toSI().toNumber())} ${got}`, ok: false, message: `Размерность не сходится: получилось [${got}], ожидалось [${want}]` };
    return { text: `${head}${fmtSI(u.toNumber(en))} ${want}`, ok: true, message: `Размерность сходится: [${want}]` };
  } catch {
    return { text: `${head}?`, ok: null, message: `Неизвестная единица «${want}»` };
  }
}
