import { describe, expect, it } from 'vitest';
import { binding, closest, daughter, level, lifetime, massOf, parseReaction, remaining, scatterAngle, symbolOf, trajectory, transition, zOf } from './nuclear';

describe('атом Бора', () => {
  it('уровни −13,6/n² эВ; линия Hα (3 → 2) ≈ 656 нм, серия Бальмера', () => {
    expect(level(1)).toBe(-13.6);
    expect(level(2)).toBeCloseTo(-3.4, 12);
    const h = transition(3, 2);
    expect(h.E).toBeCloseTo(1.889, 3);
    expect(h.lambda).toBeCloseTo(658, 0);
    expect(h.series).toBe('Бальмера');
    expect(transition(2, 1).lambda).toBeCloseTo(122, 0);
    expect(transition(4, 3).series).toBe('Пашена');
  });
});

describe('опыт Резерфорда', () => {
  it('золото и α-частица 5 МэВ: d ≈ 4,5·10⁻¹⁴ м', () => {
    expect(closest(79, 5)).toBeCloseTo(4.55e-14, 15);
  });

  it('траектория совпадает с формулой tg(θ/2) = d/(2b)', () => {
    for (const b of [20, 60]) {
      const pts = trajectory(b, 40, 2000, 40000);
      const [p, q] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
      const theta = Math.atan2(q.y - p.y, q.x - p.x);
      expect(Math.abs(theta)).toBeCloseTo(scatterAngle(b, 40), 1);
    }
  });
});

describe('ядро', () => {
  it('гелий-4: дефект масс 0,0304 а. е. м., энергия связи 28,3 МэВ', () => {
    const b = binding(2, 4, massOf(2, 4)!);
    expect(b.dm).toBeCloseTo(0.0304, 4);
    expect(b.E).toBeCloseTo(28.3, 1);
    expect(binding(26, 56, massOf(26, 56)!).perNucleon).toBeCloseTo(8.79, 2);
  });

  it('символы элементов', () => {
    expect(symbolOf(92)).toBe('U');
    expect(zOf('fe')).toBe(26);
    expect(symbolOf(0)).toBe('n');
  });

  it('распад: N = N₀·2^(−t/T), продукты α и β распадов', () => {
    expect(remaining(1000, 2, 1)).toBe(250);
    expect(daughter(92, 238, 'alpha')).toEqual({ Z: 90, A: 234 });
    expect(daughter(6, 14, 'beta')).toEqual({ Z: 7, A: 14 });
    expect(lifetime(0.5)).toBe(1);
  });
});

describe('ядерные реакции', () => {
  it('Li7 + p → 2 He4: сохранение и выход 17,3 МэВ', () => {
    const r = parseReaction('Li7 + p -> 2 He4');
    if ('error' in r) throw new Error(r.error);
    expect([r.zl, r.zr, r.al, r.ar]).toEqual([4, 4, 8, 8]);
    expect(r.Q).toBeCloseTo(17.35, 1);
  });

  it('неизвестное X: протон Резерфорда, нейтрон Чедвика, три нейтрона деления', () => {
    const a = parseReaction('N14 + a → O17 + X');
    if ('error' in a) throw new Error(a.error);
    expect(a.unknown?.sym).toBe('p');
    expect(a.Q).toBeCloseTo(-1.19, 1);
    const b = parseReaction('Be9 + α -> C12 + X');
    if ('error' in b) throw new Error(b.error);
    expect(b.unknown?.sym).toBe('n');
    const c = parseReaction('U235 + n -> Ba141 + Kr92 + X');
    if ('error' in c) throw new Error(c.error);
    expect(c.unknown).toMatchObject({ sym: 'n', count: 3 });
    expect(c.Q).toBeGreaterThan(150);
  });

  it('β-распад углерода-14 по массам атомов; ошибки записи', () => {
    const r = parseReaction('C14 -> N14 + e');
    if ('error' in r) throw new Error(r.error);
    expect(r.zl).toBe(r.zr);
    expect(r.Q).toBeCloseTo(0.156, 2);
    expect(parseReaction('Li7 + p')).toHaveProperty('error');
    expect(parseReaction('Qq7 -> n')).toHaveProperty('error');
    // Нарушен закон сохранения — выход не считается.
    const bad = parseReaction('Li7 + p -> He4 + He3');
    if ('error' in bad) throw new Error(bad.error);
    expect(bad.al).not.toBe(bad.ar);
    expect(bad.Q).toBeNull();
  });
});

describe('объекты атома и ядра', () => {
  it('на рисунке распада за период распадается около половины ядер, картина одна у всех', async () => {
    const { decayedAt, REACTION_PRESETS } = await import('./atoms');
    const d = decayedAt(2000, 1, 7);
    const share = d.filter(Boolean).length / 2000;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
    expect(decayedAt(50, 1.3, 7)).toEqual(decayedAt(50, 1.3, 7));
    // Все готовые реакции разбираются и сохраняют заряд и массовое число.
    for (const p of Object.values(REACTION_PRESETS)) {
      const r = parseReaction(p.eq);
      if ('error' in r) throw new Error(r.error);
      expect(r.zl).toBe(r.zr);
      expect(r.al).toBe(r.ar);
      expect(r.Q).not.toBeNull();
    }
  });
});
