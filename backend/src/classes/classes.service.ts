import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type {
  ClassDetails,
  ClassMemberInfo,
  ClassSummary,
  Credential,
  Paginated,
  createClassSchema,
  listClassesQuerySchema,
  updateClassSchema,
} from '@doska/shared';
import { Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import { auditBase, type Actor } from '../common/actor.js';
import { memberRoleFor, type UsersService } from '../users/users.service.js';

type ListQuery = z.infer<typeof listClassesQuerySchema>;
type CreateInput = z.infer<typeof createClassSchema>;
type UpdateInput = z.infer<typeof updateClassSchema>;

const summaryInclude = {
  _count: { select: { members: { where: { role: 'STUDENT', user: { deletedAt: null } } } } },
  members: {
    where: { role: 'TEACHER', user: { deletedAt: null } },
    include: { user: { select: { id: true, fullName: true } } },
    orderBy: { user: { fullName: 'asc' } },
  },
} satisfies Prisma.ClassInclude;

type ClassWithSummary = Prisma.ClassGetPayload<{ include: typeof summaryInclude }>;

function toSummary(c: ClassWithSummary): ClassSummary {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    academicYear: c.academicYear,
    archived: !!c.archivedAt,
    studentCount: c._count.members,
    teachers: c.members.map((m) => ({ id: m.user.id, fullName: m.user.fullName })),
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Классы и группы: создание, состав, назначение учителей, архив.
 */
export class ClassesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListQuery): Promise<Paginated<ClassSummary>> {
    const where: Prisma.ClassWhereInput = {
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.academicYear ? { academicYear: q.academicYear } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.class.count({ where }),
      this.prisma.class.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { academicYear: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: items.map(toSummary), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string): Promise<ClassDetails> {
    const c = await this.prisma.class.findUnique({ where: { id }, include: summaryInclude });
    if (!c) throw Errors.notFound('Класс не найден');
    const members = await this.prisma.classMember.findMany({
      where: { classId: id, user: { deletedAt: null } },
      include: {
        user: { select: { id: true, login: true, fullName: true, role: true, isBlocked: true, mustChangePassword: true, lastLoginAt: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });
    const info = (m: (typeof members)[number]): ClassMemberInfo => ({
      id: m.user.id,
      login: m.user.login,
      fullName: m.user.fullName,
      role: m.user.role,
      isBlocked: m.user.isBlocked,
      mustChangePassword: m.user.mustChangePassword,
      lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    });
    return {
      ...toSummary(c),
      students: members.filter((m) => m.role === 'STUDENT').map(info),
      teacherMembers: members.filter((m) => m.role === 'TEACHER').map(info),
    };
  }

  /** Уникальность (название, учебный год) с учётом NULL-года (в PostgreSQL NULL ≠ NULL). */
  private async assertNameFree(name: string, academicYear: string | null, exceptId?: string): Promise<void> {
    const dup = await this.prisma.class.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        academicYear,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (dup) {
      throw Errors.conflict(
        academicYear ? `Класс «${name}» в ${academicYear} учебном году уже существует` : `Класс «${name}» уже существует`,
      );
    }
  }

  async create(input: CreateInput, actor: Actor): Promise<ClassDetails> {
    await this.assertNameFree(input.name, input.academicYear ?? null);
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.class.create({
        data: { name: input.name, description: input.description || null, academicYear: input.academicYear ?? null },
      });
      await this.audit.record(
        { action: 'CLASS_CREATED', ...auditBase(actor), targetType: 'class', targetId: created.id, details: { name: created.name } },
        tx,
      );
      return created;
    });
    return this.get(c.id);
  }

  async update(id: string, input: UpdateInput, actor: Actor): Promise<ClassDetails> {
    const c = await this.prisma.class.findUnique({ where: { id } });
    if (!c) throw Errors.notFound('Класс не найден');
    const name = input.name ?? c.name;
    const year = input.academicYear === undefined ? c.academicYear : input.academicYear;
    if (name !== c.name || year !== c.academicYear) await this.assertNameFree(name, year, id);

    const changes: Record<string, unknown> = {};
    if (name !== c.name) changes.name = { from: c.name, to: name };
    if (year !== c.academicYear) changes.academicYear = { from: c.academicYear, to: year };
    if (input.description !== undefined && input.description !== c.description) changes.description = true;
    if (input.archived !== undefined && input.archived !== !!c.archivedAt) changes.archived = input.archived;

    await this.prisma.$transaction(async (tx) => {
      await tx.class.update({
        where: { id },
        data: {
          name,
          academicYear: year,
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.archived !== undefined ? { archivedAt: input.archived ? (c.archivedAt ?? new Date()) : null } : {}),
        },
      });
      if (Object.keys(changes).length) {
        await this.audit.record(
          { action: 'CLASS_UPDATED', ...auditBase(actor), targetType: 'class', targetId: id, details: { name, changes } },
          tx,
        );
      }
    });
    return this.get(id);
  }

  /** Удаление класса (пользователи остаются; доступы досок классу снимаются). */
  async delete(id: string, confirmName: string, actor: Actor): Promise<void> {
    const c = await this.prisma.class.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
    if (!c) throw Errors.notFound('Класс не найден');
    if (confirmName.trim().toLowerCase() !== c.name.toLowerCase()) {
      throw Errors.validation({ confirmName: ['Для подтверждения введите название класса'] });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.class.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'CLASS_DELETED',
          ...auditBase(actor),
          targetType: 'class',
          targetId: id,
          details: { name: c.name, academicYear: c.academicYear, members: c._count.members },
        },
        tx,
      );
    });
  }

  /**
   * Добавление участников. Роль в классе определяется глобальной ролью:
   * ученики становятся учениками класса, учителя — учителями класса.
   */
  async addMembers(id: string, userIds: string[], actor: Actor): Promise<ClassDetails> {
    const c = await this.prisma.class.findUnique({ where: { id } });
    if (!c) throw Errors.notFound('Класс не найден');
    if (c.archivedAt) throw Errors.conflict('Класс в архиве — сначала верните его из архива');
    const unique = [...new Set(userIds)];
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, role: true, login: true },
    });
    if (users.length !== unique.length) throw Errors.validation({ userIds: ['Некоторые пользователи не найдены'] });
    const admins = users.filter((u) => u.role === 'ADMIN');
    if (admins.length) throw Errors.validation({ userIds: ['Администратора нельзя добавить в класс'] });

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.classMember.createMany({
        data: users.map((u) => ({ classId: id, userId: u.id, role: memberRoleFor(u.role) })),
        skipDuplicates: true,
      });
      if (count > 0) {
        await this.audit.record(
          {
            action: 'CLASS_MEMBERS_CHANGED',
            ...auditBase(actor),
            targetType: 'class',
            targetId: id,
            details: { name: c.name, added: users.map((u) => u.login) },
          },
          tx,
        );
      }
    });
    return this.get(id);
  }

  async removeMember(id: string, userId: string, actor: Actor): Promise<ClassDetails> {
    const m = await this.prisma.classMember.findUnique({
      where: { classId_userId: { classId: id, userId } },
      include: { user: { select: { login: true } }, class: { select: { name: true } } },
    });
    if (!m) throw Errors.notFound('Пользователь не состоит в этом классе');
    await this.prisma.$transaction(async (tx) => {
      await tx.classMember.delete({ where: { classId_userId: { classId: id, userId } } });
      await this.audit.record(
        {
          action: 'CLASS_MEMBERS_CHANGED',
          ...auditBase(actor),
          targetType: 'class',
          targetId: id,
          details: { name: m.class.name, removed: [m.user.login] },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Новые временные пароли ученикам класса (для печати листков с паролями). */
  async resetPasswords(id: string, onlyPending: boolean, actor: Actor): Promise<Credential[]> {
    const c = await this.prisma.class.findUnique({ where: { id } });
    if (!c) throw Errors.notFound('Класс не найден');
    const students = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isBlocked: false,
        role: 'STUDENT',
        classMemberships: { some: { classId: id, role: 'STUDENT' } },
        ...(onlyPending ? { mustChangePassword: true } : {}),
      },
      select: { id: true, login: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    if (students.length === 0) return [];
    return this.users.resetPasswordsFor(
      students.map((s) => ({ ...s, className: c.name })),
      actor,
    );
  }
}
