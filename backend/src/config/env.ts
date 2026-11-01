import { z } from 'zod';

/**
 * Конфигурация из переменных окружения. Проверяется при старте: при ошибке
 * процесс завершается с понятным сообщением (значения секретов не выводятся).
 */

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ожидалось целое число от ${min} до ${max}` });
        return z.NEVER;
      }
      return n;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(3000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url('DATABASE_URL должен быть URL postgresql://…'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET должен быть не короче 32 символов'),
  JWT_ACCESS_TTL_SECONDS: int(900, 60, 86_400),
  JWT_REFRESH_TTL_SECONDS: int(2_592_000, 3_600, 31_536_000),

  /** Разрешённые источники (Origin), через запятую. Первый — основной адрес сайта. */
  PUBLIC_ORIGIN: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)),
  /** Ставить флаг Secure на cookie. По умолчанию true в production. */
  COOKIE_SECURE: z.enum(['true', 'false', '']).optional(),
  /** Доверять X-Forwarded-* (бэкенд за Nginx). */
  TRUST_PROXY: bool(false),

  ARGON2_MEMORY_KIB: int(65_536, 1_024, 1_048_576),
  ARGON2_TIME_COST: int(3, 1, 20),

  /** Неудачных входов подряд до временной блокировки учётной записи. */
  LOGIN_MAX_FAILURES: int(5, 3, 50),
  /** Длительность первой блокировки (мин); каждая следующая серия — вдвое дольше, максимум 24 ч. */
  LOGIN_LOCK_MINUTES: int(15, 1, 1440),
  /** Попыток входа в минуту с одного IP. */
  RATE_LIMIT_LOGIN_PER_MINUTE: int(10, 1, 10_000),
  /** Прочих запросов к /api/auth в минуту с одного IP. */
  RATE_LIMIT_AUTH_PER_MINUTE: int(60, 1, 100_000),
});

export type RawEnv = z.input<typeof envSchema>;

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  jwt: { accessSecret: Uint8Array; accessTtlSeconds: number; refreshTtlSeconds: number };
  publicOrigins: string[];
  cookieSecure: boolean;
  trustProxy: boolean;
  argon2: { memoryCost: number; timeCost: number };
  login: { maxFailures: number; lockMinutes: number };
  rateLimit: { loginPerMinute: number; authPerMinute: number };
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Ошибка конфигурации (переменные окружения):\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  for (const origin of e.PUBLIC_ORIGIN) {
    try {
      new URL(origin);
    } catch {
      throw new ConfigError(`Ошибка конфигурации: PUBLIC_ORIGIN содержит неверный адрес «${origin}»`);
    }
  }
  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    jwt: {
      accessSecret: new TextEncoder().encode(e.JWT_ACCESS_SECRET),
      accessTtlSeconds: e.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: e.JWT_REFRESH_TTL_SECONDS,
    },
    publicOrigins: e.PUBLIC_ORIGIN,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    argon2: { memoryCost: e.ARGON2_MEMORY_KIB, timeCost: e.ARGON2_TIME_COST },
    login: { maxFailures: e.LOGIN_MAX_FAILURES, lockMinutes: e.LOGIN_LOCK_MINUTES },
    rateLimit: { loginPerMinute: e.RATE_LIMIT_LOGIN_PER_MINUTE, authPerMinute: e.RATE_LIMIT_AUTH_PER_MINUTE },
  };
}
