import * as Y from 'yjs';
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import {
  parseBoardSettings,
  type BoardAccessView,
  type BoardDetails,
  type BoardSummary,
  type CreateBoardRequest,
  type DirectoryQuery,
  type DirectoryUser,
  type ListBoardsQuery,
  type Paginated,
  type SetBoardAccessRequest,
  type UpdateBoardRequest,
} from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import type { AppEvents } from '../common/events.js';
import { auditBase, type Actor } from '../common/actor.js';
import { loadBoardAccess } from './access.js';
import { createInitialDocState } from '../realtime/doc.js';

export interface BoardUser {
  id: string;
  role: UserRole;
}

const summaryInclude = {
  owner: { select: { id: true, fullName: true } },
  classAccess: { include: { class: { select: { id: true, name: true } } } },
  members: { select: { userId: true, role: true } },
} satisfies Prisma.BoardInclude;

type BoardWithSummary = Prisma.BoardGetPayload<{ include: typeof summaryInclude }>;

/**
 * Доски: создание, список, свойства, доступ, удаление.
 * Права проверяются через loadBoardAccess → computeCapabilities (общие
 * правила клиента и сервера). Доска, к которой нет доступа, для
 * пользователя «не существует» (404), чтобы не раскрывать её наличие.
 */
export class BoardsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly events: AppEvents,
  ) {}

  private roleFor(b: BoardWithSummary, user: BoardUser): BoardSummary['role'] {
    if (b.ownerId === user.id) return 'owner';
    const m = b.members.find((x) => x.userId === user.id);
    if (m?.role === 'CO_TEACHER') return 'teacher';
    if (user.role === 'ADMIN' || m?.role === 'VIEWER') return 'viewer';
    if (b.kind === 'TEMPLATE' || b.kind === 'NOTEBOOK') return 'viewer';
    return 'student';
  }

  private toSummary(b: BoardWithSummary, user: BoardUser): BoardSummary {
    return {
      id: b.id,
      kind: b.kind,
      title: b.title,
      description: b.description,
      mode: b.mode,
      owner: { id: b.owner.id, fullName: b.owner.fullName },
      folderId: b.ownerId === user.id ? b.folderId : null,
      thumbnailUrl: null,
      objectCount: b.objectCount,
      pageCount: b.pageCount,
      lastActivityAt: b.lastActivityAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
      role: this.roleFor(b, user),
      classes: b.classAccess.map((a) => ({ id: a.class.id, name: a.class.name })),
      studentCount: b.members.filter((m) => m.role === 'STUDENT').length,
    };
  }

  /** Условие «доски, доступные пользователю, но не его собственные». */
  private sharedWhere(user: BoardUser): Prisma.BoardWhereInput {
    const or: Prisma.BoardWhereInput[] = [{ members: { some: { userId: user.id } } }];
    if (user.role === 'STUDENT') {
      or.push({
        kind: 'LESSON',
        classAccess: { some: { class: { archivedAt: null, members: { some: { userId: user.id, role: 'STUDENT' } } } } },
      });
      or.push({ kind: 'ASSIGNMENT_WORK', assignmentWork: { studentId: user.id } });
    }
    if (user.role === 'TEACHER') {
      // Открытые конспекты учеников из классов учителя.
      or.push({
        kind: 'NOTEBOOK',
        sharedWithTeachers: true,
        owner: {
          classMemberships: {
            some: { role: 'STUDENT', class: { archivedAt: null, members: { some: { userId: user.id, role: 'TEACHER' } } } },
          },
        },
      });
    }
    return { ownerId: { not: user.id }, OR: or };
  }

  async list(user: BoardUser, q: ListBoardsQuery): Promise<Paginated<BoardSummary>> {
    const and: Prisma.BoardWhereInput[] = [{ deletedAt: null }];
    // Работы учеников по заданиям показываются в разделе заданий (этап 4.2), не в общем списке.
    const ownWhere: Prisma.BoardWhereInput = { ownerId: user.id, kind: { not: 'ASSIGNMENT_WORK' } };
    if (user.role === 'ADMIN') {
      // Администратор видит все доски (только просмотр).
      if (q.scope === 'own') and.push(ownWhere);
    } else if (q.scope === 'own') and.push(ownWhere);
    else if (q.scope === 'shared') and.push(this.sharedWhere(user));
    else and.push({ OR: [ownWhere, this.sharedWhere(user)] });

    if (q.folderId === 'root') and.push({ folderId: null, ownerId: user.id });
    else if (q.folderId) and.push({ folderId: q.folderId, ownerId: user.id });
    if (q.kind) and.push({ kind: q.kind });
    if (q.search) and.push({ title: { contains: q.search, mode: 'insensitive' } });

    const where: Prisma.BoardWhereInput = { AND: and };
    const [total, boards] = await this.prisma.$transaction([
      this.prisma.board.count({ where }),
      this.prisma.board.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ [q.sort]: q.order }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: boards.map((b) => this.toSummary(b, user)), total, page: q.page, pageSize: q.pageSize };
  }

  private async requireAccess(user: BoardUser, boardId: string) {
    const access = await loadBoardAccess(this.prisma, user, boardId);
    if (!access || !access.caps.view) throw Errors.notFound('Доска не найдена');
    return access;
  }

  async getAccess(boardId: string): Promise<BoardAccessView> {
    const [classes, members] = await Promise.all([
      this.prisma.boardClassAccess.findMany({
        where: { boardId },
        include: { class: { select: { id: true, name: true, academicYear: true } } },
        orderBy: { class: { name: 'asc' } },
      }),
      this.prisma.boardMember.findMany({
        where: { boardId, user: { deletedAt: null } },
        include: { user: { select: { fullName: true, login: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
    ]);
    return {
      classes: classes.map((c) => c.class),
      members: members.map((m) => ({ userId: m.userId, fullName: m.user.fullName, login: m.user.login, role: m.role })),
    };
  }

  async get(user: BoardUser, boardId: string): Promise<BoardDetails> {
    const access = await this.requireAccess(user, boardId);
    const b = await this.prisma.board.findUniqueOrThrow({ where: { id: boardId }, include: summaryInclude });
    return {
      ...this.toSummary(b, user),
      role: access.caps.role,
      settings: parseBoardSettings(b.settings),
      sharedWithTeachers: b.sharedWithTeachers,
      capabilities: access.caps,
      access: access.caps.manageLesson ? await this.getAccess(boardId) : null,
    };
  }

  /** Классы, которым учитель может выдавать доски: те, где он назначен учителем. */
  private async assertTeacherClasses(user: BoardUser, classIds: readonly string[]): Promise<void> {
    if (classIds.length === 0) return;
    const ok = await this.prisma.class.findMany({
      where: {
        id: { in: [...classIds] },
        archivedAt: null,
        members: { some: { userId: user.id, role: 'TEACHER' } },
      },
      select: { id: true },
    });
    if (ok.length !== new Set(classIds).size) {
      throw Errors.validation({ classIds: ['Можно выдавать доски только своим действующим классам'] });
    }
  }

  private async assertMembers(members: SetBoardAccessRequest['members']): Promise<void> {
    if (members.length === 0) return;
    const ids = [...new Set(members.map((m) => m.userId))];
    if (ids.length !== members.length) throw Errors.validation({ members: ['Пользователь указан дважды'] });
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.role]));
    const problems: string[] = [];
    for (const m of members) {
      const role = byId.get(m.userId);
      if (!role) problems.push('Пользователь не найден');
      else if (m.role === 'CO_TEACHER' && role !== 'TEACHER') problems.push('Соведущим может быть только учитель');
      else if (m.role === 'STUDENT' && role !== 'STUDENT') problems.push('Ученический доступ — только для учеников');
      else if (role === 'ADMIN') problems.push('Администратор видит все доски и без доступа');
    }
    if (problems.length) throw Errors.validation({ members: [...new Set(problems)] });
  }

  private async assertFolder(user: BoardUser, folderId: string | null | undefined): Promise<void> {
    if (!folderId) return;
    const f = await this.prisma.folder.findFirst({ where: { id: folderId, ownerId: user.id }, select: { id: true } });
    if (!f) throw Errors.validation({ folderId: ['Папка не найдена'] });
  }

  /**
   * Создание доски. Учитель создаёт доски уроков, ученик — личные
   * конспекты; администратор досок не создаёт (только просмотр).
   */
  async create(user: BoardUser, input: CreateBoardRequest, actor: Actor): Promise<BoardDetails> {
    if (user.role === 'ADMIN') throw Errors.forbidden('Администратор не создаёт доски');
    const kind = user.role === 'TEACHER' ? 'LESSON' : 'NOTEBOOK';
    if (kind === 'NOTEBOOK' && (input.classIds.length || input.studentIds.length)) {
      throw Errors.validation({ classIds: ['Конспект виден только вам'] });
    }
    await this.assertFolder(user, input.folderId);
    await this.assertTeacherClasses(user, input.classIds);
    const members = input.studentIds.map((userId) => ({ userId, role: 'STUDENT' as const }));
    await this.assertMembers(members);

    const state = createInitialDocState(user.id);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const sv = Y.encodeStateVector(doc);
    doc.destroy();

    const board = await this.prisma.$transaction(async (tx) => {
      const b = await tx.board.create({
        data: {
          kind,
          title: input.title,
          description: input.description || null,
          ownerId: user.id,
          folderId: input.folderId ?? null,
          mode: kind === 'NOTEBOOK' ? 'LECTURE' : input.mode,
          document: { create: { state: Buffer.from(state), stateVector: Buffer.from(sv), sizeBytes: state.byteLength } },
          classAccess: { create: [...new Set(input.classIds)].map((classId) => ({ classId, grantedById: user.id })) },
          members: { create: members },
        },
      });
      await this.audit.record(
        {
          action: 'BOARD_CREATED',
          ...auditBase(actor),
          targetType: 'board',
          targetId: b.id,
          details: { title: b.title, kind, classIds: input.classIds, students: input.studentIds.length },
        },
        tx,
      );
      return b;
    });
    return this.get(user, board.id);
  }

  async update(user: BoardUser, boardId: string, input: UpdateBoardRequest, actor: Actor): Promise<BoardDetails> {
    const access = await this.requireAccess(user, boardId);
    const { caps, board } = access;
    const isOwner = board.ownerId === user.id;
    if ((input.title !== undefined || input.description !== undefined) && !(caps.manageLesson || (isOwner && caps.write))) {
      throw Errors.forbidden('Нет прав изменять доску');
    }
    if (input.folderId !== undefined) {
      if (!isOwner) throw Errors.forbidden('Переносить в папки можно только свои доски');
      await this.assertFolder(user, input.folderId);
    }
    if (input.settings && !caps.manageLesson) throw Errors.forbidden('Настройки доски меняет учитель');
    if (input.mode !== undefined) {
      if (!caps.manageLesson) throw Errors.forbidden('Режим доски меняет учитель');
      if (board.kind !== 'LESSON') throw Errors.conflict('Режим есть только у доски урока');
    }
    const modeChanged = input.mode !== undefined && input.mode !== board.mode;
    if (input.sharedWithTeachers !== undefined && !(board.kind === 'NOTEBOOK' && isOwner)) {
      throw Errors.forbidden('Открыть учителям можно только свой конспект');
    }
    const settings = input.settings ? { ...parseBoardSettings(board.settings), ...input.settings } : undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.board.update({
        where: { id: boardId },
        data: {
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          ...(settings ? { settings: settings as Prisma.InputJsonValue } : {}),
          ...(input.sharedWithTeachers !== undefined ? { sharedWithTeachers: input.sharedWithTeachers } : {}),
        },
      });
      if (modeChanged) {
        await this.audit.record(
          {
            action: 'BOARD_MODE_CHANGED',
            ...auditBase(actor),
            targetType: 'board',
            targetId: boardId,
            details: { title: board.title, from: board.mode, to: input.mode },
          },
          tx,
        );
      }
    });
    if (settings || modeChanged || input.title !== undefined || input.sharedWithTeachers !== undefined) {
      this.events.emit('board.updated', { boardId, ...(modeChanged ? { by: user.id } : {}) });
    }
    return this.get(user, boardId);
  }

  async setAccess(user: BoardUser, boardId: string, input: SetBoardAccessRequest, actor: Actor): Promise<BoardAccessView> {
    const { caps, board } = await this.requireAccess(user, boardId);
    if (!caps.manageLesson) throw Errors.forbidden('Доступом к доске управляет учитель');
    if (board.kind !== 'LESSON' && board.kind !== 'TEMPLATE') {
      throw Errors.conflict('Доступ к этой доске определяется её типом');
    }
    if (input.members.some((m) => m.userId === board.ownerId)) {
      throw Errors.validation({ members: ['Владелец доски уже имеет полный доступ'] });
    }
    // Новые классы проверяем как «свои классы учителя»; уже выданные (например,
    // соведущим) можно оставить.
    const current = await this.prisma.boardClassAccess.findMany({ where: { boardId }, select: { classId: true } });
    const currentIds = new Set(current.map((c) => c.classId));
    await this.assertTeacherClasses(user, input.classIds.filter((id) => !currentIds.has(id)));
    await this.assertMembers(input.members);

    await this.prisma.$transaction(async (tx) => {
      await tx.boardClassAccess.deleteMany({ where: { boardId } });
      await tx.boardMember.deleteMany({ where: { boardId } });
      if (input.classIds.length) {
        await tx.boardClassAccess.createMany({
          data: [...new Set(input.classIds)].map((classId) => ({ boardId, classId, grantedById: user.id })),
        });
      }
      if (input.members.length) {
        await tx.boardMember.createMany({ data: input.members.map((m) => ({ boardId, userId: m.userId, role: m.role })) });
      }
      // Мел у тех, кто потерял доступ, снимается.
      await tx.chalkGrant.deleteMany({
        where: {
          boardId,
          userId: { notIn: input.members.map((m) => m.userId) },
          user: { classMemberships: { none: { classId: { in: input.classIds } } } },
        },
      });
      await this.audit.record(
        {
          action: 'BOARD_ACCESS_CHANGED',
          ...auditBase(actor),
          targetType: 'board',
          targetId: boardId,
          details: { title: board.title, classIds: input.classIds, members: input.members },
        },
        tx,
      );
    });
    this.events.emit('board.accessChanged', { boardId });
    return this.getAccess(boardId);
  }

  async delete(user: BoardUser, boardId: string, actor: Actor): Promise<void> {
    const { board } = await this.requireAccess(user, boardId);
    if (board.ownerId !== user.id) throw Errors.forbidden('Удалить доску может только её владелец');
    if (board.kind === 'ASSIGNMENT_WORK') throw new AppError(409, 'CONFLICT', 'Работы по заданию удаляются вместе с заданием');
    await this.prisma.$transaction(async (tx) => {
      await tx.board.update({ where: { id: boardId }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { action: 'BOARD_DELETED', ...auditBase(actor), targetType: 'board', targetId: boardId, details: { title: board.title } },
        tx,
      );
    });
    this.events.emit('board.deleted', { boardId });
  }

  /**
   * Люди, связанные с доской (владелец, участники, классы с доступом,
   * исполнитель задания) — для подписей «кто нарисовал» и списка участников.
   * Только для тех, кто видит доску.
   */
  async people(user: BoardUser, boardId: string): Promise<{ id: string; fullName: string; role: UserRole }[]> {
    const { board } = await this.requireAccess(user, boardId);
    const work = await this.prisma.assignmentWork.findUnique({ where: { boardId }, select: { studentId: true } });
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: board.ownerId },
          ...(work ? [{ id: work.studentId }] : []),
          { boardMemberships: { some: { boardId } } },
          { classMemberships: { some: { class: { boardAccess: { some: { boardId } } } } } },
        ],
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
      take: 2000,
    });
    return users;
  }

  /**
   * Поиск людей для выдачи доступа к доске. Только для учителей: ученики —
   * все действующие (доску можно выдать любому ученику), учителя — для
   * соведущих. Ищется по ФИО и логину.
   */
  async directory(user: BoardUser, q: DirectoryQuery): Promise<DirectoryUser[]> {
    if (user.role !== 'TEACHER') throw Errors.forbidden('Поиск людей доступен учителям');
    if (q.classId) await this.assertTeacherClasses(user, [q.classId]);
    const and: Prisma.UserWhereInput[] = [{ role: q.role, deletedAt: null, isBlocked: false, id: { not: user.id } }];
    if (q.search) {
      and.push({ OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { login: { contains: q.search.toLowerCase() } }] });
    }
    if (q.classId) and.push({ classMemberships: { some: { classId: q.classId, role: 'STUDENT' } } });
    const users = await this.prisma.user.findMany({
      where: { AND: and },
      select: {
        id: true,
        fullName: true,
        login: true,
        role: true,
        classMemberships: { where: { class: { archivedAt: null } }, select: { class: { select: { name: true } } } },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: q.limit,
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      login: u.login,
      role: u.role as DirectoryUser['role'],
      classes: u.classMemberships.map((m) => m.class.name).sort((a, b) => a.localeCompare(b, 'ru')),
    }));
  }

  /** Классы, где пользователь — учитель (для выдачи досок). */
  async myClasses(user: BoardUser) {
    const classes = await this.prisma.class.findMany({
      where: { archivedAt: null, members: { some: { userId: user.id, role: 'TEACHER' } } },
      include: { _count: { select: { members: { where: { role: 'STUDENT', user: { deletedAt: null } } } } } },
      orderBy: [{ academicYear: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    });
    return classes.map((c) => ({ id: c.id, name: c.name, academicYear: c.academicYear, studentCount: c._count.members }));
  }
}
