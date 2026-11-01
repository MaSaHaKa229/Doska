import type { FastifyReply } from 'fastify';
import { AUTH_COOKIES } from '@doska/shared';
import type { AppConfig } from '../config/env.js';
import { generateCsrfToken } from './tokens.js';

/** Путь refresh-cookie: браузер отправляет её только на эндпоинты авторизации. */
export const REFRESH_COOKIE_PATH = '/api/auth';

export function setAuthCookies(
  reply: FastifyReply,
  config: AppConfig,
  tokens: { access: string; refresh: string },
): void {
  const base = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const };
  reply.setCookie(AUTH_COOKIES.access, tokens.access, {
    ...base,
    path: '/',
    maxAge: config.jwt.accessTtlSeconds,
  });
  reply.setCookie(AUTH_COOKIES.refresh, tokens.refresh, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: config.jwt.refreshTtlSeconds,
  });
  // CSRF-токен обновляется при каждом входе/обновлении сессии.
  setCsrfCookie(reply, config);
}

export function setCsrfCookie(reply: FastifyReply, config: AppConfig, token = generateCsrfToken()): string {
  reply.setCookie(AUTH_COOKIES.csrf, token, {
    httpOnly: false, // клиент читает её и повторяет в заголовке X-CSRF-Token
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.jwt.refreshTtlSeconds,
  });
  return token;
}

export function clearAuthCookies(reply: FastifyReply, config: AppConfig): void {
  const base = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const };
  reply.clearCookie(AUTH_COOKIES.access, { ...base, path: '/' });
  reply.clearCookie(AUTH_COOKIES.refresh, { ...base, path: REFRESH_COOKIE_PATH });
}
