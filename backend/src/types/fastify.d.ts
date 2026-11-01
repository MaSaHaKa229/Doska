import type { PrismaClient, UserRole } from '@prisma/client';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { AuditService } from '../common/audit.js';
import type { AppEvents } from '../common/events.js';
import type { UserStatusCache } from '../common/user-status-cache.js';
import type { PasswordHasher } from '../auth/password.js';
import type { TokenService } from '../auth/tokens.js';
import type { AuthService } from '../auth/auth.service.js';

/** Аутентифицированный пользователь запроса. */
export interface AuthContext {
  userId: string;
  login: string;
  fullName: string;
  role: UserRole;
  /** id семьи refresh-токенов (сессия устройства). */
  sessionId: string;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    audit: AuditService;
    events: AppEvents;
    userStatus: UserStatusCache;
    passwords: PasswordHasher;
    tokens: TokenService;
    authService: AuthService;
    /** preHandler: требует действующий access-токен. */
    authenticate: preHandlerAsyncHookHandler;
    /** preHandler: требует одну из глобальных ролей (после authenticate). */
    requireRole(...roles: UserRole[]): preHandlerAsyncHookHandler;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
  }

  interface FastifyContextConfig {
    /** Маршрут доступен пользователю, который ещё не сменил временный пароль. */
    allowPendingPasswordChange?: boolean;
  }
}
