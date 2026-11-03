import { describe, expect, it } from 'vitest';
import { parseQ, Q } from './rational';
import { add, det, eigen2, gaussSteps, inverse, mul, parseMatrix, rank, solveText, toStrings, transpose, type M } from './linalg';

const m = (rows: (number | string)[][]): M => rows.map((r) => r.map((v) => parseQ(String(v))!));
const s = (x: M) => toStrings(x);

describe('6.3b: дроби', () => {
  it('разбор и арифметика', () => {
    expect(parseQ('−2/4')!.toString()).toBe('−1/2');
    expect(parseQ('1,5')!.toString()).toBe('3/2');
    expect(parseQ('.25')!.toString()).toBe('1/4');
    expect(parseQ('abc')).toBeNull();
    expect(parseQ('1/0')).toBeNull();
    expect(new Q(1n, 3n).add(new Q(1n, 6n)).toString()).toBe('1/2');
  });
});

describe('6.3b: операции', () => {
  it('сумма, произведение, транспонирование, ошибки размеров', () => {
    const A = m([[1, 2], [3, 4]]);
    const B = m([[0, 1], [1, 0]]);
    expect(s(add(A, B))).toEqual([['1', '3'], ['4', '4']]);
    expect(s(add(A, B, -1))).toEqual([['1', '1'], ['2', '4']]);
    expect(s(mul(A, B))).toEqual([['2', '1'], ['4', '3']]);
    expect(s(transpose(m([[1, 2, 3]])))).toEqual([['1'], ['2'], ['3']]);
    expect(() => mul(A, m([[1, 2, 3]]))).toThrow('Число столбцов первой (2) не равно числу строк второй (1)');
  });

  it('определитель, обратная, ранг', () => {
    expect(det(m([[1, 2], [3, 4]])).toString()).toBe('−2');
    expect(det(m([[2, 0, 1], [1, 3, 2], [1, 1, 1]])).toString()).toBe('0');
    expect(det(m([[2, 0, 1], [1, 3, 2], [1, 1, 2]])).toString()).toBe('6');
    expect(det(m([[0, 1], [1, 0]])).toString()).toBe('−1');
    expect(s(inverse(m([[1, 2], [3, 4]])))).toEqual([['−2', '1'], ['3/2', '−1/2']]);
    expect(() => inverse(m([[1, 2], [2, 4]]))).toThrow('Определитель равен 0 — обратной матрицы нет');
    expect(rank(m([[1, 2, 3], [2, 4, 6], [1, 0, 1]]))).toBe(2);
  });
});

describe('6.3b: метод Гаусса', () => {
  it('шаги с подписями и единственное решение', () => {
    // x + y = 3, 2x − y = 0 → x = 1, y = 2.
    const A = m([[1, 1, 3], [2, -1, 0]]);
    const { steps } = gaussSteps(A, true, 2);
    expect(steps[1]!.ops).toEqual(['R₂ − 2R₁ → R₂']);
    expect(steps[2]!.ops).toEqual(['R₂ : (−3) → R₂', 'R₁ − R₂ → R₁']);
    expect(s(steps[steps.length - 1]!.m)).toEqual([['1', '0', '1'], ['0', '1', '2']]);
    expect(solveText(A)).toBe('Единственное решение: x₁ = 1, x₂ = 2');
  });

  it('перестановка строк, несовместная и неопределённая системы', () => {
    const { steps } = gaussSteps(m([[0, 1, 2], [1, 1, 1]]), false, 2);
    expect(steps[1]!.ops[0]).toBe('R₁ ↔ R₂');
    expect(solveText(m([[1, 1, 1], [1, 1, 2]]))).toBe('Система несовместна: решений нет');
    expect(solveText(m([[1, 2, 3], [2, 4, 6]]))).toBe('Бесконечно много решений: x₁ = 3 − 2t₁, x₂ = t₁ (t₁ — любые)');
  });
});

describe('6.3b: собственные векторы 2×2', () => {
  it('вещественные, кратные, комплексные', () => {
    const e = eigen2(2, 1, 1, 2);
    expect(e.map((x) => Math.round(x.value * 1e9) / 1e9)).toEqual([3, 1]);
    expect(Math.abs(e[0]!.vector[0] - e[0]!.vector[1])).toBeLessThan(1e-9);
    expect(eigen2(0, -1, 1, 0)).toEqual([]);
    expect(eigen2(2, 0, 0, 2)).toHaveLength(2);
  });
});

it('матрица из ячеек', () => {
  expect(parseMatrix(['1', '2', 'x', '4'], 2, 2)).toEqual({ error: 'Ячейка 2, 1: не число' });
});
