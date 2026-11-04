/**
 * Векторные величины (этап 7.1a): обозначение, единица, цвет по умолчанию.
 * Длина вектора на доске переводится в значение по масштабу «1 клетка = k
 * единиц»; клетка сетки — 20 мировых единиц.
 */

export const CELL = 20;

export const QUANTITIES = ['force', 'velocity', 'acceleration', 'momentum', 'displacement', 'field', 'other'] as const;
export type Quantity = (typeof QUANTITIES)[number];

export const QUANTITY_INFO: Record<Quantity, { title: string; symbol: string; unit: string; color: string; keywords: string[] }> = {
  force: { title: 'Сила', symbol: 'F', unit: 'Н', color: 'accent-1', keywords: ['сила', 'вектор силы', 'ньютон', 'сила тяжести', 'сила упругости', 'сила трения', 'реакция опоры'] },
  velocity: { title: 'Скорость', symbol: 'v', unit: 'м/с', color: 'accent-2', keywords: ['скорость', 'вектор скорости'] },
  acceleration: { title: 'Ускорение', symbol: 'a', unit: 'м/с²', color: 'accent-3', keywords: ['ускорение', 'вектор ускорения'] },
  momentum: { title: 'Импульс', symbol: 'p', unit: 'кг·м/с', color: 'accent-5', keywords: ['импульс', 'количество движения'] },
  displacement: { title: 'Перемещение', symbol: 's', unit: 'м', color: 'ink', keywords: ['перемещение', 'вектор перемещения'] },
  field: { title: 'Напряжённость поля', symbol: 'E', unit: 'Н/Кл', color: 'accent-4', keywords: ['напряжённость', 'электрическое поле', 'вектор напряжённости'] },
  other: { title: 'Вектор величины', symbol: 'A', unit: '', color: 'ink', keywords: ['вектор', 'векторная величина'] },
};

/** Число по-русски: «5,2», «−3». */
export function fmt(v: number, digits = 2): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(Object.is(r, -0) ? 0 : r)
    .replace('.', ',')
    .replace('-', '−');
}

/** Обозначение «F_тр» → основная часть и нижний индекс. */
export function splitLabel(label: string): { main: string; sub: string } {
  const i = label.indexOf('_');
  return i < 0 ? { main: label, sub: '' } : { main: label.slice(0, i), sub: label.slice(i + 1) };
}

/** Обозначение с индексом для текста: «F_тр» → «Fтр»; с добавочным индексом проекции: «Fтр x». */
export const plainLabel = (label: string, extra = '') => {
  const { main, sub } = splitLabel(label);
  return main + sub + extra;
};

/** Модуль и проекции вектора (dx, dy — на доске, ось y вниз) в единицах величины. */
export function vectorValues(dx: number, dy: number, perCell: number, axisAngleDeg: number): { len: number; x: number; y: number } {
  const k = perCell / CELL;
  const t = (axisAngleDeg * Math.PI) / 180;
  // Ось x повёрнута против часовой стрелки на axisAngle; на доске y вниз.
  const ux = Math.cos(t);
  const uy = -Math.sin(t);
  const wx = -Math.sin(t);
  const wy = -Math.cos(t);
  return { len: Math.hypot(dx, dy) * k, x: (dx * ux + dy * uy) * k, y: (dx * wx + dy * wy) * k };
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

/** Показатель степени надстрочными цифрами: 10 и sup(−3) → «10⁻³». */
export const sup = (n: number) => String(n).split('').map((ch) => SUP[ch]).join('');

/** «6,21·10⁻²¹» для очень больших и малых чисел, иначе «1,25» (digits значащих цифр). */
export function sci(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const ru = (s: string) => s.replace('.', ',').replace('-', '−');
  if (a >= 0.01 && a < 1e5) return ru(String(Number(v.toPrecision(digits))));
  const e = Math.floor(Math.log10(a));
  let m = Number((v / 10 ** e).toPrecision(digits));
  let ee = e;
  if (Math.abs(m) >= 10) {
    m /= 10;
    ee += 1;
  }
  return `${ru(String(m))}·10${sup(ee)}`;
}

/** Псевдослучайные числа от номера (молекулы, частицы) — одинаковые у всех участников. */
export function seeded(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
