import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env.js';

/**
 * Пути, которые pino заменяет на "[скрыто]". Fastify по умолчанию не пишет
 * в лог заголовки и тела запросов, но redact — вторая линия защиты на случай,
 * если кто-то залогирует request/объект с паролем вручную.
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'tempPassword',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.tempPassword',
];

export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[скрыто]' },
    serializers: {
      // Не пишем query-строку: в ней теоретически может оказаться что-то чувствительное.
      req: (req: { method: string; url: string; ip?: string; id?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url.split('?')[0],
        ip: req.ip,
      }),
    },
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

const SECRET_KEY_RE = /pass|token|secret|hash|cookie|authorization/i;

/**
 * Удаление секретов из произвольных данных перед записью в журнал действий.
 * Ключи, похожие на секреты, заменяются на "[скрыто]" рекурсивно.
 */
export function sanitizeDetails(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[слишком глубоко]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeDetails(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[скрыто]' : sanitizeDetails(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…';
  return value;
}
