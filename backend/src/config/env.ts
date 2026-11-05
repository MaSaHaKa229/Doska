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

  /**
   * Хранилище файлов. Задан S3_ENDPOINT — S3-совместимое (MinIO); пусто —
   * каталог UPLOADS_DIR на диске (разработка, тесты, установка на один сервер).
   */
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('doska'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  /** Предельный размер загружаемой картинки и PDF, МБ. */
  UPLOAD_MAX_IMAGE_MB: int(15, 1, 200),
  UPLOAD_MAX_PDF_MB: int(50, 1, 500),

  /**
   * Распознавание рукописных формул: адрес сервиса (свой контейнер pix2tex
   * из профиля ocr или внешний совместимый). Пусто — функция выключена.
   */
  FORMULA_OCR_URL: z.string().default(''),
  FORMULA_OCR_API_KEY: z.string().default(''),
  FORMULA_OCR_TIMEOUT_SECONDS: int(30, 1, 300),
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
  storage:
    | { driver: 's3'; endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }
    | { driver: 'fs'; dir: string };
  uploads: { maxImageBytes: number; maxPdfBytes: number };
  /** null — распознавание формул выключено. */
  formulaOcr: { url: string; apiKey: string; timeoutMs: number } | null;
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
  if (e.S3_ENDPOINT) {
    try {
      new URL(e.S3_ENDPOINT);
    } catch {
      throw new ConfigError(`Ошибка конфигурации: S3_ENDPOINT — неверный адрес «${e.S3_ENDPOINT}»`);
    }
    if (!e.S3_ACCESS_KEY || !e.S3_SECRET_KEY) throw new ConfigError('Ошибка конфигурации: для S3_ENDPOINT нужны S3_ACCESS_KEY и S3_SECRET_KEY');
  }
  if (e.FORMULA_OCR_URL) {
    let u: URL;
    try {
      u = new URL(e.FORMULA_OCR_URL);
    } catch {
      throw new ConfigError(`Ошибка конфигурации: FORMULA_OCR_URL — неверный адрес «${e.FORMULA_OCR_URL}»`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError('Ошибка конфигурации: FORMULA_OCR_URL должен начинаться с http:// или https://');
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
    storage: e.S3_ENDPOINT
      ? { driver: 's3', endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKey: e.S3_ACCESS_KEY, secretKey: e.S3_SECRET_KEY }
      : { driver: 'fs', dir: e.UPLOADS_DIR },
    uploads: { maxImageBytes: e.UPLOAD_MAX_IMAGE_MB * 1024 * 1024, maxPdfBytes: e.UPLOAD_MAX_PDF_MB * 1024 * 1024 },
    formulaOcr: e.FORMULA_OCR_URL ? { url: e.FORMULA_OCR_URL, apiKey: e.FORMULA_OCR_API_KEY, timeoutMs: e.FORMULA_OCR_TIMEOUT_SECONDS * 1000 } : null,
  };
}
