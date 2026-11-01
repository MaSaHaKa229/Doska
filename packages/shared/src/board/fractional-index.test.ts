import { describe, expect, it } from 'vitest';
import {
  compareOrder,
  generateKeyBetween,
  generateNKeysBetween,
  isValidOrderKey,
} from './fractional-index.js';

describe('fractional-index', () => {
  it('первый ключ и вставки в конец/начало', () => {
    expect(generateKeyBetween(null, null)).toBe('a0');
    expect(generateKeyBetween('a0', null)).toBe('a1');
    expect(generateKeyBetween(null, 'a0')).toBe('Zz');
    expect(generateKeyBetween('az', null)).toBe('b00');
    expect(generateKeyBetween('Zz', 'a0')).toBe('ZzV');
    expect(generateKeyBetween('a0', 'a1')).toBe('a0V');
  });

  it('ключ всегда строго между соседями', () => {
    const keys = ['a0'];
    // Многократная вставка в одно и то же место (худший случай роста длины).
    let lo = 'a0';
    const hi = 'a1';
    for (let i = 0; i < 200; i++) {
      const k = generateKeyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      expect(isValidOrderKey(k)).toBe(true);
      lo = k;
      keys.push(k);
    }
    expect(lo.length).toBeLessThan(60);
  });

  it('случайные вставки сохраняют порядок', () => {
    let rng = 42;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) % 2 ** 31;
      return rng / 2 ** 31;
    };
    const list: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const pos = Math.floor(rand() * (list.length + 1));
      const k = generateKeyBetween(list[pos - 1] ?? null, list[pos] ?? null);
      list.splice(pos, 0, k);
    }
    const sorted = [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });

  it('многократное добавление в начало и конец', () => {
    let first = 'a0';
    let last = 'a0';
    for (let i = 0; i < 5000; i++) {
      const f = generateKeyBetween(null, first);
      const l = generateKeyBetween(last, null);
      expect(f < first).toBe(true);
      expect(l > last).toBe(true);
      first = f;
      last = l;
    }
  });

  it('generateNKeysBetween даёт упорядоченные уникальные ключи', () => {
    for (const [a, b] of [
      [null, null],
      ['a0', null],
      [null, 'a0'],
      ['a0', 'a1'],
    ] as const) {
      const keys = generateNKeysBetween(a, b, 50);
      expect(keys).toHaveLength(50);
      for (let i = 1; i < keys.length; i++) expect((keys[i - 1] as string) < (keys[i] as string)).toBe(true);
      if (a) expect((keys[0] as string) > a).toBe(true);
      if (b) expect((keys[keys.length - 1] as string) < b).toBe(true);
    }
  });

  it('ошибки на неверных аргументах', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow();
    expect(() => generateKeyBetween('a0', 'a0')).toThrow();
    expect(() => generateKeyBetween('a10', null)).toThrow(); // дробная часть оканчивается нулём
    expect(isValidOrderKey('!!')).toBe(false);
    expect(isValidOrderKey('a')).toBe(false);
    expect(isValidOrderKey('a0')).toBe(true);
  });

  it('compareOrder разрешает совпадения ключей по id', () => {
    const items = [
      { z: 'a1', id: 'b' },
      { z: 'a1', id: 'a' },
      { z: 'a0', id: 'z' },
    ];
    expect(items.sort(compareOrder).map((i) => i.id)).toEqual(['z', 'a', 'b']);
  });
});
