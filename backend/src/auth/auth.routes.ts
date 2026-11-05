import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AUTH_COOKIES,
  changePasswordRequestSchema,
  loginRequestSchema,
  updatePreferencesRequestSchema,
  type LoginResponse,
} from '@doska/shared';
import type { Prisma } from '@prisma/client';
import { parseInput } from '../common/errors.js';
import { AuditService } from '../common/audit.js';
import { clearAuthCookies, setAuthCookies, setCsrfCookie } from './cookies.js';
import type { IssuedSession } from './auth.service.js';

/**
 * Маршруты /api/auth:
 *   GET  /csrf             — выдать CSRF-cookie (перед формой входа)
 *   POST /login            — вход
 *   POST /refresh          — обновить сессию (ротация refresh-токена)
 *   POST /logout           — выход с текущего устройства
 *   POST /logout-all       — выход на всех устройствах
 *   GET  /me               — текущий пользователь
 *   POST /change-password  — смена пароля (в т.ч. обязательная смена временного)
 *   PATCH /me/preferences  — настройки интерфейса пользователя
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { config, authService } = app;
  const authLimit = { rateLimit: { max: config.rateLimit.authPerMinute, timeWindow: '1 minute' } };

  const respondWithSession = (reply: FastifyReply, session: IssuedSession) => {
    setAuthCookies(reply, config, { access: session.accessToken, refresh: session.refreshToken });
    const body: LoginResponse = { user: session.user, accessExpiresIn: config.jwt.accessTtlSeconds };
    return reply.send(body);
  };

  app.get('/csrf', { config: authLimit }, async (request, reply) => {
    const existing = request.cookies[AUTH_COOKIES.csrf];
    const token = existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing) ? existing : setCsrfCookie(reply, config);
    reply.header('cache-control', 'no-store');
    return { csrfToken: token };
  });

  app.post(
    '/login',
    { config: { rateLimit: { max: config.rateLimit.loginPerMinute, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = parseInput(loginRequestSchema, request.body);
      const session = await authService.login(input, AuditService.requestMeta(request));
      return respondWithSession(reply, session);
    },
  );

  app.post('/refresh', { config: authLimit }, async (request, reply) => {
    try {
      const session = await authService.refresh(request.cookies[AUTH_COOKIES.refresh], AuditService.requestMeta(request));
      return respondWithSession(reply, session);
    } catch (err) {
      // Недействительный refresh-токен — удаляем cookie, чтобы клиент не повторял попытки.
      if ((err as { code?: string }).code === 'SESSION_EXPIRED') clearAuthCookies(reply, config);
      throw err;
    }
  });

  app.post('/logout', { config: authLimit }, async (request, reply) => {
    // Выход работает и с истёкшим access-токеном: нужен только refresh-cookie.
    await authService.logout(request.cookies[AUTH_COOKIES.refresh], AuditService.requestMeta(request));
    clearAuthCookies(reply, config);
    return reply.status(204).send();
  });

  app.post(
    '/logout-all',
    { config: { ...authLimit, allowPendingPasswordChange: true }, preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth!;
      await authService.logoutAll({ id: auth.userId, login: auth.login }, AuditService.requestMeta(request));
      clearAuthCookies(reply, config);
      return reply.status(204).send();
    },
  );

  app.get(
    '/me',
    { config: { allowPendingPasswordChange: true }, preHandler: [app.authenticate] },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return { user: await authService.getMe(request.auth!.userId) };
    },
  );

  app.post(
    '/change-password',
    {
      config: { allowPendingPasswordChange: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const input = parseInput(changePasswordRequestSchema, request.body);
      const session = await authService.changePassword(request.auth!.userId, input, AuditService.requestMeta(request));
      return respondWithSession(reply, session);
    },
  );

  app.patch('/me/preferences', { config: authLimit, preHandler: [app.authenticate] }, async (request) => {
    const patch = parseInput(updatePreferencesRequestSchema, request.body);
    const me = await authService.getMe(request.auth!.userId);
    const preferences = { ...me.preferences, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    await app.prisma.user.update({
      where: { id: request.auth!.userId },
      data: { preferences: preferences as Prisma.InputJsonValue },
    });
    return { preferences };
  });
}
