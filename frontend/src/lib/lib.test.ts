import { describe, expect, it } from 'vitest';
import { decodeText } from './files';
import { currentAcademicYear, formatRelative, pluralize } from './format';

describe('файлы', () => {
  it('UTF-8 с BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ФИО;Класс')]);
    expect(decodeText(bytes)).toEqual({ text: 'ФИО;Класс', encoding: 'utf-8' });
  });
  it('Windows-1251 (CSV из русского Excel)', () => {
    // «ФИО» в cp1251: D4 C8 CE
    expect(decodeText(new Uint8Array([0xd4, 0xc8, 0xce, 0x3b, 0x41]))).toEqual({ text: 'ФИО;A', encoding: 'windows-1251' });
  });
});

describe('форматирование', () => {
  it('склонение', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((n) => pluralize(n, 'ученик', 'ученика', 'учеников'))).toEqual([
      'ученик', 'ученика', 'учеников', 'учеников', 'ученик', 'ученика', 'учеников', 'учеников',
    ]);
  });
  it('учебный год', () => {
    expect(currentAcademicYear(new Date(2026, 8, 1))).toBe('2026/2027');
    expect(currentAcademicYear(new Date(2027, 4, 20))).toBe('2026/2027');
  });
  it('относительное время', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(formatRelative(null)).toBe('никогда');
    expect(formatRelative('2026-11-01T11:59:30Z', now)).toBe('только что');
    expect(formatRelative('2026-11-01T11:30:00Z', now)).toBe('30 мин назад');
    expect(formatRelative('2026-10-31T10:00:00Z', now)).toBe('вчера');
  });
});
