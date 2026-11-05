import { describe, expect, it } from 'vitest';
import { create, all } from 'mathjs';
import { fmtSI, parseNum, rowSI, siTarget, solveAnswer } from './si';
import { CONSTANTS, constantBySym } from './constants';
import { ruUnitToEn, enUnitToRu } from '../../formula/units';

const math = create(all!, { number: 'number' });

describe('числа и единицы', () => {
  it('числа по-школьному', () => {
    expect(parseNum('0,5')).toBe(0.5);
    expect(parseNum('−2')).toBe(-2);
    expect(parseNum('1,6·10⁻¹⁹')).toBeCloseTo(1.6e-19, 30);
    expect(parseNum('6,02·10^23')).toBeCloseTo(6.02e23, -18);
    expect(parseNum('3e8')).toBe(3e8);
    expect(parseNum('пять')).toBeNull();
    expect(fmtSI(0.5)).toBe('0,5');
    expect(fmtSI(20)).toBe('20');
    expect(fmtSI(1.6e-19)).toBe('1,6·10⁻¹⁹');
    expect(fmtSI(-12345.678)).toBe('−12350');
  });

  it('русские единицы ↔ math.js', () => {
    expect(ruUnitToEn('км/ч')).toBe('km/h');
    expect(ruUnitToEn('м/с²')).toBe('m/s^2');
    expect(ruUnitToEn('Н·м²/кг²')).toBe('N m^2/kg^2');
    expect(ruUnitToEn('Дж/(моль·К)')).toBe('J/(mol K)');
    expect(ruUnitToEn('моль⁻¹')).toBe('mol^-1');
    expect(ruUnitToEn('попугай')).toEqual({ error: 'Неизвестная единица «попугай»' });
    expect(enUnitToRu('m / s^2')).toBe('м/с²');
    expect(enUnitToRu('N m')).toBe('Н·м');
    expect(siTarget('km / h')).toBe('m / s');
  });

  it('столбец СИ: 500 г → 0,5 кг, 72 км/ч → 20 м/с, 2 Н — уже в СИ', () => {
    expect(rowSI(math, { sym: 'm', value: '500', unit: 'г' }).si).toBe('0,5 кг');
    expect(rowSI(math, { sym: 'v', value: '72', unit: 'км/ч' }).si).toBe('20 м/с');
    expect(rowSI(math, { sym: 'F', value: '2', unit: 'Н' })).toMatchObject({ si: null, error: null });
    expect(rowSI(math, { sym: 'p', value: '1,5', unit: 'атм' }).si).toBe('152000 Па');
    expect(rowSI(math, { sym: 'n', value: '3', unit: '' })).toEqual({ value: 3, si: null, error: null });
    expect(rowSI(math, { sym: 'x', value: 'abc', unit: 'м' }).error).toBe('не число');
    expect(rowSI(math, { sym: 'x', value: '1', unit: 'вёрст' }).error).toBe('Неизвестная единица «вёрст»');
  });
});

describe('ответ с проверкой размерности', () => {
  const rows = [
    { sym: 'm', value: '500', unit: 'г' },
    { sym: 'F', value: '2', unit: 'Н' },
    { sym: 't', value: '2', unit: 'мин' },
  ];

  it('a = F/m = 4 м/с² — размерность сходится', () => {
    expect(solveAnswer(math, rows, { sym: 'a', unit: 'м/с²' }, 'F/m')).toEqual({ text: 'a = 4 м/с²', ok: true, message: 'Размерность сходится: [м/с²]' });
  });

  it('ошибка в формуле размерности: F·m вместо F/m', () => {
    const r = solveAnswer(math, rows, { sym: 'a', unit: 'м/с²' }, 'F*m')!;
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Размерность не сходится: получилось [кг²·м/с²], ожидалось [м/с²]');
  });

  it('постоянные (g) подставляются сами; сложение разных величин — ошибка', () => {
    expect(solveAnswer(math, rows, { sym: 'P', unit: 'Н' }, 'm·g')).toMatchObject({ text: 'P = 4,9 Н', ok: true });
    expect(solveAnswer(math, rows, { sym: 'x', unit: 'м' }, 'F + m')!.ok).toBe(false);
    expect(solveAnswer(math, rows, { sym: 'x', unit: 'м' }, 'F/q')!.message).toBe('Нет величины «q» в «Дано»');
  });

  it('путь при равноускоренном движении: s = a·t²/2 из минут — в метрах', () => {
    const r = solveAnswer(math, [...rows, { sym: 'a', value: '0,5', unit: 'м/с²' }], { sym: 's', unit: 'км' }, 'a·t²/2')!;
    expect(r).toMatchObject({ text: 's = 3,6 км', ok: true });
  });

  it('все постоянные переводятся в единицы math.js', () => {
    for (const c of CONSTANTS) expect(typeof ruUnitToEn(c.unit)).toBe('string');
    expect(constantBySym('ε0')?.key).toBe('eps0');
  });
});
