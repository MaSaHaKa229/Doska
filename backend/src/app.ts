import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config/env.js';
import { loggerOptions } from './common/logger.js';
import { errorHandler, notFoundHandler } from './common/errors.js';
import { AuditService } from './common/audit.js';
import { AppEvents } from './common/events.js';
import { UserStatusCache } from './common/user-status-cache.js';
import { csrfPlugin } from './common/csrf.plugin.js';
import { PasswordHasher } from './auth/password.js';
import { TokenService } from './auth/tokens.js';
import { AuthService } from './auth/auth.service.js';
import { authPlugin } from './auth/auth.plugin.js';
import { authRoutes } from './auth/auth.routes.js';
import { healthRoutes } from './health/health.routes.js';
import { adminRoutes } from './admin/admin.routes.js';
import { boardsRoutes } from './boards/boards.routes.js';
import { assignmentsRoutes } from './assignments/assignments.routes.js';
import { assetsRoutes } from './assets/assets.routes.js';
import { formulaOcrRoutes } from './formula/ocr.routes.js';
import { createStorage } from './assets/storage.js';
import { registerRealtime, type RealtimeOptions } from './realtime/server.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Готовый клиент Prisma (тесты); иначе создаётся новый. */
  prisma?: PrismaClient;
  /** Параметры сервера реального времени (тесты ускоряют таймеры). */
  realtime?: Partial<RealtimeOptions>;
  /** Дополнительная регистрация маршрутов (тесты). */
  extend?: (app: FastifyInstance) => Promise<void> | void;
}

/**
 * Сборка приложения без запуска сервера (используется и main.ts, и тестами).
 */
export async function buildApp({ config, prisma, extend, realtime }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
    // Не раскрываем внутренние детали при ошибке разбора JSON.
    return503OnClosing: true,
  });

  const db = prisma ?? new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const ownsPrisma = !prisma;
  const events = new AppEvents();
  const audit = new AuditService(db, app.log);
  const passwords = new PasswordHasher(config.argon2);
  const tokens = new TokenService(config.jwt.accessSecret, config.jwt.accessTtlSeconds, config.jwt.refreshTtlSeconds);

  app.decorate('config', config);
  app.decorate('prisma', db);
  app.decorate('events', events);
  app.decorate('audit', audit);
  app.decorate('passwords', passwords);
  app.decorate('tokens', tokens);
  app.decorate('userStatus', new UserStatusCache(db, events));
  app.decorate('authService', new AuthService(db, config, passwords, tokens, audit, events));
  const storage = createStorage(config.storage);
  await storage.init();
  app.decorate('storage', storage);

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // API отдаёт только JSON; CSP для страниц задаёт Nginx (этап 9).
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(csrfPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(boardsRoutes, { prefix: '/api' });
  await app.register(assignmentsRoutes, { prefix: '/api' });
  await app.register(assetsRoutes, { prefix: '/api' });
  await app.register(formulaOcrRoutes, { prefix: '/api' });
  registerRealtime(app, realtime);

  if (extend) await extend(app);

  app.addHook('onClose', async () => {
    if (ownsPrisma) await db.$disconnect();
  });

  return app;
}
