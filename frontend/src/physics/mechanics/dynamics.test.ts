import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@doska/shared';
import { registry } from '../../plugins/registry';
import { atwood, collision, incline, lever, spring } from './dynamics';
import { leverModule, type LeverProps } from './machines';

describe('наклонная плоскость', () => {
  it('скольжение: a = g(sin α − μ cos α), N = mg cos α, Fтр = μN', () => {
    const i = incline({ alpha: 30, m: 2, mu: 0.2, g: 10, len: 4 });
    expect(i.slides).toBe(true);
    expect(i.a).toBeCloseTo(10 * (0.5 - 0.2 * Math.sqrt(3) / 2), 9);
    expect(i.N).toBeCloseTo(20 * Math.sqrt(3) / 2, 9);
    expect(i.Ffr).toBeCloseTo(0.2 * i.N, 9);
    // Время до низа: s = at²/2.
    expect((i.a * i.tEnd ** 2) / 2).toBeCloseTo(i.dist, 9);
  });

  it('tg α ≤ μ — покой, трение покоя равно скатывающей силе', () => {
    const i = incline({ alpha: 10, m: 1, mu: 0.3, g: 10, len: 2 });
    expect(i.slides).toBe(false);
    expect(i.a).toBe(0);
    expect(i.Ffr).toBeCloseTo(10 * Math.sin(Math.PI / 18), 9);
    expect(i.s(2)).toBe(0);
  });
});

describe('блок с грузами', () => {
  it('a = (m₂ − m₁)g/(m₁ + m₂), T = 2m₁m₂g/(m₁ + m₂)', () => {
    const a = atwood(1, 3, 10);
    expect(a.a).toBeCloseTo(5);
    expect(a.T).toBeCloseTo(15);
    expect(a.s(a.tEnd)).toBeCloseTo(a.travel);
    expect(atwood(3, 1, 10).s(10)).toBeCloseTo(-1.2);
    expect(atwood(2, 2, 10).a).toBe(0);
  });
});

describe('пружинный маятник', () => {
  it('T = 2π√(m/k); полная энергия сохраняется', () => {
    const s = spring(40, 1, 0.5);
    expect(s.period).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 40), 9);
    expect(s.x(0)).toBe(0.5);
    for (const t of [0, 0.3, 0.77, 1.4]) {
      const e = s.energy(t);
      expect(e.ek + e.ep).toBeCloseTo(e.e, 9);
    }
    expect(s.energy(s.period / 4).ek).toBeCloseTo(5, 6);
  });
});

describe('столкновение', () => {
  it('упругий удар: сохраняются импульс и энергия; равные массы обмениваются скоростями', () => {
    const c = collision({ m1: 2, v1: 3, m2: 1, v2: -1, elastic: true });
    expect(c.pAfter).toBeCloseTo(c.p, 9);
    expect(c.ekAfter).toBeCloseTo(c.ek, 9);
    const eq = collision({ m1: 1, v1: 2, m2: 1, v2: 0, elastic: true });
    expect([eq.u1, eq.u2]).toEqual([0, 2]);
    // В момент удара шары касаются.
    expect(eq.x2(eq.tc!) - eq.x1(eq.tc!)).toBeCloseTo(eq.r1 + eq.r2, 9);
  });

  it('неупругий: общая скорость, импульс сохраняется, энергия — нет; расходящиеся не сталкиваются', () => {
    const c = collision({ m1: 2, v1: 3, m2: 1, v2: 0, elastic: false });
    expect(c.u1).toBeCloseTo(2);
    expect(c.u2).toBeCloseTo(2);
    expect(c.pAfter).toBeCloseTo(c.p, 9);
    expect(c.ek - c.ekAfter).toBeCloseTo(9 - 6, 9);
    expect(collision({ m1: 1, v1: -1, m2: 1, v2: 1, elastic: true }).tc).toBeNull();
  });
});

describe('рычаг', () => {
  it('правило моментов: M₁ = M₂ — равновесие, иначе перевешивает больший момент', () => {
    expect(lever(2, 1.5, 3, 1, 10).side).toBe(0);
    expect(lever(2, 1.5, 3, 1.2, 10).side).toBe(1);
    expect(lever(4, 1.5, 3, 1, 10)).toMatchObject({ M1: 60, M2: 30, side: -1 });
  });

  it('ручки на концах меняют плечи с шагом 0,05 м', () => {
    const o = { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: leverModule.createProps() } as unknown as BoardObject<LeverProps>;
    expect(leverModule.dragHandle!(o, 'l2', { x: 100 + 1.27 * 80, y: 3 }, { shift: false, alt: false, ctrl: false }, {} as never)).toEqual({ props: { l2: 1.25 } });
    expect(leverModule.dragHandle!(o, 'l1', { x: 100 - 2 * 80, y: 0 }, { shift: false, alt: false, ctrl: false }, {} as never)).toEqual({ props: { l1: 2 } });
  });
});

describe('плагин', () => {
  it('7 объектов и 7 инструментов механики', () => {
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.mechanics.'))).toHaveLength(7);
    for (const t of ['incline', 'pulley', 'spring', 'collision', 'lever']) expect(registry.getObjectModule(`physics.mechanics.${t}`)).toBeTruthy();
  });
});
