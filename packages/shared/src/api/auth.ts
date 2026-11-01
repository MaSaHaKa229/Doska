import { z } from 'zod';
import { USER_ROLES } from '../enums.js';

/**
 * Схемы API авторизации — общие для клиента (формы) и сервера (валидация).
 */

/** Логин: латиница в нижнем регистре, цифры, точка, дефис, подчёркивание. */
export const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export const loginFieldSchema = z
  .string({ required_error: 'Введите логин' })
  .trim()
  .toLowerCase()
  .regex(LOGIN_RE, 'Логин: 3–64 символа — латинские буквы, цифры, точка, дефис, подчёркивание');

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Требования к постоянному паролю. Возвращает список нарушений (пустой — пароль подходит).
 * Требования умеренные (школьники): длина ≥ 8, есть буква и цифра, не совпадает с логином.
 */
export function checkPasswordPolicy(password: string, login?: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Не короче ${PASSWORD_MIN_LENGTH} символов`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Не длиннее ${PASSWORD_MAX_LENGTH} символов`);
  if (!/\p{L}/u.test(password)) problems.push('Должна быть хотя бы одна буква');
  if (!/\p{Nd}/u.test(password)) problems.push('Должна быть хотя бы одна цифра');
  if (/^\s|\s$/.test(password)) problems.push('Не должен начинаться или заканчиваться пробелом');
  if (login && password.toLowerCase().includes(login.toLowerCase())) problems.push('Не должен содержать логин');
  return problems;
}

export const loginRequestSchema = z.object({
  login: loginFieldSchema,
  password: z.string({ required_error: 'Введите пароль' }).min(1, 'Введите пароль').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль').max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().min(1, 'Введите новый пароль').max(PASSWORD_MAX_LENGTH),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Новый пароль должен отличаться от текущего',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const userPreferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    /** Режим «только перо»: касания пальцем не рисуют (защита от ладони). */
    penOnly: z.boolean().default(false),
    /** Закреплённые/последние инструменты (id). */
    pinnedTools: z.array(z.string().max(120)).max(30).default([]),
    snapToGrid: z.boolean().default(true),
    snapToObjects: z.boolean().default(true),
  })
  .strict();
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = userPreferencesSchema.parse({});

/** Безопасное чтение настроек из JSON БД. */
export function parseUserPreferences(raw: unknown): UserPreferences {
  const parsed = userPreferencesSchema.partial().safeParse(raw);
  if (!parsed.success) return DEFAULT_USER_PREFERENCES;
  return { ...DEFAULT_USER_PREFERENCES, ...stripUndefined(parsed.data) };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const updatePreferencesRequestSchema = userPreferencesSchema.partial();

/** Текущий пользователь (ответ /api/auth/me и /api/auth/login). */
export const meSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  color: z.string(),
  mustChangePassword: z.boolean(),
  preferences: userPreferencesSchema,
});
export type Me = z.infer<typeof meSchema>;

export interface LoginResponse {
  user: Me;
  /** Срок жизни access-токена (сек) — клиент обновляет его заранее. */
  accessExpiresIn: number;
}
