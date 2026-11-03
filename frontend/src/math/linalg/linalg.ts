import { Q, parseQ } from './rational';

/** Матрица из дробей: строки. */
export type M = Q[][];

export const rowsOf = (m: M) => m.length;
export const colsOf = (m: M) => m[0]?.length ?? 0;
const clone = (m: M): M => m.map((r) => [...r]);

/** Ячейки объекта (строки по строкам матрицы) → матрица; ошибка — какая ячейка не число. */
export function parseMatrix(cells: string[], rows: number, cols: number): M | { error: string } {
  const out: M = [];
  for (let i = 0; i < rows; i++) {
    const row: Q[] = [];
    for (let j = 0; j < cols; j++) {
      const v = parseQ(cells[i * cols + j] ?? '');
      if (!v) return { error: `Ячейка ${i + 1}, ${j + 1}: не число` };
      row.push(v);
    }
    out.push(row);
  }
  return out;
}

export const toStrings = (m: M): string[][] => m.map((r) => r.map((v) => v.toString()));

export class SizeError extends Error {}

export function add(a: M, b: M, sign = 1): M {
  if (rowsOf(a) !== rowsOf(b) || colsOf(a) !== colsOf(b)) throw new SizeError(`Размеры не совпадают: ${rowsOf(a)}×${colsOf(a)} и ${rowsOf(b)}×${colsOf(b)}`);
  return a.map((r, i) => r.map((v, j) => (sign > 0 ? v.add(b[i]![j]!) : v.sub(b[i]![j]!))));
}

export function mul(a: M, b: M): M {
  if (colsOf(a) !== rowsOf(b)) throw new SizeError(`Число столбцов первой (${colsOf(a)}) не равно числу строк второй (${rowsOf(b)})`);
  return a.map((r) => b[0]!.map((_, j) => r.reduce((s, v, k) => s.add(v.mul(b[k]![j]!)), Q.ZERO)));
}

export const scale = (a: M, k: Q): M => a.map((r) => r.map((v) => v.mul(k)));
export const transpose = (a: M): M => a[0]!.map((_, j) => a.map((r) => r[j]!));

/** Ступенчатый вид: число перестановок и главные элементы (для определителя и ранга). */
function echelon(a: M): { m: M; swaps: number; pivots: number[] } {
  const m = clone(a);
  const R = rowsOf(m);
  const C = colsOf(m);
  let swaps = 0;
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < C && r < R; c++) {
    const p = m.findIndex((row, i) => i >= r && !row[c]!.isZero());
    if (p < 0) continue;
    if (p !== r) {
      [m[p], m[r]] = [m[r]!, m[p]!];
      swaps++;
    }
    for (let i = r + 1; i < R; i++) {
      const f = m[i]![c]!.div(m[r]![c]!);
      if (!f.isZero()) m[i] = m[i]!.map((v, j) => v.sub(f.mul(m[r]![j]!)));
    }
    pivots.push(c);
    r++;
  }
  return { m, swaps, pivots };
}

export function det(a: M): Q {
  if (rowsOf(a) !== colsOf(a)) throw new SizeError(`Определитель есть только у квадратной матрицы (здесь ${rowsOf(a)}×${colsOf(a)})`);
  const { m, swaps, pivots } = echelon(a);
  if (pivots.length < rowsOf(a)) return Q.ZERO;
  const d = m.reduce((s, r, i) => s.mul(r[i]!), Q.ONE);
  return swaps % 2 ? d.neg() : d;
}

export const rank = (a: M): number => echelon(a).pivots.length;

export function inverse(a: M): M {
  const n = rowsOf(a);
  if (n !== colsOf(a)) throw new SizeError(`Обратная есть только у квадратной матрицы (здесь ${n}×${colsOf(a)})`);
  const aug: M = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? Q.ONE : Q.ZERO))]);
  const r = rref(aug).m;
  for (let i = 0; i < n; i++) if (!r[i]![i]!.eq(Q.ONE)) throw new SizeError('Определитель равен 0 — обратной матрицы нет');
  return r.map((row) => row.slice(n));
}

function rref(a: M, cols = colsOf(a)): { m: M; pivots: number[] } {
  const m = clone(a);
  const R = rowsOf(m);
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < R; c++) {
    const p = m.findIndex((row, i) => i >= r && !row[c]!.isZero());
    if (p < 0) continue;
    [m[p], m[r]] = [m[r]!, m[p]!];
    const pv = m[r]![c]!;
    m[r] = m[r]!.map((v) => v.div(pv));
    for (let i = 0; i < R; i++) {
      if (i === r) continue;
      const f = m[i]![c]!;
      if (!f.isZero()) m[i] = m[i]!.map((v, j) => v.sub(f.mul(m[r]![j]!)));
    }
    pivots.push(c);
    r++;
  }
  return { m, pivots };
}

// ---------------------------------------------------------------------
//  Метод Гаусса по шагам
// ---------------------------------------------------------------------

export interface GaussStep {
  /** Преобразования строк, выполненные на этом шаге («R₂ − 2R₁ → R₂»). */
  ops: string[];
  m: M;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const R = (i: number) => `R${String(i + 1).replace(/\d/g, (d) => SUB[Number(d)]!)}`;
const coef = (k: Q) => (k.eq(Q.ONE) ? '' : k.d === 1n ? k.toString() : `(${k.toString()})`);

/**
 * Шаги метода Гаусса (jordan — до приведённого вида, с единицами на главной
 * диагонали и нулями над ними). Один шаг — один столбец: перестановка,
 * при jordan — деление строки, затем зануление в столбце.
 * cols — сколько столбцов участвуют в выборе главных элементов (у
 * расширенной матрицы — без столбца свободных членов).
 */
export function gaussSteps(a: M, jordan: boolean, cols = colsOf(a)): { steps: GaussStep[]; pivots: number[] } {
  const m = clone(a);
  const rows = rowsOf(m);
  const steps: GaussStep[] = [{ ops: [], m: clone(m) }];
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    const p = m.findIndex((row, i) => i >= r && !row[c]!.isZero());
    if (p < 0) continue;
    const ops: string[] = [];
    if (p !== r) {
      [m[p], m[r]] = [m[r]!, m[p]!];
      ops.push(`${R(r)} ↔ ${R(p)}`);
    }
    if (jordan && !m[r]![c]!.eq(Q.ONE)) {
      const pv = m[r]![c]!;
      m[r] = m[r]!.map((v) => v.div(pv));
      ops.push(`${R(r)} : ${pv.d === 1n && pv.sign() > 0 ? pv.toString() : `(${pv.toString()})`} → ${R(r)}`);
    }
    for (let i = jordan ? 0 : r + 1; i < rows; i++) {
      if (i === r) continue;
      const f = m[i]![c]!.div(m[r]![c]!);
      if (f.isZero()) continue;
      m[i] = m[i]!.map((v, j) => v.sub(f.mul(m[r]![j]!)));
      ops.push(f.sign() > 0 ? `${R(i)} − ${coef(f)}${R(r)} → ${R(i)}` : `${R(i)} + ${coef(f.neg())}${R(r)} → ${R(i)}`);
    }
    if (ops.length) steps.push({ ops, m: clone(m) });
    pivots.push(c);
    r++;
  }
  return { steps, pivots };
}

/** Ответ для расширенной матрицы системы (последний столбец — свободные члены). */
export function solveText(aug: M): string {
  const vars = colsOf(aug) - 1;
  const { m, pivots } = rref(aug, vars);
  const x = (j: number) => `x${String(j + 1).replace(/\d/g, (d) => SUB[Number(d)]!)}`;
  // Строка 0 … 0 | c ≠ 0 — противоречие.
  if (m.some((row) => row.slice(0, vars).every((v) => v.isZero()) && !row[vars]!.isZero())) return 'Система несовместна: решений нет';
  const free = Array.from({ length: vars }, (_, j) => j).filter((j) => !pivots.includes(j));
  const t = (k: number) => `t${String(k + 1).replace(/\d/g, (d) => SUB[Number(d)]!)}`;
  const parts = pivots.map((pc, i) => {
    let s = m[i]![vars]!.isZero() && free.some((f) => !m[i]![f]!.isZero()) ? '' : m[i]![vars]!.toString();
    free.forEach((f, k) => {
      const c = m[i]![f]!.neg();
      if (c.isZero()) return;
      const abs = c.sign() < 0 ? c.neg() : c;
      const term = `${abs.eq(Q.ONE) ? '' : abs.toString()}${t(k)}`;
      s = s ? `${s} ${c.sign() < 0 ? '−' : '+'} ${term}` : c.sign() < 0 ? `−${term}` : term;
    });
    return `${x(pc)} = ${s || '0'}`;
  });
  const freeParts = free.map((f, k) => `${x(f)} = ${t(k)}`);
  if (!free.length) return `Единственное решение: ${parts.join(', ')}`;
  return `Бесконечно много решений: ${[...parts, ...freeParts].join(', ')} (${free.map((_, k) => t(k)).join(', ')} — любые)`;
}

// ---------------------------------------------------------------------
//  Матрица 2×2 как преобразование плоскости
// ---------------------------------------------------------------------

/** Собственные значения и векторы вещественной матрицы [[a, b], [c, d]]. */
export function eigen2(a: number, b: number, c: number, d: number): { value: number; vector: [number, number] }[] {
  const tr = a + d;
  const dt = a * d - b * c;
  const disc = tr * tr - 4 * dt;
  if (disc < -1e-12) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const values = disc < 1e-12 ? [tr / 2] : [(tr + s) / 2, (tr - s) / 2];
  const out: { value: number; vector: [number, number] }[] = [];
  for (const l of values) {
    // (A − λE)v = 0: вектор из строки с ненулевыми коэффициентами.
    let v: [number, number] = Math.abs(b) > 1e-12 ? [b, l - a] : Math.abs(c) > 1e-12 ? [l - d, c] : [1, 0];
    if (Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12) {
      // Диагональная матрица: собственные векторы — оси (обе, если λ одинаковы).
      if (values.length === 1) {
        out.push({ value: l, vector: [1, 0] }, { value: l, vector: [0, 1] });
        continue;
      }
      v = Math.abs(l - a) < 1e-12 ? [1, 0] : [0, 1];
    }
    const n = Math.hypot(v[0], v[1]);
    out.push({ value: l, vector: [v[0] / n, v[1] / n] });
  }
  return out;
}
