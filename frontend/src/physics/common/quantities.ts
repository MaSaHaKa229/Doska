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
