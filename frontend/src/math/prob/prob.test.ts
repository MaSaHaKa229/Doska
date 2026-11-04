import { describe, expect, it } from 'vitest';
import { binom, distribution, erf, eventProb, experiment, histogram, parseData, poissonPmf, stats, tree, trials } from './prob';

describe('опыты', () => {
  it('классическая вероятность и частота при большом числе опытов', () => {
    const die = experiment('die', 'even', 0, 0);
    expect(eventProb(die)).toBeCloseTo(0.5, 12);
    expect(eventProb(experiment('die', 'gt4', 0, 0))).toBeCloseTo(1 / 3, 12);
    const urn = experiment('urn', 'red', 3, 7);
    expect(eventProb(urn)).toBeCloseTo(0.3, 12);
    const t = trials(urn, 42, 20000);
    const freq = t.filter((i) => i === 0).length / t.length;
    expect(Math.abs(freq - 0.3)).toBeLessThan(0.015);
    // Серия одна и та же у всех: зависит только от зерна.
    expect(trials(die, 7, 50)).toEqual(trials(die, 7, 50));
    expect(trials(die, 7, 50)).not.toEqual(trials(die, 8, 50));
  });
});

describe('полная вероятность и Байес', () => {
  it('три завода: 0,3·0,9 + 0,5·0,8 + 0,2·0,6 = 0,79', () => {
    const r = tree([0.3, 0.5, 0.2], [0.9, 0.8, 0.6]);
    expect(r.pA).toBeCloseTo(0.79, 12);
    expect(r.posterior[0]).toBeCloseTo(0.27 / 0.79, 12);
    expect(r.posterior.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(r.sumH).toBeCloseTo(1, 12);
  });
});

describe('распределения', () => {
  it('биномиальное: C₁₀³ = 120, сумма вероятностей 1, E = np', () => {
    expect(binom(10, 3)).toBe(120);
    const b = distribution('binomial', { n: 10, p: 0.3, lambda: 1, mu: 0, sigma: 1, a: 0, b: 1 });
    expect(b.prob(0, 10)).toBeCloseTo(1, 12);
    expect(b.E).toBeCloseTo(3, 12);
    expect(b.D).toBeCloseTo(2.1, 12);
    expect(b.prob(3, 3)).toBeCloseTo(120 * 0.3 ** 3 * 0.7 ** 7, 12);
  });

  it('Пуассон, нормальное (правило трёх сигм), равномерное', () => {
    expect(poissonPmf(2, 0)).toBeCloseTo(Math.exp(-2), 12);
    expect(erf(1)).toBeCloseTo(0.8427, 4);
    const n = distribution('normal', { n: 1, p: 0, lambda: 1, mu: 10, sigma: 2, a: 0, b: 1 });
    expect(n.prob(8, 12)).toBeCloseTo(0.6827, 3);
    expect(n.prob(4, 16)).toBeCloseTo(0.9973, 3);
    const u = distribution('uniform', { n: 1, p: 0, lambda: 1, mu: 0, sigma: 1, a: 2, b: 6 });
    expect(u.prob(3, 4)).toBeCloseTo(0.25, 12);
    expect(u.E).toBe(4);
    expect(u.D).toBeCloseTo(16 / 12, 12);
  });
});

describe('описательная статистика', () => {
  it('разбор записи данных', () => {
    expect(parseData('5; 7,5; 8')).toEqual([5, 7.5, 8]);
    expect(parseData('5, 7,5, 8')).toEqual([5, 7.5, 8]);
    expect(parseData('5,7,8')).toEqual([5, 7, 8]);
    expect(parseData('3 −1 4')).toEqual([3, -1, 4]);
    expect(parseData('3 a 4')).toEqual({ error: '«a» — не число' });
  });

  it('среднее, медиана, мода, размах, дисперсия, квартили', () => {
    const s = stats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.modes).toEqual([4]);
    expect(s.range).toBe(7);
    expect(s.variance).toBe(4);
    expect(s.sd).toBe(2);
    expect([s.q1, s.q3]).toEqual([4, 6]);
    expect(stats([1, 2, 3]).modes).toEqual([]);
    expect(stats([3, 1, 2]).median).toBe(2);
  });

  it('гистограмма: максимум попадает в последний интервал', () => {
    const h = histogram([0, 1, 2, 3, 4, 10], 5);
    expect(h).toHaveLength(5);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(h[4]!.count).toBe(1);
  });
});

describe('объекты раздела', () => {
  it('опыт: число проведённых опытов по времени показа, «Новая серия» меняет зерно и запускает; 4 инструмента', async () => {
    const { doneAt, experimentModule, experimentOf, treeArrays, treeModule } = await import('./objects');
    const { registry } = await import('../../plugins/registry');
    const p = experimentModule.createProps();
    expect(doneAt(p, 0)).toBe(0);
    expect(doneAt(p, 5)).toBe(500);
    expect(doneAt(p, 99)).toBe(1000);
    expect(experimentOf({ ...p, kind: 'coin', event: 'e3' }).event).toBe('выпал орёл');
    let patch: { props: { seed: number; play: { running: boolean } } } | null = null;
    experimentModule.runAction!({ id: 'e', props: p } as never, 'new', { now: 5, updateObject: (_: string, v: never) => (patch = v) } as never);
    expect(patch!.props.seed).toBe(2);
    expect(patch!.props.play.running).toBe(true);
    expect(treeArrays(treeModule.createProps()).pH).toEqual([0.3, 0.5, 0.2]);
    expect(registry.listTools().filter((t) => t.id.startsWith('math.prob.'))).toHaveLength(4);
  });
});
