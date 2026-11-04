import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@doska/shared';
import { registry } from '../../plugins/registry';
import { sci, sup } from '../common/quantities';
import { addVelocities, bandOf, deBroglie, gamma, photoCurrent, photoeffect, photon, relativity, speedAfter, wavelengthColor } from './quantum';
import { type SpectrumProps, dbOf, spectrumModule } from './objects';

describe('теория относительности', () => {
  it('γ = 1/√(1 − β²): при 0,6c — 1,25, при 0,8c — 5/3', () => {
    expect(gamma(0)).toBe(1);
    expect(gamma(0.6)).toBeCloseTo(1.25, 12);
    expect(gamma(0.8)).toBeCloseTo(5 / 3, 12);
  });

  it('замедление времени, сокращение длины, энергия', () => {
    const r = relativity(0.8, 1, 10, 1);
    expect(r.t).toBeCloseTo(5 / 3, 12);
    expect(r.l).toBeCloseTo(6, 12);
    expect(r.E0 / 9e16).toBeCloseTo(1, 12);
    expect(r.Ek / 6e16).toBeCloseTo(1, 12);
    // При малой скорости кинетическая энергия совпадает с mv²/2.
    const s = relativity(1e-4, 1, 1, 1);
    expect(s.Ek / s.EkClassic).toBeCloseTo(1, 6);
  });

  it('сложение скоростей не превышает c', () => {
    expect(addVelocities(0.5, 0.5)).toBeCloseTo(0.8, 12);
    expect(addVelocities(1, 0.9)).toBeCloseTo(1, 12);
    expect(addVelocities(0, 0.3)).toBeCloseTo(0.3, 12);
  });
});

describe('фотоэффект', () => {
  it('hν = A + Eₖ, задерживающее напряжение и красная граница', () => {
    const pe = photoeffect(400, 2.2);
    expect(pe.Ephoton).toBeCloseTo(3.108, 2);
    expect(pe.Ek).toBeCloseTo(pe.Ephoton - 2.2, 12);
    expect(pe.Ustop).toBeCloseTo(pe.Ek, 12);
    expect(pe.lambdaMax).toBeCloseTo(565, 0);
    expect(pe.nuMin).toBeCloseTo((2.2 * 1.6e-19) / 6.63e-34, -10);
  });

  it('за красной границей фотоэффекта нет при любой интенсивности', () => {
    const pe = photoeffect(700, 2.2);
    expect(pe.happens).toBe(false);
    expect(pe.Ek).toBe(0);
    expect(photoCurrent(5, pe.Ustop, 1, pe.happens)).toBe(0);
  });

  it('ВАХ: ноль при U ≤ −U₃, насыщение пропорционально интенсивности', () => {
    const pe = photoeffect(300, 2.2);
    expect(photoCurrent(-pe.Ustop - 0.01, pe.Ustop, 1, true)).toBe(0);
    expect(photoCurrent(5, pe.Ustop, 1, true)).toBe(1);
    expect(photoCurrent(5, pe.Ustop, 0.4, true)).toBeCloseTo(0.4, 12);
    expect(photoCurrent(0, pe.Ustop, 1, true)).toBeLessThan(1);
  });
});

describe('фотон и де Бройль', () => {
  it('фотон 500 нм: ν = 6·10¹⁴ Гц, E ≈ 2,5 эВ, диапазон — видимый свет', () => {
    const ph = photon(5e-7);
    expect(ph.nu).toBeCloseTo(6e14, -8);
    expect(ph.eV).toBeCloseTo(2.49, 2);
    expect(ph.p).toBeCloseTo(6.63e-34 / 5e-7, 40);
    expect(bandOf(5e-7)).toBe('Видимый свет');
    expect(bandOf(1e-10)).toBe('Рентгеновское');
    expect(bandOf(1)).toBe('Радиоволны');
    expect(wavelengthColor(1000)).toBeNull();
    expect(wavelengthColor(650)).toMatch(/^rgb/);
  });

  it('электрон после 100 В: λ ≈ 0,12 нм — порядок межатомных расстояний', () => {
    const v = speedAfter(9.1e-31, 1.6e-19, 100);
    expect(v).toBeCloseTo(Math.sqrt((2 * 1.6e-19 * 100) / 9.1e-31), -4);
    expect(deBroglie(9.1e-31, v).lambda).toBeCloseTo(1.23e-10, 11);
    // Тело 0,1 кг при 10 м/с: λ = h/(mv).
    expect(deBroglie(0.1, 10).lambda).toBeCloseTo(6.63e-34, 40);
  });

  it('нейтрон не разгоняется напряжением — берётся заданная скорость', () => {
    const d = dbOf({ particle: 'neutron', m: 1, mode: 'U', v: 2000, U: 100 });
    expect(d.byU).toBe(false);
    expect(d.v).toBe(2000);
  });

  it('запись чисел: степени десяти', () => {
    expect(sci(6.21e-21)).toBe('6,21·10⁻²¹');
    expect(sci(9e16)).toBe('9·10¹⁶');
    expect(sci(1.25)).toBe('1,25');
    expect(sup(-14)).toBe('⁻¹⁴');
  });

  it('отметка шкалы тянется в пределах [10⁻¹⁴, 10⁴] м; 4 инструмента раздела', () => {
    const o = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: spectrumModule.createProps() } as unknown as BoardObject<SpectrumProps>;
    const mods = { shift: false, alt: false, ctrl: false };
    expect(spectrumModule.dragHandle!(o, 'lg', { x: 9999, y: 0 }, mods, {} as never)).toEqual({ props: { lg: 4 } });
    expect(spectrumModule.dragHandle!(o, 'lg', { x: 320, y: 0 }, mods, {} as never)).toEqual({ props: { lg: -5 } });
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.modern.'))).toHaveLength(4);
  });
});
