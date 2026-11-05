import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { AUTH_COOKIES } from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';

/**
 * Проверка access-токена и ролей.
 *
 * Токен берётся только из httpOnly-cookie (не из заголовка Authorization):
 * так JavaScript страницы не имеет доступа к токену, а защита от CSRF
 * обеспечивается отдельным плагином.
 *
 * Помимо подписи и срока проверяется актуальное состояние пользователя
 * (кэш на 30 с, сбрасывается событиями): блокировка, удаление, смена пароля
 * после выдачи токена, обязательная смена временного пароля, текущая роль.
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  async function authenticate(request: FastifyRequest): Promise<void> {
    const token = request.cookies[AUTH_COOKIES.access];
    if (!token) throw Errors.unauthenticated();
    const claims = await app.tokens.verifyAccess(token);
    if (claims === 'expired') throw Errors.sessionExpired();
    if (!claims) throw Errors.unauthenticated();

    const status = await app.userStatus.get(claims.sub);
    if (!status) throw Errors.unauthenticated();
    if (!status.active) {
      throw new AppError(401, 'ACCOUNT_BLOCKED', 'Учётная запись заблокирована. Обратитесь к администратору');
    }
    if (claims.iat < status.passwordChangedAtSec) throw Errors.sessionExpired();

    if (status.mustChangePassword && !request.routeOptions.config.allowPendingPasswordChange) {
      throw Errors.passwordChangeRequired();
    }

    request.auth = {
      userId: status.id,
      login: status.login,
      fullName: status.fullName,
      // Роль — из БД, а не из токена: смена роли администратором действует сразу.
      role: status.role,
      sessionId: claims.sid,
      mustChangePassword: status.mustChangePassword,
    };
  }

  app.decorate('authenticate', authenticate);

  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (request: FastifyRequest) => {
      if (!request.auth) throw Errors.unauthenticated();
      if (!roles.includes(request.auth.role)) throw Errors.forbidden();
    };
  });
});
