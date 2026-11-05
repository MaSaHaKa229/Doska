import * as Y from 'yjs';
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import {
  DOC_ROOTS,
  type CreateTemplateRequest,
  type ListTemplatesQuery,
  type Paginated,
  type TemplateSummary,
  type UpdateTemplateRequest,
  type UseTemplateRequest,
} from '@doska/shared';
import { Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import { auditBase, type Actor } from '../common/actor.js';
import { loadBoardAccess } from '../boards/access.js';
import type { BoardStateReader } from '../assignments/assignments.service.js';

export interface TemplateUser {
  id: string;
  role: UserRole;
}

const include = {
  author: { select: { id: true, fullName: true } },
  board: { select: { lastActivityAt: true, ownerId: true, deletedAt: true } },
  shares: { select: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.TemplateInclude;
type Row = Prisma.TemplateGetPayload<{ include: typeof include }>;

/**
 * Библиотека шаблонов. Шаблон — доска kind = TEMPLATE и запись Template с
 * описанием. Видимость: встроенные и «всем учителям» — всем учителям, свои —
 * автору, «выбранным» — автору и учителям из TemplateShare. Ученики
 * библиотекой не пользуются; администратор видит всё (только просмотр).
 */
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly readState: BoardStateReader,
  ) {}

  private visibleWhere(user: TemplateUser): Prisma.TemplateWhereInput {
    if (user.role === 'ADMIN') return {};
    return { OR: [{ visibility: { in: ['BUILTIN', 'TEACHERS'] } }, { authorId: user.id }, { shares: { some: { userId: user.id } } }] };
  }

  private requireStaff(user: TemplateUser): void {
    if (user.role === 'STUDENT') throw Errors.forbidden('Библиотека шаблонов доступна учителям');
  }

  private requireTeacher(user: TemplateUser): void {
    if (user.role !== 'TEACHER') throw Errors.forbidden('Шаблоны создают учителя');
  }

  private toSummary(t: Row, user: TemplateUser): TemplateSummary {
    const mine = t.authorId === user.id;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      section: t.section,
      level: t.level,
      tags: t.tags,
      visibility: t.visibility,
      author: t.author,
      boardId: t.boardId,
      usageCount: t.usageCount,
      mine,
      sharedWith: mine ? t.shares.map((s) => s.user) : [],
      boardActivityAt: t.board.lastActivityAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async list(user: TemplateUser, q: ListTemplatesQuery): Promise<Paginated<TemplateSummary>> {
    this.requireStaff(user);
    const and: Prisma.TemplateWhereInput[] = [this.visibleWhere(user), { board: { deletedAt: null } }];
    if (q.scope === 'mine') and.push({ authorId: user.id });
    if (q.scope === 'builtin') and.push({ visibility: 'BUILTIN' });
    if (q.scope === 'shared') and.push({ visibility: { not: 'BUILTIN' }, OR: [{ authorId: null }, { authorId: { not: user.id } }] });
    if (q.section) and.push({ OR: [{ section: q.section }, { section: { startsWith: `${q.section}.` } }] });
    if (q.level) and.push({ level: q.level });
    if (q.search) {
      const s = q.search;
      and.push({ OR: [{ title: { contains: s, mode: 'insensitive' } }, { description: { contains: s, mode: 'insensitive' } }, { tags: { has: s.toLowerCase() } }] });
    }
    const where: Prisma.TemplateWhereInput = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.template.count({ where }),
      this.prisma.template.findMany({
        where,
        include,
        orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map((r) => this.toSummary(r, user)), total, page: q.page, pageSize: q.pageSize };
  }

  /** Видимый шаблон (иначе «не найден»). */
  private async visible(user: TemplateUser, id: string): Promise<Row> {
    this.requireStaff(user);
    const t = await this.prisma.template.findFirst({ where: { AND: [{ id }, this.visibleWhere(user), { board: { deletedAt: null } }] }, include });
    if (!t) throw Errors.notFound('Шаблон не найден');
    return t;
  }

  /** Свой шаблон (встроенные не меняются). */
  private async own(user: TemplateUser, id: string): Promise<Row> {
    const t = await this.visible(user, id);
    if (t.authorId !== user.id) throw Errors.forbidden(t.visibility === 'BUILTIN' ? 'Встроенный шаблон изменить нельзя — создайте из него свою доску' : 'Изменять шаблон может только автор');
    return t;
  }

  async get(user: TemplateUser, id: string): Promise<TemplateSummary> {
    return this.toSummary(await this.visible(user, id), user);
  }

  /** Получатели выбранной видимости — только действующие учителя (не сам автор). */
  private async assertTeachers(user: TemplateUser, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)].filter((id) => id !== user.id);
    if (!unique.length) return [];
    const found = await this.prisma.user.count({ where: { id: { in: unique }, role: 'TEACHER', deletedAt: null } });
    if (found !== unique.length) throw Errors.validation({ shareUserIds: ['Шаблон можно открыть только учителям'] });
    return unique;
  }

  /** Копия документа доски: состояние, вектор, счётчики. */
  private async copyState(boardId: string, ownerId: string) {
    const state = await this.readState(boardId, ownerId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const out = { state, sv: Y.encodeStateVector(doc), objectCount: doc.getMap(DOC_ROOTS.objects).size, pageCount: doc.getMap(DOC_ROOTS.pages).size };
    doc.destroy();
    return out;
  }

  async create(user: TemplateUser, input: CreateTemplateRequest, actor: Actor): Promise<TemplateSummary> {
    this.requireTeacher(user);
    const access = await loadBoardAccess(this.prisma, user, input.boardId);
    if (!access || !access.caps.view) throw Errors.validation({ boardId: ['Доска не найдена'] });
    if (access.board.kind === 'NOTEBOOK' && access.board.ownerId !== user.id) throw Errors.validation({ boardId: ['Конспект ученика нельзя сохранить как шаблон'] });
    const shares = input.visibility === 'SELECTED' ? await this.assertTeachers(user, input.shareUserIds) : [];
    if (input.visibility === 'SELECTED' && !shares.length) throw Errors.validation({ shareUserIds: ['Выберите учителей'] });
    const copy = await this.copyState(access.board.id, access.board.ownerId);
    const id = await this.prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          kind: 'TEMPLATE',
          title: input.title,
          description: input.description || null,
          ownerId: user.id,
          objectCount: copy.objectCount,
          pageCount: copy.pageCount,
          document: { create: { state: Buffer.from(copy.state), stateVector: Buffer.from(copy.sv), sizeBytes: copy.state.byteLength } },
        },
      });
      const t = await tx.template.create({
        data: {
          title: input.title,
          description: input.description || null,
          section: input.section,
          level: input.level,
          tags: input.tags.map((s) => s.toLowerCase()),
          visibility: input.visibility,
          authorId: user.id,
          boardId: board.id,
          shares: { create: shares.map((userId) => ({ userId })) },
        },
      });
      await this.audit.record({ action: 'BOARD_CREATED', ...auditBase(actor), targetType: 'board', targetId: board.id, details: { title: input.title, kind: 'TEMPLATE', from: input.boardId } }, tx);
      if (input.visibility !== 'PRIVATE') {
        await this.audit.record({ action: 'TEMPLATE_SHARED', ...auditBase(actor), targetType: 'template', targetId: t.id, details: { title: input.title, visibility: input.visibility, teachers: shares.length } }, tx);
      }
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: TemplateUser, id: string, input: UpdateTemplateRequest, actor: Actor): Promise<TemplateSummary> {
    const t = await this.own(user, id);
    const visibility = input.visibility ?? t.visibility;
    const shares = visibility === 'SELECTED' ? await this.assertTeachers(user, input.shareUserIds ?? t.shares.map((s) => s.user.id)) : [];
    if (visibility === 'SELECTED' && !shares.length) throw Errors.validation({ shareUserIds: ['Выберите учителей'] });
    const visibilityChanged = visibility !== t.visibility || (visibility === 'SELECTED' && input.shareUserIds !== undefined);
    await this.prisma.$transaction(async (tx) => {
      await tx.template.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description === undefined ? undefined : input.description || null,
          section: input.section,
          level: input.level,
          tags: input.tags?.map((s) => s.toLowerCase()),
          visibility,
        },
      });
      if (input.title !== undefined || input.description !== undefined) {
        await tx.board.update({ where: { id: t.boardId }, data: { title: input.title, description: input.description === undefined ? undefined : input.description || null } });
      }
      if (visibilityChanged) {
        await tx.templateShare.deleteMany({ where: { templateId: id } });
        if (shares.length) await tx.templateShare.createMany({ data: shares.map((userId) => ({ templateId: id, userId })) });
        if (visibility !== 'PRIVATE') {
          await this.audit.record({ action: 'TEMPLATE_SHARED', ...auditBase(actor), targetType: 'template', targetId: id, details: { title: input.title ?? t.title, visibility, teachers: shares.length } }, tx);
        }
      }
    });
    return this.get(user, id);
  }

  /** Удаление: запись шаблона и доска (в корзину, как обычные доски). */
  async delete(user: TemplateUser, id: string, actor: Actor): Promise<void> {
    const t = await this.own(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.template.delete({ where: { id } });
      await tx.board.update({ where: { id: t.boardId }, data: { deletedAt: new Date() } });
      await this.audit.record({ action: 'BOARD_DELETED', ...auditBase(actor), targetType: 'board', targetId: t.boardId, details: { title: t.title, kind: 'TEMPLATE' } }, tx);
    });
  }

  /** Доска урока из шаблона: копия текущего содержимого, владелец — учитель. */
  async use(user: TemplateUser, id: string, input: UseTemplateRequest, actor: Actor): Promise<{ boardId: string }> {
    this.requireTeacher(user);
    const t = await this.visible(user, id);
    if (input.folderId) {
      const f = await this.prisma.folder.findFirst({ where: { id: input.folderId, ownerId: user.id }, select: { id: true } });
      if (!f) throw Errors.validation({ folderId: ['Папка не найдена'] });
    }
    const copy = await this.copyState(t.boardId, t.board.ownerId);
    const title = input.title ?? t.title;
    const boardId = await this.prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          kind: 'LESSON',
          title,
          description: t.description,
          ownerId: user.id,
          folderId: input.folderId,
          objectCount: copy.objectCount,
          pageCount: copy.pageCount,
          document: { create: { state: Buffer.from(copy.state), stateVector: Buffer.from(copy.sv), sizeBytes: copy.state.byteLength } },
        },
      });
      await tx.template.update({ where: { id }, data: { usageCount: { increment: 1 } } });
      await this.audit.record({ action: 'BOARD_CREATED', ...auditBase(actor), targetType: 'board', targetId: board.id, details: { title, kind: 'LESSON', template: id } }, tx);
      return board.id;
    });
    return { boardId };
  }
}
