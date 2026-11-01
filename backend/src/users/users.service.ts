import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type User, type UserRole } from '@prisma/client';
import {
  USER_COLORS,
  pickFreeLogin,
  suggestLoginBase,
  type AdminUser,
  type CreateUserRequest,
  type CreateUserResponse,
  type Credential,
  type ListUsersQuery,
  type Paginated,
  type UpdateUserRequest,
} from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import type { AppEvents } from '../common/events.js';
import { auditBase, type Actor } from '../common/actor.js';
import { HASH_CONCURRENCY, mapLimit } from '../common/concurrency.js';
import { generateTempPassword, type PasswordHasher } from '../auth/password.js';

export const userWithClasses = {
  classMemberships: {
    include: { class: { select: { id: true, name: true, academicYear: true } } },
    orderBy: { class: { name: 'asc' } },
  },
} satisfies Prisma.UserInclude;

type UserWithClasses = Prisma.UserGetPayload<{ include: typeof userWithClasses }>;

export function toAdminUser(u: UserWithClasses): AdminUser {
  return {
    id: u.id,
    login: u.login,
    fullName: u.fullName,
    role: u.role,
    color: u.color,
    isBlocked: u.isBlocked,
    blockedReason: u.blockedReason,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    classes: u.classMemberships.map((m) => ({
      id: m.class.id,
      name: m.class.name,
      academicYear: m.class.academicYear,
      role: m.role,
    })),
  };
}

export function randomUserColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)] as string;
}

/** Роль участника класса по глобальной роли пользователя. */
export function memberRoleFor(role: UserRole): 'STUDENT' | 'TEACHER' {
  if (role === 'ADMIN') throw Errors.validation({ classIds: ['Администратора нельзя добавить в класс'] });
  return role;
}

/**
 * Управление пользователями (только для администратора).
 * Все действия пишутся в журнал; действия, делающие сессии недействительными
 * (блокировка, сброс пароля, удаление), сразу отзывают refresh-токены и
 * оповещают другие модули через шину событий.
 */
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly events: AppEvents,
  ) {}

  async list(q: ListUsersQuery): Promise<Paginated<AdminUser>> {
    const now = new Date();
    const and: Prisma.UserWhereInput[] = [{ deletedAt: null }];
    if (q.search) {
      const words = q.search.split(/\s+/).filter(Boolean).slice(0, 5);
      for (const w of words) {
        and.push({ OR: [{ fullName: { contains: w, mode: 'insensitive' } }, { login: { contains: w.toLowerCase() } }] });
      }
    }
    if (q.role) and.push({ role: q.role });
    if (q.classId) and.push({ classMemberships: { some: { classId: q.classId } } });
    if (q.noClass) and.push({ classMemberships: { none: {} } });
    if (q.status === 'active') and.push({ isBlocked: false });
    if (q.status === 'blocked') and.push({ OR: [{ isBlocked: true }, { lockedUntil: { gt: now } }] });
    if (q.status === 'pending') and.push({ mustChangePassword: true });
    const where: Prisma.UserWhereInput = { AND: and };

    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      q.sort === 'lastLoginAt'
        ? [{ lastLoginAt: { sort: q.order, nulls: 'last' } }, { fullName: 'asc' }]
        : [{ [q.sort]: q.order }, { id: 'asc' }];

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userWithClasses,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: users.map(toAdminUser), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string): Promise<AdminUser> {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: userWithClasses });
    if (!u) throw Errors.notFound('Пользователь не найден');
    return toAdminUser(u);
  }

  /** Подбор свободных логинов для набора ФИО (с учётом уже занятых в БД и в самом наборе). */
  async generateLogins(fullNames: readonly string[], reserved: Iterable<string> = []): Promise<string[]> {
    const bases = fullNames.map(suggestLoginBase);
    const unique = [...new Set(bases)];
    const existing = unique.length
      ? await this.prisma.user.findMany({
          where: { OR: unique.map((b) => ({ login: { startsWith: b } })) },
          select: { login: true },
        })
      : [];
    const taken = new Set<string>([...existing.map((e) => e.login), ...reserved]);
    return bases.map((b) => {
      const login = pickFreeLogin(b, taken);
      taken.add(login);
      return login;
    });
  }

  async suggestLogin(fullName: string): Promise<string> {
    const [login] = await this.generateLogins([fullName]);
    return login as string;
  }

  private async assertClassesUsable(classIds: readonly string[]): Promise<Map<string, string>> {
    if (classIds.length === 0) return new Map();
    const classes = await this.prisma.class.findMany({
      where: { id: { in: [...classIds] } },
      select: { id: true, name: true, archivedAt: true },
    });
    const found = new Map(classes.map((c) => [c.id, c]));
    const problems: string[] = [];
    for (const id of classIds) {
      const c = found.get(id);
      if (!c) problems.push('Класс не найден');
      else if (c.archivedAt) problems.push(`Класс «${c.name}» в архиве`);
    }
    if (problems.length) throw Errors.validation({ classIds: problems });
    return new Map(classes.map((c) => [c.id, c.name]));
  }

  async create(input: CreateUserRequest, actor: Actor): Promise<CreateUserResponse> {
    const classIds = [...new Set(input.classIds)];
    if (classIds.length && input.role === 'ADMIN') memberRoleFor('ADMIN');
    const classNames = await this.assertClassesUsable(classIds);

    let login = input.login;
    if (login) {
      const exists = await this.prisma.user.findUnique({ where: { login }, select: { id: true } });
      if (exists) throw new AppError(409, 'CONFLICT', 'Логин уже занят', { login: ['Логин уже занят'] });
    } else {
      login = await this.suggestLogin(input.fullName);
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await this.hasher.hash(tempPassword);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          login: login!,
          fullName: input.fullName,
          role: input.role,
          passwordHash,
          mustChangePassword: true,
          color: input.color ?? randomUserColor(),
          createdById: actor.id,
          classMemberships: {
            create: classIds.map((classId) => ({ classId, role: memberRoleFor(input.role) })),
          },
        },
        include: userWithClasses,
      });
      await this.audit.record(
        {
          action: 'USER_CREATED',
          ...auditBase(actor),
          targetType: 'user',
          targetId: created.id,
          details: { login: created.login, fullName: created.fullName, role: created.role, classes: [...classNames.values()] },
        },
        tx,
      );
      return created;
    });

    return {
      user: toAdminUser(user),
      credential: {
        fullName: user.fullName,
        login: user.login,
        tempPassword,
        className: [...classNames.values()].join(', ') || null,
      },
    };
  }

  private async findActive(id: string): Promise<User> {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw Errors.notFound('Пользователь не найден');
    return u;
  }

  /** Нельзя оставить систему без действующего администратора. */
  private async assertNotLastAdmin(user: User, action: string): Promise<void> {
    if (user.role !== 'ADMIN') return;
    const others = await this.prisma.user.count({
      where: { role: 'ADMIN', isBlocked: false, deletedAt: null, id: { not: user.id } },
    });
    if (others === 0) throw Errors.conflict(`Нельзя ${action} единственного действующего администратора`);
  }

  async update(id: string, input: UpdateUserRequest, actor: Actor): Promise<AdminUser> {
    const user = await this.findActive(id);
    const changes: Record<string, unknown> = {};

    if (input.role && input.role !== user.role) {
      if (id === actor.id) throw Errors.conflict('Нельзя изменить собственную роль');
      if (input.role !== 'ADMIN') await this.assertNotLastAdmin(user, 'понизить');
      changes.role = { from: user.role, to: input.role };
    }
    const newRole = input.role ?? user.role;

    if (input.login && input.login !== user.login) {
      const exists = await this.prisma.user.findUnique({ where: { login: input.login }, select: { id: true } });
      if (exists) throw new AppError(409, 'CONFLICT', 'Логин уже занят', { login: ['Логин уже занят'] });
      changes.login = { from: user.login, to: input.login };
    }
    if (input.fullName && input.fullName !== user.fullName) changes.fullName = { from: user.fullName, to: input.fullName };
    if (input.color && input.color !== user.color) changes.color = { from: user.color, to: input.color };

    let classIds = input.classIds ? [...new Set(input.classIds)] : undefined;
    if (classIds && classIds.length && newRole === 'ADMIN') memberRoleFor('ADMIN');
    if (classIds) await this.assertClassesUsable(classIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (classIds || changes.role) {
        const current = await tx.classMember.findMany({ where: { userId: id }, select: { classId: true } });
        // При смене роли без нового списка классов: сохраняем классы с новой ролью
        // участника; администратор в классах не состоит.
        classIds ??= newRole === 'ADMIN' ? [] : current.map((m) => m.classId);
        await tx.classMember.deleteMany({ where: { userId: id } });
        if (classIds.length) {
          await tx.classMember.createMany({
            data: classIds.map((classId) => ({ classId, userId: id, role: memberRoleFor(newRole) })),
          });
        }
        const before = current.map((m) => m.classId).sort();
        const after = [...classIds].sort();
        if (before.join() !== after.join()) changes.classIds = { from: before, to: after };
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.login ? { login: input.login } : {}),
          ...(input.role ? { role: input.role } : {}),
          ...(input.color ? { color: input.color } : {}),
        },
        include: userWithClasses,
      });
      if (Object.keys(changes).length) {
        await this.audit.record(
          { action: 'USER_UPDATED', ...auditBase(actor), targetType: 'user', targetId: id, details: { changes } },
          tx,
        );
      }
      return u;
    });
    this.events.emit('user.updated', { userId: id });
    return toAdminUser(updated);
  }

  async block(id: string, reason: string | undefined, actor: Actor): Promise<AdminUser> {
    if (id === actor.id) throw Errors.conflict('Нельзя заблокировать самого себя');
    const user = await this.findActive(id);
    if (user.isBlocked) return this.get(id);
    await this.assertNotLastAdmin(user, 'заблокировать');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason || null },
        include: userWithClasses,
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'blocked' },
      });
      await this.audit.record(
        { action: 'USER_BLOCKED', ...auditBase(actor), targetType: 'user', targetId: id, details: { login: u.login, reason: reason ?? null } },
        tx,
      );
      return u;
    });
    this.events.emit('user.sessionsRevoked', { userId: id, reason: 'blocked' });
    return toAdminUser(updated);
  }

  /** Разблокировка снимает и блокировку администратором, и временную блокировку после неудачных входов. */
  async unblock(id: string, actor: Actor): Promise<AdminUser> {
    const user = await this.findActive(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { isBlocked: false, blockedAt: null, blockedReason: null, failedLoginCount: 0, lockedUntil: null },
        include: userWithClasses,
      });
      await this.audit.record(
        {
          action: 'USER_UNBLOCKED',
          ...auditBase(actor),
          targetType: 'user',
          targetId: id,
          details: { login: user.login, wasBlocked: user.isBlocked, wasLocked: !!user.lockedUntil && user.lockedUntil > new Date() },
        },
        tx,
      );
      return u;
    });
    this.events.emit('user.updated', { userId: id });
    return toAdminUser(updated);
  }

  /**
   * Сброс пароля: новый временный пароль, обязательная смена при входе,
   * все сессии пользователя завершаются.
   */
  async resetPassword(id: string, actor: Actor): Promise<Credential> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { classMemberships: { include: { class: { select: { name: true } } } } },
    });
    if (!user) throw Errors.notFound('Пользователь не найден');
    const [cred] = await this.resetPasswordsFor(
      [{ id: user.id, login: user.login, fullName: user.fullName, className: user.classMemberships.map((m) => m.class.name).join(', ') || null }],
      actor,
    );
    return cred as Credential;
  }

  /** Массовый сброс паролей (используется и для класса целиком). */
  async resetPasswordsFor(
    users: { id: string; login: string; fullName: string; className: string | null }[],
    actor: Actor,
  ): Promise<Credential[]> {
    const prepared = await mapLimit(users, HASH_CONCURRENCY, async (u) => {
      const tempPassword = generateTempPassword();
      return { ...u, tempPassword, hash: await this.hasher.hash(tempPassword) };
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const u of prepared) {
        await tx.user.update({
          where: { id: u.id },
          data: { passwordHash: u.hash, mustChangePassword: true, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
        });
        await this.audit.record(
          { action: 'PASSWORD_RESET', ...auditBase(actor), targetType: 'user', targetId: u.id, details: { login: u.login } },
          tx,
        );
      }
      await tx.refreshToken.updateMany({
        where: { userId: { in: prepared.map((u) => u.id) }, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'password-reset' },
      });
    });
    for (const u of prepared) this.events.emit('user.sessionsRevoked', { userId: u.id, reason: 'password-reset' });
    return prepared.map((u) => ({ fullName: u.fullName, login: u.login, tempPassword: u.tempPassword, className: u.className }));
  }

  /**
   * «Мягкое» удаление: запись остаётся (авторство объектов на досках и
   * журнал сохраняют ссылку и ФИО), но логин освобождается, сессии
   * отзываются, членство в классах и на досках удаляется.
   */
  async delete(id: string, confirmLogin: string, actor: Actor): Promise<void> {
    if (id === actor.id) throw Errors.conflict('Нельзя удалить самого себя');
    const user = await this.findActive(id);
    if (confirmLogin !== user.login) {
      throw Errors.validation({ confirmLogin: ['Для подтверждения введите логин удаляемого пользователя'] });
    }
    await this.assertNotLastAdmin(user, 'удалить');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), login: `deleted.${id}`, isBlocked: true, blockedAt: new Date(), blockedReason: 'Удалён' },
      });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'deleted' } });
      await tx.classMember.deleteMany({ where: { userId: id } });
      await tx.boardMember.deleteMany({ where: { userId: id } });
      await tx.chalkGrant.deleteMany({ where: { userId: id } });
      await tx.templateShare.deleteMany({ where: { userId: id } });
      await this.audit.record(
        {
          action: 'USER_DELETED',
          ...auditBase(actor),
          targetType: 'user',
          targetId: id,
          details: { login: user.login, fullName: user.fullName, role: user.role },
        },
        tx,
      );
    });
    this.events.emit('user.sessionsRevoked', { userId: id, reason: 'deleted' });
  }

  async stats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const active = { deletedAt: null };
    const [total, admins, teachers, students, blocked, pendingPassword, classes, loginsToday, failedLoginsToday] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: active }),
        this.prisma.user.count({ where: { ...active, role: 'ADMIN' } }),
        this.prisma.user.count({ where: { ...active, role: 'TEACHER' } }),
        this.prisma.user.count({ where: { ...active, role: 'STUDENT' } }),
        this.prisma.user.count({ where: { ...active, isBlocked: true } }),
        this.prisma.user.count({ where: { ...active, mustChangePassword: true } }),
        this.prisma.class.count({ where: { archivedAt: null } }),
        this.prisma.auditLog.count({ where: { action: 'LOGIN_SUCCESS', createdAt: { gte: startOfDay } } }),
        this.prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', createdAt: { gte: startOfDay } } }),
      ]);
    return {
      users: { total, admins, teachers, students, blocked, pendingPassword },
      classes,
      loginsToday,
      failedLoginsToday,
    };
  }

  /** Подготовка данных для импорта: хеши паролей вне транзакции. */
  async prepareCredentials<T extends { login: string }>(rows: T[]): Promise<(T & { id: string; tempPassword: string; hash: string })[]> {
    return mapLimit(rows, HASH_CONCURRENCY, async (r) => {
      const tempPassword = generateTempPassword();
      return { ...r, id: randomUUID(), tempPassword, hash: await this.hasher.hash(tempPassword) };
    });
  }
}
