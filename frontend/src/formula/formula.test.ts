import { describe, expect, it } from 'vitest';
import { latexToMathjs, splitEquation } from './latex-to-mathjs';
import { checkSteps, checkTransition } from './check';

describe('LaTeX → math.js', () => {
  it('дроби, корни, степени, функции, неявное умножение', () => {
    expect(latexToMathjs('\\frac{a+1}{2}')).toBe('((a + 1) / (2))');
    expect(latexToMathjs('2x^2')).toBe('2 * (x)^(2)');
    expect(latexToMathjs('x(x+1)')).toBe('x * (x + 1)');
    expect(latexToMathjs('\\sqrt[3]{8}')).toBe('nthRoot(8, 3)');
    expect(latexToMathjs('\\sin^2 x + \\cos x')).toBe('(sin(x))^(2) + cos(x)');
    expect(latexToMathjs('\\left|x-1\\right|')).toBe('abs(x - 1)');
    expect(latexToMathjs('|x-1|')).toBe('abs(x - 1)');
    expect(latexToMathjs('\\log_2 8')).toBe('log(8, 2)');
    expect(latexToMathjs('x_1 \\cdot \\alpha_{0}')).toBe('x_1 * alpha_0');
    expect(latexToMathjs('2{,}5 + 1,5')).toBe('2.5 + 1.5');
    expect(latexToMathjs('3!')).toBe('(3)!');
    expect(latexToMathjs('x^23')).toBe('(x)^(2) * 3');
  });

  it('неподдерживаемое — null', () => {
    expect(latexToMathjs('x \\pm 1')).toBeNull();
    expect(latexToMathjs('\\int_0^1 x\\,dx')).toBeNull();
    expect(latexToMathjs('x < 2')).toBeNull();
    expect(splitEquation('a = b = c')).toBeNull();
    expect(splitEquation('2x = 6')).toEqual({ lhs: '2 * x', rhs: '6' });
  });
});

describe('проверка шагов решения', () => {
  it('тождественные преобразования выражений', () => {
    expect(checkTransition('(a+b)^2', 'a^2 + 2ab + b^2')).toBe('ok');
    expect(checkTransition('(a+b)^2', 'a^2 + b^2')).toBe('bad');
    expect(checkTransition('\\frac{x^2-1}{x-1}', 'x+1')).toBe('ok');
    expect(checkTransition('\\sin^2 x + \\cos^2 x', '1')).toBe('ok');
  });

  it('равносильные уравнения: перенос, деление на число; иначе — «не проверено»', () => {
    expect(checkSteps(['2x + 3 = 11', '2x = 8', 'x = 4'])).toEqual(['ok', 'ok']);
    expect(checkTransition('2x = 8', 'x = 5')).toBe('unknown');
    expect(checkTransition('x^2 - 9 = 0', '(x-3)(x+3) = 0')).toBe('ok');
    // Смешанный переход и неподдерживаемая запись.
    expect(checkTransition('x + 1', 'x + 1 = 0')).toBe('unknown');
    expect(checkTransition('x \\pm 1', 'x')).toBe('unknown');
    expect(checkSteps(['x', '', 'x'])).toEqual(['unknown', 'unknown']);
  });
});
