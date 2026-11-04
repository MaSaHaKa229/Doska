import { describe, expect, it } from 'vitest';
import { registry } from '../../plugins/registry';
import { PARTICLES, bz, crossZ, lenz, orbit, rotor, wireTangent } from './magnet';

describe('направления', () => {
  it('сила Лоренца (правило левой руки): протон вправо, поле от нас — сила вверх; поле на нас — вниз', () => {
    expect(crossZ(1, 0, bz(1, 'in')).y).toBe(-1);
    expect(crossZ(1, 0, bz(1, 'out')).y).toBe(1);
    // Проводник с током влево в поле от нас — сила вниз.
    expect(crossZ(-1, 0, bz(1, 'in')).y).toBe(1);
  });

  it('обход окружности: протон в поле от нас — против часовой стрелки, электрон — по часовой', () => {
    expect(orbit(PARTICLES.proton.q, PARTICLES.proton.m, 1e6, 0.1, 'in').turn).toBe(-1);
    expect(orbit(PARTICLES.electron.q, PARTICLES.electron.m, 1e6, 0.1, 'in').turn).toBe(1);
    expect(orbit(PARTICLES.proton.q, PARTICLES.proton.m, 1e6, 0.1, 'out').turn).toBe(1);
  });

  it('правило буравчика: ток на нас — линии против часовой стрелки (справа от провода — вверх)', () => {
    const t = wireTangent(0, 'out');
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(-1);
    expect(wireTangent(0, 'in').y).toBeCloseTo(1);
  });
});

describe('величины', () => {
  it('протон 10⁶ м/с в поле 0,1 Тл: r = mv/(qB) ≈ 10,4 см, T = 2πm/(qB), F = qvB', () => {
    const o = orbit(1.6e-19, 1.67e-27, 1e6, 0.1, 'in');
    expect(o.r).toBeCloseTo(0.104375, 6);
    expect(o.T).toBeCloseTo((2 * Math.PI * 1.67e-27) / 1.6e-20, 15);
    expect(o.F).toBeCloseTo(1.6e-14, 20);
  });

  it('рамка: Φ = BS cos ωt, ε = NBSω sin ωt, εmax = NBSω', () => {
    const r = rotor(0.2, 400, 100, 0.5);
    expect(r.emfMax).toBeCloseTo(100 * 0.2 * 0.04 * Math.PI, 9);
    expect(r.flux(0)).toBeCloseTo(0.008, 12);
    expect(r.emf(0.5)).toBeCloseTo(r.emfMax, 9);
    expect(r.flux(0.5)).toBeCloseTo(0, 12);
  });

  it('правило Ленца: при приближении кольцо обращено к магниту одноимённым полюсом, при удалении — разноимённым', () => {
    expect(lenz(1, 4, 'N')).toMatchObject({ approaching: true, ringPole: 'N' });
    expect(lenz(3, 4, 'N')).toMatchObject({ approaching: false, ringPole: 'S' });
    expect(lenz(1, 4, 'S').ringPole).toBe('S');
    expect(lenz(2, 4, 'N').x).toBeCloseTo(1);
  });
});

describe('плагин', () => {
  it('7 объектов и 7 инструментов магнетизма', () => {
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.magnetism.'))).toHaveLength(7);
    for (const t of ['wire', 'coil', 'magnet', 'lorentz', 'ampere', 'rotor', 'lenz']) expect(registry.getObjectModule(`physics.magnetism.${t}`)).toBeTruthy();
  });
});
