import { describe, expect, it } from 'vitest';
import { Calculator, calculate, prepareExpression } from './calc';

const ok = (input: string) => {
  const r = calculate(input);
  if (!r || 'error' in r) throw new Error(`ожидался результат для «${input}»: ${JSON.stringify(r)}`);
  return r;
};

describe('калькулятор', () => {
  it('переводит школьную запись в math.js', () => {
    expect(prepareExpression('2,5 × 4')).toBe('2.5 * 4');
    expect(prepareExpression('tg(45°)')).toBe('tan(45 deg )');
    expect(prepareExpression('72 км/ч в м/с')).toBe('72 km / h to m / s');
    expect(prepareExpression('log(8; 2)')).toBe('log(8, 2)');
  });

  it('считает числа с десятичной запятой', () => {
    expect(ok('2,5 * 4').value).toBe('10');
    expect(ok('1/3 + 1/6').value).toBe('0,5');
    expect(ok('√16 + 2²').value).toBe('8');
    expect(ok('sin(30°)').value).toBe('0,5');
    expect(ok('lg(1000)').value).toBe('3');
    expect(ok('3 * 10^20').value).toBe('3·10²⁰');
  });

  it('считает с единицами измерения по-русски', () => {
    expect(ok('72 км/ч в м/с').value).toBe('20 м/с');
    expect(ok('9,8 м/с^2 * 3 с').value).toBe('29,4 м/с');
    expect(ok('2 кг * 9,8 м/с^2').value).toBe('19,6 Н');
    expect(ok('5 км + 300 м').value).toBe('5,3 км');
    expect(ok('3 ч в мин').value).toBe('180 мин');
  });

  it('строит LaTeX «запись = результат»', () => {
    expect(ok('2,5 * 4').latex).toBe('2{,}5\\cdot4=10');
    expect(ok('72 км/ч в м/с').latex).toBe('\\frac{72~\\text{км}}{\\text{ч}}=20\\,\\text{м}/\\text{с}');
  });

  it('помнит переменные', () => {
    const c = new Calculator();
    const a = c.evaluate('x = 5');
    expect(a && 'assignment' in a && a.assignment).toBe(true);
    expect(c.preview('x^2')).toMatchObject({ value: '25' });
    expect(c.evaluate('f(t) = t + 1')).toMatchObject({ assignment: true });
    expect(c.evaluate('f(x)')).toMatchObject({ value: '6' });
  });

  it('объясняет ошибки по-русски', () => {
    expect(calculate('5 м + 2 с')).toEqual({ error: 'Единицы измерения не согласуются' });
    expect(calculate('y + 1')).toEqual({ error: 'Неизвестное имя «y»' });
    expect(calculate('2 * (3 + 4')).toEqual({ error: 'Не закрыта скобка' });
    expect(calculate('5 попугаев')).toEqual({ error: 'Неизвестное обозначение «попугаев»' });
    expect(calculate('import({}, {})')).toMatchObject({ error: expect.stringContaining('недоступна') });
    expect(calculate('')).toBeNull();
  });
});
