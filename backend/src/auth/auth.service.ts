import { randomUUID } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import {
  checkPasswordPolicy,
  parseUserPreferences,
  type ChangePasswordRequest,
  type LoginRequest,
  type Me,
} from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import type { AppEvents } from '../common/events.js';
import type { AppConfig } from '../config/env.js';
import type { PasswordHasher } from './password.js';
import { hashToken, type TokenService } from './tokens.js';

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

export interface IssuedSession {
  user: Me;
  accessToken: string;
  refreshToken: string;
  familyId: string;
}

/** Окно, в течение которого повтор только что ротированного токена считается гонкой вкладок, а не кражей. */
const ROTATION_GRACE_MS = 30_000;

export function toMe(u: Pick<User, 'id' | 'login' | 'fullName' | 'role' | 'color' | 'mustChangePassword' | 'preferences'>): Me {
  return {
    id: u.id,
    login: u.login,
    fullName: u.fullName,
    role: u.role,
    color: u.color,
    mustChangePassword: u.mustChangePassword,
    preferences: parseUserPreferences(u.preferences),
  };
}

function minutesWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'минуту';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'минуты';
  return 'минут';
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');

/**
 * Сценарии авторизации: вход, обновление сессии, выход, смена пароля.
 */
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly events: AppEvents,
  ) {}

  /**
   * Вход по логину и паролю.
   * Порядок проверок важен:
   *  1) несуществующий логин → проверка фиктивного хеша (одинаковое время ответа);
   *  2) временная блокировка → отказ ДО проверки пароля (подбор во время
   *     блокировки бесполезен);
   *  3) неверный пароль → счётчик неудач, каждые N неудач подряд — блокировка
   *     на 15, 30, 60… минут (максимум сутки);
   *  4) заблокированный администратором аккаунт → сообщение только после
   *     верного пароля (не раскрываем статус аккаунта посторонним).
   */
  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { login: input.login } });

    if (!user || user.deletedAt) {
      await this.hasher.verifyDummy(input.password);
      await this.audit.record({
        action: 'LOGIN_FAILED',
        actorLogin: input.login,
        ...meta,
        details: { reason: 'unknown-login' },
      });
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
      await this.audit.record({
        action: 'LOGIN_BLOCKED',
        actorId: user.id,
        actorLogin: user.login,
        ...meta,
        details: { reason: 'locked', minutesLeft: minutes },
      });
      throw new AppError(
        429,
        'ACCOUNT_LOCKED',
        `Слишком много неудачных попыток входа. Попробуйте через ${minutes} ${minutesWord(minutes)}`,
        { retryAfterMinutes: minutes },
      );
    }

    const ok = await this.hasher.verify(user.passwordHash, input.password);
    if (!ok) {
      // Атомарный инкремент: параллельные попытки не теряют неудачи.
      const { failedLoginCount } = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      await this.audit.record({
        action: 'LOGIN_FAILED',
        actorId: user.id,
        actorLogin: user.login,
        ...meta,
        details: { reason: 'wrong-password', failedLoginCount },
      });
      const max = this.config.login.maxFailures;
      if (failedLoginCount % max === 0) {
        const series = failedLoginCount / max;
        const minutes = Math.min(this.config.login.lockMinutes * 2 ** (series - 1), 24 * 60);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(now.getTime() + minutes * 60_000) },
        });
        await this.audit.record({
          action: 'LOGIN_BLOCKED',
          actorId: user.id,
          actorLogin: user.login,
          ...meta,
          details: { reason: 'too-many-failures', lockMinutes: minutes },
        });
      }
      throw invalidCredentials();
    }

    if (user.isBlocked) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        actorId: user.id,
        actorLogin: user.login,
        ...meta,
        details: { reason: 'blocked' },
      });
      throw new AppError(403, 'ACCOUNT_BLOCKED', 'Учётная запись заблокирована. Обратитесь к администратору');
    }

    const rehash = this.hasher.needsRehash(user.passwordHash) ? await this.hasher.hash(input.password) : null;
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(rehash ? { passwordHash: rehash } : {}),
      },
    });

    const session = await this.issueSession(updated, randomUUID(), meta);
    await this.audit.record({
      action: 'LOGIN_SUCCESS',
      actorId: user.id,
      actorLogin: user.login,
      ...meta,
      details: { mustChangePassword: updated.mustChangePassword },
    });
    return session;
  }

  /**
   * Обновление сессии по refresh-токену с ротацией.
   * Каждый refresh-токен одноразовый. Если предъявлен уже использованный
   * токен — значит, его копия у кого-то ещё (кража): отзываем всю семью.
   * Исключение — повтор в течение 30 с после ротации: это две вкладки,
   * одновременно обновившие сессию (вторая получит REFRESH_RACE и просто
   * повторит запрос с уже обновлёнными cookie).
   */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken) throw Errors.sessionExpired();
    const now = new Date();
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!row) throw Errors.sessionExpired();

    if (row.revokedAt) {
      if (row.revokeReason === 'rotated' && now.getTime() - row.revokedAt.getTime() < ROTATION_GRACE_MS) {
        throw new AppError(409, 'REFRESH_RACE', 'Сессия уже обновлена, повторите запрос');
      }
      if (row.revokeReason === 'rotated') {
        await this.revokeFamily(row.familyId, 'reuse');
        await this.audit.record({
          action: 'TOKEN_REUSE_DETECTED',
          actorId: row.userId,
          actorLogin: row.user.login,
          ...meta,
          details: { familyId: row.familyId },
        });
      }
      throw Errors.sessionExpired();
    }

    if (row.expiresAt <= now) throw Errors.sessionExpired();

    const user = row.user;
    if (user.isBlocked || user.deletedAt) {
      await this.revokeFamily(row.familyId, user.deletedAt ? 'deleted' : 'blocked');
      throw Errors.sessionExpired();
    }

    const newId = randomUUID();
    const { token, hash } = this.tokens.generateRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      // Условное обновление: из двух одновременных запросов выигрывает один.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'rotated', replacedById: newId },
      });
      if (count === 0) throw new AppError(409, 'REFRESH_RACE', 'Сессия уже обновлена, повторите запрос');
      await tx.refreshToken.create({
        data: {
          id: newId,
          userId: user.id,
          tokenHash: hash,
          familyId: row.familyId,
          expiresAt: new Date(now.getTime() + this.config.jwt.refreshTtlSeconds * 1000),
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
          ip: meta.ip.slice(0, 64),
        },
      });
    });

    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      role: user.role,
      pwd: user.mustChangePassword,
      sid: row.familyId,
    });
    return { user: toMe(user), accessToken, refreshToken: token, familyId: row.familyId };
  }

  /** Выход: отзыв семьи refresh-токенов текущего устройства. */
  async logout(refreshToken: string | undefined, meta: RequestMeta, actor?: { id: string; login: string }): Promise<void> {
    let userId = actor?.id ?? null;
    let login = actor?.login ?? null;
    if (refreshToken) {
      const row = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
        select: { familyId: true, userId: true, user: { select: { login: true } } },
      });
      if (row) {
        await this.revokeFamily(row.familyId, 'logout');
        userId ??= row.userId;
        login ??= row.user.login;
      }
    }
    if (userId) {
      await this.audit.record({ action: 'LOGOUT', actorId: userId, actorLogin: login, ...meta });
    }
  }

  /** Выход на всех устройствах. */
  async logoutAll(user: { id: string; login: string }, meta: RequestMeta): Promise<void> {
    await this.revokeAllForUser(user.id, 'logout-all');
    this.events.emit('user.sessionsRevoked', { userId: user.id, reason: 'logout-all' });
    await this.audit.record({ action: 'LOGOUT', actorId: user.id, actorLogin: user.login, ...meta, details: { allDevices: true } });
  }

  /**
   * Смена пароля самим пользователем (в том числе обязательная смена
   * временного пароля). Все прочие сессии пользователя завершаются,
   * текущая получает новые токены.
   */
  async changePassword(userId: string, input: ChangePasswordRequest, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.isBlocked) throw Errors.unauthenticated();

    const ok = await this.hasher.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Текущий пароль указан неверно', {
        currentPassword: ['Текущий пароль указан неверно'],
      });
    }
    const problems = checkPasswordPolicy(input.newPassword, user.login);
    if (problems.length > 0) {
      throw new AppError(400, 'WEAK_PASSWORD', 'Пароль не соответствует требованиям', { newPassword: problems });
    }

    const hash = await this.hasher.hash(input.newPassword);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'password-changed' },
      });
      return u;
    });
    this.events.emit('user.sessionsRevoked', { userId: user.id, reason: 'password-changed' });

    const session = await this.issueSession(updated, randomUUID(), meta);
    await this.audit.record({
      action: 'PASSWORD_CHANGED',
      actorId: user.id,
      actorLogin: user.login,
      targetType: 'user',
      targetId: user.id,
      ...meta,
      details: { wasTemporary: user.mustChangePassword },
    });
    return session;
  }

  async getMe(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw Errors.unauthenticated();
    return toMe(user);
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  private async issueSession(user: User, familyId: string, meta: RequestMeta): Promise<IssuedSession> {
    const { token, hash } = this.tokens.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        familyId,
        expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000),
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
        ip: meta.ip.slice(0, 64),
      },
    });
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      role: user.role,
      pwd: user.mustChangePassword,
      sid: familyId,
    });
    return { user: toMe(user), accessToken, refreshToken: token, familyId };
  }
}
