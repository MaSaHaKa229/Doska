import { PrismaClient, type UserRole } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { AUTH_COOKIES, CSRF_HEADER } from '@doska/shared';
import { buildApp } from '../src/app.js';
import type { RealtimeOptions } from '../src/realtime/server.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { PasswordHasher } from '../src/auth/password.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const ORIGIN = 'https://doska.test';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
    PUBLIC_ORIGIN: ORIGIN,
    // Быстрые параметры argon2 для тестов.
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    RATE_LIMIT_LOGIN_PER_MINUTE: '1000',
    RATE_LIMIT_AUTH_PER_MINUTE: '1000',
    ...overrides,
  });
}

let sharedPrisma: PrismaClient | null = null;
export function testPrisma(): PrismaClient {
  sharedPrisma ??= new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  return sharedPrisma;
}

/** Очистка всех таблиц (кроме служебной таблицы миграций). */
export async function resetDb(prisma = testPrisma()): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  extend?: (app: FastifyInstance) => Promise<void> | void,
  realtime?: Partial<RealtimeOptions>,
): Promise<FastifyInstance> {
  const app = await buildApp({ config: testConfig(overrides), prisma: testPrisma(), extend, realtime });
  await app.ready();
  return app;
}

const hasher = new PasswordHasher({ memoryCost: 1024, timeCost: 1 });

export async function createUser(params: {
  login: string;
  password: string;
  role?: UserRole;
  fullName?: string;
  mustChangePassword?: boolean;
  isBlocked?: boolean;
}) {
  return testPrisma().user.create({
    data: {
      login: params.login,
      fullName: params.fullName ?? 'Тестовый Пользователь',
      role: params.role ?? 'STUDENT',
      passwordHash: await hasher.hash(params.password),
      mustChangePassword: params.mustChangePassword ?? false,
      isBlocked: params.isBlocked ?? false,
    },
  });
}

/**
 * Клиент с «банкой» cookie, имитирующий браузер: хранит cookie по имени
 * (с учётом удаления), автоматически отправляет CSRF-заголовок и Origin.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  private absorb(res: LightMyRequestResponse): void {
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      const expired = c.maxAge === 0 || (c.expires instanceof Date && c.expires.getTime() < Date.now()) || c.value === '';
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    opts: { csrf?: boolean; origin?: string | null; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    const csrf = this.cookies.get(AUTH_COOKIES.csrf);
    if (method !== 'GET' && opts.csrf !== false && csrf) headers[CSRF_HEADER] = csrf;
    const res = await this.app.inject({
      method,
      url,
      headers,
      cookies: Object.fromEntries(this.cookies),
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    this.absorb(res);
    return res;
  }

  async initCsrf(): Promise<void> {
    await this.request('GET', '/api/auth/csrf');
  }

  async login(login: string, password: string): Promise<LightMyRequestResponse> {
    if (!this.cookies.has(AUTH_COOKIES.csrf)) await this.initCsrf();
    return this.request('POST', '/api/auth/login', { login, password });
  }
}
