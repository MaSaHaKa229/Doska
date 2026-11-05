import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@doska/shared';
import { registry } from '../../plugins/registry';
import { condition, intensity, maximaCount, pathDiff, soundInfo, standing, travelling } from './wave';
import { interferenceModule, type InterferenceProps } from './wavemodules';

describe('волны', () => {
  it('бегущая: ν = v/λ, T = 1/ν; через период и через λ смещение повторяется', () => {
    const w = travelling(2, 2, 4);
    expect(w.nu).toBe(2);
    expect(w.T).toBe(0.5);
    expect(w.s(0.3, 0.1 + w.T)).toBeCloseTo(w.s(0.3, 0.1), 12);
    expect(w.s(0.3 + 2, 0.1)).toBeCloseTo(w.s(0.3, 0.1), 12);
  });

  it('стоячая: λ = 2L/n, ν = nv/(2L); в узлах всегда ноль, в пучностях — удвоенная амплитуда', () => {
    const s = standing(1, 3, 200, 1);
    expect(s.lambda).toBeCloseTo(2 / 3, 12);
    expect(s.nu).toBeCloseTo(300, 9);
    expect(s.nodes).toHaveLength(4);
    for (const x of s.nodes) expect(Math.abs(s.y(x, 0.0013))).toBeLessThan(1e-12);
    expect(s.envelope(s.antinodes[0]!)).toBeCloseTo(2, 12);
  });

  it('интерференция: на оси симметрии — центральный максимум; минимум при Δ = λ/2', () => {
    expect(pathDiff(0, -100, 120)).toBeCloseTo(0, 12);
    expect(intensity(0, 40)).toBe(1);
    expect(intensity(20, 40)).toBeCloseTo(0, 12);
    expect(condition(80, 40)).toEqual({ kind: 'max', order: 2 });
    expect(condition(-60, 40)).toEqual({ kind: 'min', order: 1 });
    expect(condition(10, 40).kind).toBe('mid');
    expect(maximaCount(120, 40)).toBe(7);
  });

  it('звук: λ = v/ν; граница слышимости 20 Гц — 20 кГц', () => {
    expect(soundInfo(340).lambda).toBe(1);
    expect(soundInfo(10).pitch).toMatch(/инфразвук/);
    expect(soundInfo(30000).pitch).toMatch(/ультразвук/);
    expect(soundInfo(440).pitch).toBe('средний тон');
  });

  it('точка M интерференции тянется в пределах картины; 8 инструментов раздела', () => {
    const o = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: interferenceModule.createProps() } as unknown as BoardObject<InterferenceProps>;
    expect(interferenceModule.dragHandle!(o, 'probe', { x: 900, y: -40 }, { shift: false, alt: false, ctrl: false }, {} as never)).toEqual({ props: { probe: { x: 440, y: 0 } } });
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.waves.'))).toHaveLength(8);
  });
});
