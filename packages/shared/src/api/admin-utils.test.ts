import { describe, expect, it } from 'vitest';
import { credentialsToCsv, detectDelimiter, parseCsv, parseCsvRows, toCsv } from './csv.js';
import { pickFreeLogin, suggestLoginBase, transliterate } from './translit.js';
import { detectImportColumns, parseRoleCell, createUserSchema, academicYearSchema } from './admin.js';
import { LOGIN_RE } from './auth.js';

describe('транслитерация и логины', () => {
  it('транслитерация', () => {
    expect(transliterate('Щукин Юрий Ёжиков')).toBe('shchukin iurii ezhikov');
    expect(transliterate('Анна-Мария')).toBe('anna mariia');
  });
  it('логин из ФИО', () => {
    expect(suggestLoginBase('Иванов Пётр Сергеевич')).toBe('ivanov.ps');
    expect(suggestLoginBase('Цой')).toBe('tsoi');
    expect(suggestLoginBase('Ли')).toBe('li0');
    expect(suggestLoginBase('Smith John')).toBe('smith.j');
    expect(suggestLoginBase('???')).toBe('user');
    for (const n of ['Иванов Пётр Сергеевич', 'Ли', 'Ъ Ь', 'Smith John', 'Анна-Мария Смит']) {
      expect(suggestLoginBase(n)).toMatch(LOGIN_RE);
    }
  });
  it('свободный логин', () => {
    expect(pickFreeLogin('ivanov.ps', new Set())).toBe('ivanov.ps');
    expect(pickFreeLogin('ivanov.ps', new Set(['ivanov.ps', 'ivanov.ps2']))).toBe('ivanov.ps3');
  });
});

describe('CSV', () => {
  it('определение разделителя', () => {
    expect(detectDelimiter('ФИО;Класс\nА;Б')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('одна колонка')).toBe(';');
  });
  it('кавычки, переносы, BOM, CRLF, пустые строки', () => {
    const text = '\uFEFFФИО;Класс\r\n"Иванов; Пётр";"9 ""А"""\r\n\r\n"Много\nстрок";7Б\r\n';
    expect(parseCsv(text)).toEqual([
      ['ФИО', 'Класс'],
      ['Иванов; Пётр', '9 "А"'],
      ['Много\nстрок', '7Б'],
    ]);
  });
  it('номера строк исходного файла', () => {
    const rows = parseCsvRows('a;b\n\n"x\ny";z\r\n;;\nlast;1');
    expect(rows.map((r) => r.line)).toEqual([1, 3, 6]);
    expect(rows[1]!.cells).toEqual(['x\ny', 'z']);
  });
  it('формирование CSV и защита от формул', () => {
    const csv = toCsv([['=1+1', 'a;b', 'обычное']]);
    expect(csv).toBe('\uFEFF\'=1+1;"a;b";обычное\r\n');
    expect(parseCsv(credentialsToCsv([{ fullName: 'Иванов И.', login: 'ivanov.i', tempPassword: 'abc-def-gh23', className: '9А' }]))).toEqual([
      ['ФИО', 'Класс', 'Логин', 'Временный пароль'],
      ['Иванов И.', '9А', 'ivanov.i', 'abc-def-gh23'],
    ]);
  });
});

describe('импорт: колонки и роли', () => {
  it('заголовок распознаётся в любом порядке', () => {
    expect(detectImportColumns(['Класс', 'ФИО', 'Логин'])).toEqual({ header: true, columns: ['className', 'fullName', 'login'] });
    expect(detectImportColumns(['Иванов Иван', '', 'ученик'])).toEqual({
      header: false,
      columns: ['fullName', 'login', 'role', 'className'],
    });
  });
  it('роли', () => {
    expect(parseRoleCell('Ученик')).toBe('STUDENT');
    expect(parseRoleCell('преподаватель')).toBe('TEACHER');
    expect(parseRoleCell('')).toBeUndefined();
    expect(parseRoleCell('директор')).toBeNull();
  });
  it('схемы', () => {
    expect(createUserSchema.parse({ fullName: '  Иванов   Иван ', role: 'STUDENT' })).toEqual({
      fullName: 'Иванов Иван',
      role: 'STUDENT',
      classIds: [],
    });
    expect(academicYearSchema.safeParse('2026/2027').success).toBe(true);
    expect(academicYearSchema.safeParse('2026/2028').success).toBe(false);
  });
});
