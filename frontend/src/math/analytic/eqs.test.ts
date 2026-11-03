import { beforeAll, describe, expect, it } from 'vitest';
import { loadMath } from '../analysis/expr';
import { analyzeConic, angleBetween, conicElements, conicText, distanceToLine, footOnLine, lineText, parseLine, parseQuadratic, vangle, type Conic } from './eqs';

beforeAll(async () => {
  await loadMath();
});

const conic = (t: string, params: Record<string, number> = {}): Conic => {
  const q = parseQuadratic(t, params);
  if ('error' in q) throw new Error(q.error);
  return analyzeConic(q);
};
const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

describe('6.3a: прямая', () => {
  it('разные записи — одна прямая, приведённая к целым коэффициентам', () => {
    for (const t of ['2x - 3y + 6 = 0', 'y = 2/3 x + 2', '3y = 2x + 6']) {
      const l = parseLine(t, {});
      if ('error' in l) throw new Error(l.error);
      expect(lineText(l)).toBe('2x − 3y + 6 = 0');
    }
    const v = parseLine('x = 3', {});
    expect(!('error' in v) && lineText(v)).toBe('x − 3 = 0');
    expect(parseLine('y = x^2', {})).toEqual({ error: 'Это не уравнение прямой (есть x², xy, sin…)' });
    expect(parseLine('y = k x + b', { k: 2, b: -1 })).toEqual({ A: -2, B: 1, C: 1 });
  });

  it('расстояние, основание перпендикуляра, угол между прямыми', () => {
    const l = { A: 3, B: 4, C: -25 };
    expect(distanceToLine(l, { x: 0, y: 0 })).toBe(5);
    expect(footOnLine(l, { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
    const a = angleBetween({ A: 1, B: -1, C: 0 }, { A: 0, B: 1, C: -2 });
    expect(a.deg).toBeCloseTo(45, 9);
    expect(a.at).toEqual({ x: 2, y: 2 });
    expect(angleBetween({ A: 1, B: 1, C: 0 }, { A: 2, B: 2, C: 5 }).at).toBeNull();
  });
});

describe('6.3a: кривые второго порядка', () => {
  it('эллипс в каноническом виде', () => {
    const k = conic('x^2/25 + y^2/9 = 1');
    expect([k.kind, r(k.a), r(k.b), r(k.c), r(k.e)]).toEqual(['ellipse', 5, 3, 4, 0.8]);
    expect(conicElements(k).foci.map((p) => [r(p.x), r(p.y)])).toEqual([
      [4, 0],
      [-4, 0],
    ]);
    expect(conicText(k)).toBe('Эллипс: x²/25 + y²/9 = 1; a = 5, b = 3, c = 4, e = 0,8');
  });

  it('эллипс с большой осью по y и сдвигом', () => {
    const k = conic('(x - 1)^2/4 + (y + 2)^2/16 = 1');
    expect([k.kind, r(k.a), r(k.b), r(k.center.x), r(k.center.y)]).toEqual(['ellipse', 4, 2, 1, -2]);
    const f = conicElements(k).foci.map((p) => [r(p.x), r(p.y)]).sort((a, b) => a[1]! - b[1]!);
    expect(f[0]![0]).toBeCloseTo(1, 9);
    expect(f.map((p) => p[1])).toEqual([r(-2 - Math.sqrt(12)), r(-2 + Math.sqrt(12))]);
  });

  it('окружность из общего уравнения', () => {
    const k = conic('x^2 + y^2 - 4x + 6y - 12 = 0');
    expect([k.kind, r(k.a), r(k.center.x), r(k.center.y)]).toEqual(['circle', 5, 2, -3]);
  });

  it('гипербола: асимптоты, эксцентриситет; xy = 4 — повёрнутая', () => {
    const k = conic('x^2/9 - y^2/16 = 1');
    expect([k.kind, r(k.a), r(k.b), r(k.c), r(k.e)]).toEqual(['hyperbola', 3, 4, 5, r(5 / 3)]);
    const as = conicElements(k).asymptotes.map((l) => r(l.d.y / l.d.x)).sort();
    expect(as).toEqual([r(-4 / 3), r(4 / 3)]);
    const h = conic('x·y = 4');
    expect([h.kind, r(h.a), r(h.b)]).toEqual(['hyperbola', r(Math.sqrt(8)), r(Math.sqrt(8))]);
    // Вторая (мнимая) ось — y: −y²/16 + x²/9 … ; переставленные знаки — та же гипербола вдоль y.
    const v = conic('y^2/4 - x^2 = 1');
    expect([v.kind, r(v.a), r(v.b), r(Math.abs(Math.sin(v.theta)))]).toEqual(['hyperbola', 2, 1, 1]);
  });

  it('парабола: функция и уравнение, фокус и директриса', () => {
    const k = conic('y = x^2 - 4x + 3');
    expect([k.kind, r(k.p), r(k.center.x), r(k.center.y)]).toEqual(['parabola', 0.5, 2, -1]);
    const e = conicElements(k);
    expect([r(e.foci[0]!.x), r(e.foci[0]!.y)]).toEqual([2, -0.75]);
    expect(r(e.directrices[0]!.p.y)).toBe(-1.25);
    const k2 = conic('y^2 = -8x');
    expect([k2.kind, r(k2.p)]).toEqual(['parabola', 4]);
    expect([r(conicElements(k2).foci[0]!.x), r(conicElements(k2).foci[0]!.y)]).toEqual([-2, 0]);
  });

  it('вырожденные и мнимые, ошибки', () => {
    expect(conic('x^2 - y^2 = 0').kind).toBe('degenerate');
    expect(conic('x^2 + y^2 + 1 = 0').kind).toBe('empty');
    expect(parseQuadratic('y = x^3', {})).toEqual({ error: 'Это не кривая второго порядка (степень выше второй или sin, √…)' });
    expect(parseQuadratic('y = 2x', {})).toEqual({ error: 'Нет x², xy, y² — это прямая, а не кривая второго порядка' });
  });

  it('векторы: угол', () => {
    expect(vangle({ x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 9);
  });
});
