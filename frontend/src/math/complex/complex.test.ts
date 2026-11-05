import { beforeAll, describe, expect, it } from 'vitest';
import type { MathJsInstance } from 'mathjs';
import { getMath, loadMath } from '../analysis/expr';
import { abs, add, algebraic, arg, compileRegion, conj, div, forms, mul, piFraction, power, roots } from './complex';

let m: MathJsInstance;
beforeAll(async () => {
  await loadMath();
  m = getMath()!;
});

describe('действия', () => {
  it('сумма, произведение, деление, сопряжение', () => {
    const a = { re: 3, im: 2 };
    const b = { re: 1, im: -1 };
    expect(add(a, b)).toEqual({ re: 4, im: 1 });
    expect(mul(a, b)).toEqual({ re: 5, im: -1 });
    const q = div(a, b)!;
    expect(q.re).toBeCloseTo(0.5, 12);
    expect(q.im).toBeCloseTo(2.5, 12);
    expect(div(a, { re: 0, im: 0 })).toBeNull();
    expect(conj(a)).toEqual({ re: 3, im: -2 });
    // |z₁z₂| = |z₁||z₂|, arg складываются.
    expect(abs(mul(a, b))).toBeCloseTo(abs(a) * abs(b), 12);
    expect(arg(mul(a, b))).toBeCloseTo(arg(a) + arg(b), 12);
  });

  it('Муавр и корни: (1 + i)⁸ = 16; корни 3-й степени из 8 — 2, −1 ± i√3', () => {
    const p = power({ re: 1, im: 1 }, 8);
    expect(p.re).toBeCloseTo(16, 9);
    expect(p.im).toBeCloseTo(0, 9);
    const r = roots({ re: 8, im: 0 }, 3);
    expect(r[0]!.re).toBeCloseTo(2, 12);
    expect(r[1]!.re).toBeCloseTo(-1, 12);
    expect(r[1]!.im).toBeCloseTo(Math.sqrt(3), 12);
    for (const w of roots({ re: -1, im: 2 }, 5)) {
      const back = power(w, 5);
      expect(back.re).toBeCloseTo(-1, 9);
      expect(back.im).toBeCloseTo(2, 9);
    }
  });
});

describe('запись', () => {
  it('алгебраическая форма', () => {
    expect(algebraic({ re: 3, im: 2 })).toBe('3 + 2i');
    expect(algebraic({ re: 0, im: -1 })).toBe('−i');
    expect(algebraic({ re: -2.5, im: 0 })).toBe('−2,5');
    expect(algebraic({ re: 1, im: -0.5 })).toBe('1 − 0,5i');
  });

  it('углы долями π и три формы', () => {
    expect(piFraction(Math.PI / 4)).toBe('π/4');
    expect(piFraction((-2 * Math.PI) / 3)).toBe('−2π/3');
    expect(piFraction(Math.PI)).toBe('π');
    expect(piFraction(1)).toBeNull();
    const f = forms({ re: 1, im: 1 });
    expect(f.trig).toBe('1,41(cos π/4 + i·sin π/4)');
    expect(f.exp).toBe('1,41e^(i·π/4)');
    expect(forms({ re: 0, im: 1 }).trig).toBe('(cos π/2 + i·sin π/2)');
  });
});

describe('множества на плоскости', () => {
  it('круг |z − 1 − i| < 2, кольцо, угол arg z, Re/Im, «и»/«или»', () => {
    const disc = compileRegion(m, '|z − 1 − i| < 2');
    if ('error' in disc) throw new Error(disc.error);
    expect(disc(1, 1)).toBe(true);
    expect(disc(3.5, 1)).toBe(false);
    const ring = compileRegion(m, '1 ≤ |z| ≤ 2');
    if ('error' in ring) throw new Error(ring.error);
    expect(ring(1.5, 0)).toBe(true);
    expect(ring(0.5, 0)).toBe(false);
    const sector = compileRegion(m, '0 < arg z < π/4');
    if ('error' in sector) throw new Error(sector.error);
    expect(sector(2, 1)).toBe(true);
    expect(sector(1, 2)).toBe(false);
    const both = compileRegion(m, 'Re z > 0 и Im(z) < 1');
    if ('error' in both) throw new Error(both.error);
    expect(both(1, 0)).toBe(true);
    expect(both(1, 2)).toBe(false);
    const either = compileRegion(m, 'Re z < −1 или Im z > 1');
    if ('error' in either) throw new Error(either.error);
    expect(either(-2, 0)).toBe(true);
    expect(either(0, 0)).toBe(false);
  });

  it('ошибки условий', () => {
    expect(compileRegion(m, '|z| + 1')).toHaveProperty('error');
    expect(compileRegion(m, '|z < 2')).toEqual({ error: 'непарные знаки модуля |…|' });
    expect((compileRegion(m, '|w| < 1') as { error: string }).error).toMatch(/«w»/);
  });
});

describe('объекты раздела', () => {
  it('действия на плоскости и перенос числа с округлением; 2 инструмента', async () => {
    const { operate, planeModule } = await import('./objects');
    const { registry } = await import('../../plugins/registry');
    const base = planeModule.createProps();
    expect(operate({ ...base, op: 'sum' }).w[0]).toEqual({ re: 4, im: 0.5 });
    expect(operate({ ...base, op: 'roots', n: 4 }).w).toHaveLength(4);
    expect(operate({ ...base, op: 'div', numbers: [{ re: 1, im: 0 }, { re: 0, im: 0 }] }).lines[0]).toMatch(/на ноль/);
    expect(operate({ ...base, op: 'mul', numbers: [{ re: 1, im: 0 }] }).lines[0]).toMatch(/второе число/);
    const o = { id: 'p', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: base } as never;
    // Центр области (190; 190) — ноль; 38 пикселей = 1 единица при R = 5.
    const r = planeModule.dragHandle!(o, 'z:0', { x: 190 + 38 * 2, y: 190 - 38 * 3 }, { shift: false, alt: false, ctrl: false }, {} as never) as { props: { numbers: { re: number; im: number }[] } };
    expect(r.props.numbers[0]).toEqual({ re: 2, im: 3 });
    expect(r.props.numbers[1]).toEqual(base.numbers[1]);
    expect(registry.listTools().filter((t) => t.id.startsWith('math.complex.'))).toHaveLength(2);
  });
});
