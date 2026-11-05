import { describe, expect, it } from 'vitest';
import { registry } from '../../plugins/registry';
import { beats, lc, oscillator, pendulum } from './osc';

describe('колебания', () => {
  it('маятник: T = 2π√(l/g); натяжение в нижней точке больше mg', () => {
    const p = pendulum(1, 9.8, 15, 0.5);
    expect(p.T).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 9.8), 12);
    expect(p.theta(0)).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(p.tension(p.T / 4)).toBeGreaterThan(0.5 * 9.8);
    expect(p.tension(0)).toBeCloseTo(0.5 * 9.8 * Math.cos((15 * Math.PI) / 180), 9);
  });

  it('затухающие: огибающая A₀e^(−βt), частота ω_d = √(ω₀² − β²)', () => {
    const o = oscillator(40, 1, 1, 0.2, 2);
    expect(o.omega0).toBeCloseTo(Math.sqrt(40), 12);
    expect(o.beta).toBeCloseTo(0.5, 12);
    expect(o.omegaD).toBeCloseTo(Math.sqrt(40 - 0.25), 12);
    expect(o.free(0)).toBeCloseTo(0.2, 12);
    for (const t of [0.3, 1, 2.5]) expect(Math.abs(o.free(t))).toBeLessThanOrEqual(o.envelope(t) * Math.sqrt(1 + (o.beta / o.omegaD) ** 2) + 1e-12);
    // Сильное затухание — без колебаний.
    expect(oscillator(1, 1, 10, 1, 0).omegaD).toBe(0);
  });

  it('вынужденные: максимум амплитуды при ω = √(ω₀² − 2β²), при слабом затухании — почти ω₀', () => {
    const o = oscillator(40, 1, 1, 0.2, 2);
    const ws = Array.from({ length: 3001 }, (_, i) => (i / 1000) * o.omega0);
    const best = ws.reduce((a, w) => (o.amplitude(w) > o.amplitude(a) ? w : a), 0);
    expect(best).toBeCloseTo(o.resonance, 1);
    expect(o.amplitude(0)).toBeCloseTo(2 / 40, 12);
    expect(o.phase(o.omega0)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('биения: сумма гармоник, частота биений |ν₁ − ν₂|', () => {
    const b = beats(1, 10, 1, 11);
    expect(b.fb).toBe(1);
    expect(b.sum(0)).toBe(2);
    expect(Math.abs(b.sum(0.5))).toBeLessThan(0.05);
  });

  it('контур: T = 2π√(LC); энергия переходит из конденсатора в катушку и сохраняется', () => {
    const c = lc(0.1, 1e-5, 5e-5);
    expect(c.T).toBeCloseTo(2 * Math.PI * Math.sqrt(1e-6), 12);
    for (const t of [0, c.T / 8, c.T / 4, 0.7 * c.T]) expect(c.wc(t) + c.wl(t)).toBeCloseTo(c.W, 15);
    expect(c.wl(c.T / 4)).toBeCloseTo(c.W, 15);
  });

  it('плагин: инструменты колебаний на месте', () => {
    for (const t of ['pendulum', 'oscillator', 'beats', 'lc']) expect(registry.getTool(`physics.waves.${t}`)).toBeTruthy();
  });
});
