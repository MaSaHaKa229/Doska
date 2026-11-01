import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, loginRequestSchema, parseUserPreferences, DEFAULT_USER_PREFERENCES } from './auth.js';

describe('схемы авторизации', () => {
  it('логин нормализуется', () => {
    const r = loginRequestSchema.parse({ login: '  Ivanov.I ', password: 'x' });
    expect(r.login).toBe('ivanov.i');
  });
  it('недопустимый логин', () => {
    expect(loginRequestSchema.safeParse({ login: 'иванов', password: 'x' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ login: 'ab', password: 'x' }).success).toBe(false);
  });
  it('политика паролей', () => {
    expect(checkPasswordPolicy('kot12345', 'ivanov')).toEqual([]);
    expect(checkPasswordPolicy('Пароль2026')).toEqual([]);
    expect(checkPasswordPolicy('short1')).toContain('Не короче 8 символов');
    expect(checkPasswordPolicy('onlyletters')).toContain('Должна быть хотя бы одна цифра');
    expect(checkPasswordPolicy('12345678')).toContain('Должна быть хотя бы одна буква');
    expect(checkPasswordPolicy('ivanov2026', 'ivanov')).toContain('Не должен содержать логин');
  });
  it('настройки пользователя: битые данные → по умолчанию', () => {
    expect(parseUserPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(parseUserPreferences({ theme: 'dark' })).toEqual({ ...DEFAULT_USER_PREFERENCES, theme: 'dark' });
    expect(parseUserPreferences({ theme: 'neon' })).toEqual(DEFAULT_USER_PREFERENCES);
  });
});
