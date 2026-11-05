import type { PrismaClient, UserRole } from '@prisma/client';
import type { AppEvents } from './events.js';

export interface UserStatus {
  id: string;
  login: string;
  fullName: string;
  role: UserRole;
  color: string;
  active: boolean;
  mustChangePassword: boolean;
  /** Время последней смены пароля, секунды UNIX (токены, выданные раньше, недействительны). */
  passwordChangedAtSec: number;
}

/**
 * Кэш состояния пользователей для проверки access-токенов без запроса в БД
 * на каждый запрос. TTL 30 с; при блокировке/смене пароля запись удаляется
 * сразу через шину событий, поэтому реальная задержка — только между
 * процессами (у нас процесс один).
 */
export class UserStatusCache {
  private readonly cache = new Map<string, { status: UserStatus | null; expires: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    events: AppEvents,
    private readonly ttlMs = 30_000,
  ) {
    events.on('user.sessionsRevoked', ({ userId }) => this.invalidate(userId));
    events.on('user.updated', ({ userId }) => this.invalidate(userId));
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  async get(userId: string): Promise<UserStatus | null> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    if (hit && hit.expires > now) return hit.status;

    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        login: true,
        fullName: true,
        role: true,
        color: true,
        isBlocked: true,
        deletedAt: true,
        mustChangePassword: true,
        passwordChangedAt: true,
      },
    });
    const status: UserStatus | null = u
      ? {
          id: u.id,
          login: u.login,
          fullName: u.fullName,
          role: u.role,
          color: u.color,
          active: !u.isBlocked && !u.deletedAt,
          mustChangePassword: u.mustChangePassword,
          passwordChangedAtSec: u.passwordChangedAt ? Math.floor(u.passwordChangedAt.getTime() / 1000) : 0,
        }
      : null;
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(userId, { status, expires: now + this.ttlMs });
    return status;
  }
}
