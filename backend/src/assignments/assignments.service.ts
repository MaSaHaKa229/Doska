import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { AssignmentWorkStatus, Prisma, PrismaClient, UserRole } from '@prisma/client';
import {
  ASSIGNMENT_WORK_STATUSES,
  DOC_ROOTS,
  type AssignmentDetails,
  type AssignmentSummary,
  type AssignmentWorkView,
  type CreateAssignmentRequest,
  type StudentAssignment,
  type UpdateAssignmentRequest,
  type WorkCounts,
} from '@doska/shared';
import { Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import type { AppEvents } from '../common/events.js';
import { auditBase, type Actor } from '../common/actor.js';
import { loadBoardAccess } from '../boards/access.js';

export interface AssignmentUser {
  id: string;
  role: UserRole;
}

/** Текущее состояние документа доски (из комнаты или из БД). */
export type BoardStateReader = (boardId: string, ownerId: string) => Promise<Uint8Array>;

/** Сколько работ можно выдать одним заданием. */
const MAX_WORKS = 500;

const summaryInclude = {
  class: { select: { id: true, name: true } },
} satisfies Prisma.AssignmentInclude;

type AssignmentRow = Prisma.AssignmentGetPayload<{ include: typeof summaryInclude }>;

function emptyCounts(): WorkCounts {
  return Object.fromEntries(ASSIGNMENT_WORK_STATUSES.map((s) => [s, 0])) as WorkCounts;
}

/**
 * Задания: раздача копий доски ученикам, сдача и проверка работ.
 *
 * Копия — отдельная доска kind = ASSIGNMENT_WORK, владелец — учитель,
 * поэтому учитель (и только он) видит и проверяет её с полными правами, а
 * ученик получает доступ по AssignmentWork (правила computeCapabilities).
 * После сдачи, проверки или закрытия задания ученик работу не меняет.
 */
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly events: AppEvents,
    private readonly readState: BoardStateReader,
  ) {}

  private requireTeacher(user: AssignmentUser): void {
    if (user.role !== 'TEACHER') throw Errors.forbidden('Задания выдают учителя');
  }

  /** Задание учителя; чужое — «не найдено». */
  private async own(user: AssignmentUser, id: string): Promise<AssignmentRow> {
    this.requireTeacher(user);
    const a = await this.prisma.assignment.findFirst({ where: { id, teacherId: user.id }, include: summaryInclude });
    if (!a) throw Errors.notFound('Задание не найдено');
    return a;
  }

  private async counts(ids: string[]): Promise<Map<string, WorkCounts>> {
    const rows = await this.prisma.assignmentWork.groupBy({
      by: ['assignmentId', 'status'],
      where: { assignmentId: { in: ids }, board: { deletedAt: null } },
      _count: { _all: true },
    });
    const out = new Map<string, WorkCounts>();
    for (const r of rows) {
      const c = out.get(r.assignmentId) ?? emptyCounts();
      c[r.status] = r._count._all;
      out.set(r.assignmentId, c);
    }
    return out;
  }

  private toSummary(a: AssignmentRow, counts: WorkCounts): AssignmentSummary {
    return {
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      templateBoardId: a.templateBoardId,
      class: a.class,
      dueAt: a.dueAt?.toISOString() ?? null,
      closedAt: a.closedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      counts,
    };
  }

  async list(user: AssignmentUser): Promise<AssignmentSummary[]> {
    this.requireTeacher(user);
    const rows = await this.prisma.assignment.findMany({
      where: { teacherId: user.id },
      include: summaryInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    const counts = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => this.toSummary(r, counts.get(r.id) ?? emptyCounts()));
  }

  async get(user: AssignmentUser, id: string): Promise<AssignmentDetails> {
    const a = await this.own(user, id);
    const works = await this.prisma.assignmentWork.findMany({
      where: { assignmentId: id, board: { deletedAt: null } },
      include: { student: { select: { id: true, fullName: true } }, board: { select: { lastActivityAt: true } } },
      orderBy: { student: { fullName: 'asc' } },
    });
    const counts = emptyCounts();
    for (const w of works) counts[w.status]++;
    return {
      ...this.toSummary(a, counts),
      works: works.map(
        (w): AssignmentWorkView => ({
          id: w.id,
          boardId: w.boardId,
          student: w.student,
          status: w.status,
          submittedAt: w.submittedAt?.toISOString() ?? null,
          reviewedAt: w.reviewedAt?.toISOString() ?? null,
          grade: w.grade,
          updatedAt: w.updatedAt.toISOString(),
          lastActivityAt: w.board.lastActivityAt.toISOString(),
        }),
      ),
      missingClassStudents: a.classId ? (await this.missingClassStudents(a.id, a.classId)).length : 0,
    };
  }

  /** Ученики класса задания без работы (пришли в класс после выдачи). */
  private async missingClassStudents(assignmentId: string, classId: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        role: 'STUDENT',
        deletedAt: null,
        classMemberships: { some: { classId, role: 'STUDENT' } },
        assignmentWorks: { none: { assignmentId } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Учитель может выдавать задания только своим действующим классам. */
  private async assertTeacherClass(user: AssignmentUser, classId: string): Promise<void> {
    const ok = await this.prisma.class.findFirst({
      where: { id: classId, archivedAt: null, members: { some: { userId: user.id, role: 'TEACHER' } } },
      select: { id: true },
    });
    if (!ok) throw Errors.validation({ classId: ['Можно выдавать задания только своим действующим классам'] });
  }

  private async classStudents(classId: string): Promise<string[]> {
    const rows = await this.prisma.classMember.findMany({
      where: { classId, role: 'STUDENT', user: { deletedAt: null } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  private async assertStudents(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.prisma.user.count({ where: { id: { in: ids }, role: 'STUDENT', deletedAt: null } });
    if (found !== ids.length) throw Errors.validation({ studentIds: ['Задание можно выдать только ученикам'] });
  }

  /**
   * Создать работы (копии документа) для учеников. Документ читается один
   * раз; доски, документы и работы создаются пакетно в одной транзакции.
   */
  private async createWorks(
    tx: Prisma.TransactionClient,
    a: { id: string; title: string; teacherId: string },
    studentIds: string[],
    state: Uint8Array,
  ): Promise<string[]> {
    if (!studentIds.length) return [];
    const students = await tx.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true } });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const sv = Y.encodeStateVector(doc);
    const objectCount = doc.getMap(DOC_ROOTS.objects).size;
    const pageCount = doc.getMap(DOC_ROOTS.pages).size;
    doc.destroy();
    const rows = students.map((s) => ({ student: s, boardId: randomUUID() }));
    await tx.board.createMany({
      data: rows.map((r) => ({
        id: r.boardId,
        kind: 'ASSIGNMENT_WORK' as const,
        title: `${a.title} — ${r.student.fullName}`.slice(0, 300),
        ownerId: a.teacherId,
        mode: 'COLLABORATIVE' as const,
        objectCount,
        pageCount,
      })),
    });
    await tx.boardDocument.createMany({
      data: rows.map((r) => ({ boardId: r.boardId, state: Buffer.from(state), stateVector: Buffer.from(sv), sizeBytes: state.byteLength })),
    });
    await tx.assignmentWork.createMany({
      data: rows.map((r) => ({ assignmentId: a.id, studentId: r.student.id, boardId: r.boardId })),
    });
    return rows.map((r) => r.boardId);
  }

  async create(user: AssignmentUser, input: CreateAssignmentRequest, actor: Actor): Promise<AssignmentDetails> {
    this.requireTeacher(user);
    const access = await loadBoardAccess(this.prisma, user, input.templateBoardId);
    if (!access || !access.caps.view) throw Errors.validation({ templateBoardId: ['Доска не найдена'] });
    // Шаблон библиотеки, видимый учителю (в том числе встроенный), раздаётся и без прав на изменение.
    const ok = access.board.kind === 'TEMPLATE' ? access.caps.view : access.caps.manageLesson && access.board.kind === 'LESSON';
    if (!ok) {
      throw Errors.validation({ templateBoardId: ['Раздать можно свою доску урока или шаблон'] });
    }
    if (input.classId) await this.assertTeacherClass(user, input.classId);
    const direct = [...new Set(input.studentIds)];
    await this.assertStudents(direct);
    const students = [...new Set([...(input.classId ? await this.classStudents(input.classId) : []), ...direct])];
    if (students.length === 0) throw Errors.validation({ classId: ['В классе нет учеников — выберите учеников'] });
    if (students.length > MAX_WORKS) throw Errors.validation({ studentIds: [`Не больше ${MAX_WORKS} учеников в одном задании`] });

    const state = await this.readState(access.board.id, access.board.ownerId);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const a = await tx.assignment.create({
          data: {
            title: input.title,
            instructions: input.instructions || null,
            teacherId: user.id,
            templateBoardId: input.templateBoardId,
            classId: input.classId,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
          },
        });
        await this.createWorks(tx, a, students, state);
        await tx.template.updateMany({ where: { boardId: input.templateBoardId }, data: { usageCount: { increment: 1 } } });
        await this.audit.record(
          {
            action: 'ASSIGNMENT_CREATED',
            ...auditBase(actor),
            targetType: 'assignment',
            targetId: a.id,
            details: { title: a.title, templateBoardId: input.templateBoardId, classId: input.classId, students: students.length },
          },
          tx,
        );
        return a;
      },
      { timeout: 60_000 },
    );
    return this.get(user, created.id);
  }

  async update(user: AssignmentUser, id: string, input: UpdateAssignmentRequest): Promise<AssignmentDetails> {
    const a = await this.own(user, id);
    const closedChanged = input.closed !== undefined && input.closed !== !!a.closedAt;
    await this.prisma.assignment.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(closedChanged ? { closedAt: input.closed ? new Date() : null } : {}),
      },
    });
    if (closedChanged || input.title !== undefined || input.instructions !== undefined || input.dueAt !== undefined) {
      await this.notifyAll(id);
    }
    return this.get(user, id);
  }

  /** Удаление задания: работы учеников удаляются вместе с ним. */
  async delete(user: AssignmentUser, id: string): Promise<void> {
    await this.own(user, id);
    const works = await this.prisma.assignmentWork.findMany({ where: { assignmentId: id }, select: { boardId: true } });
    const boardIds = works.map((w) => w.boardId);
    await this.prisma.$transaction(async (tx) => {
      await tx.board.updateMany({ where: { id: { in: boardIds } }, data: { deletedAt: new Date() } });
      await tx.assignment.delete({ where: { id } });
    });
    for (const boardId of boardIds) this.events.emit('board.deleted', { boardId });
  }

  async addStudents(user: AssignmentUser, id: string, input: { studentIds: string[]; fromClass: boolean }): Promise<AssignmentDetails> {
    const a = await this.own(user, id);
    const direct = [...new Set(input.studentIds)];
    await this.assertStudents(direct);
    const fromClass = input.fromClass && a.classId ? await this.missingClassStudents(a.id, a.classId) : [];
    const existing = new Set(
      (await this.prisma.assignmentWork.findMany({ where: { assignmentId: id }, select: { studentId: true } })).map((w) => w.studentId),
    );
    const students = [...new Set([...fromClass, ...direct])].filter((s) => !existing.has(s));
    if (existing.size + students.length > MAX_WORKS) throw Errors.validation({ studentIds: [`Не больше ${MAX_WORKS} учеников в одном задании`] });
    if (students.length) {
      const template = await this.prisma.board.findUnique({ where: { id: a.templateBoardId }, select: { id: true, ownerId: true } });
      if (!template) throw Errors.conflict('Исходная доска задания удалена');
      const state = await this.readState(template.id, template.ownerId);
      await this.prisma.$transaction((tx) => this.createWorks(tx, a, students, state), { timeout: 60_000 });
    }
    return this.get(user, id);
  }

  // ------------------------------------------------------------------
  //  Работы: сдача и проверка
  // ------------------------------------------------------------------

  private async work(id: string) {
    const w = await this.prisma.assignmentWork.findFirst({
      where: { id, board: { deletedAt: null } },
      include: { assignment: { select: { teacherId: true, closedAt: true } } },
    });
    if (!w) throw Errors.notFound('Работа не найдена');
    return w;
  }

  private async setStatus(
    id: string,
    from: AssignmentWorkStatus[],
    data: Prisma.AssignmentWorkUpdateManyMutationInput & { status: AssignmentWorkStatus },
  ): Promise<void> {
    const r = await this.prisma.assignmentWork.updateMany({ where: { id, status: { in: from } }, data });
    if (r.count === 0) throw Errors.conflict('Статус работы уже изменился — обновите страницу');
  }

  async submit(user: AssignmentUser, id: string): Promise<void> {
    const w = await this.work(id);
    if (w.studentId !== user.id) throw Errors.notFound('Работа не найдена');
    if (w.assignment.closedAt) throw Errors.conflict('Задание закрыто');
    await this.setStatus(id, ['NOT_STARTED', 'IN_PROGRESS'], { status: 'SUBMITTED', submittedAt: new Date() });
    this.events.emit('assignment.worksChanged', { boardIds: [w.boardId] });
  }

  /** Ученик отменяет сдачу (пока учитель не проверил). */
  async unsubmit(user: AssignmentUser, id: string): Promise<void> {
    const w = await this.work(id);
    if (w.studentId !== user.id) throw Errors.notFound('Работа не найдена');
    if (w.assignment.closedAt) throw Errors.conflict('Задание закрыто');
    await this.setStatus(id, ['SUBMITTED'], { status: 'IN_PROGRESS', submittedAt: null });
    this.events.emit('assignment.worksChanged', { boardIds: [w.boardId] });
  }

  private async teacherWork(user: AssignmentUser, id: string) {
    this.requireTeacher(user);
    const w = await this.work(id);
    if (w.assignment.teacherId !== user.id) throw Errors.notFound('Работа не найдена');
    return w;
  }

  /** Учитель отмечает работу проверенной (с отметкой или без). */
  async review(user: AssignmentUser, id: string, grade: string | null): Promise<void> {
    const w = await this.teacherWork(user, id);
    await this.setStatus(id, ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED'], {
      status: 'REVIEWED',
      reviewedAt: new Date(),
      grade: grade || null,
    });
    this.events.emit('assignment.worksChanged', { boardIds: [w.boardId] });
  }

  /** Вернуть работу на доработку: ученик снова может её менять. */
  async returnWork(user: AssignmentUser, id: string): Promise<void> {
    const w = await this.teacherWork(user, id);
    await this.setStatus(id, ['SUBMITTED', 'REVIEWED'], { status: 'IN_PROGRESS', submittedAt: null, reviewedAt: null });
    this.events.emit('assignment.worksChanged', { boardIds: [w.boardId] });
  }

  private async notifyAll(assignmentId: string): Promise<void> {
    const works = await this.prisma.assignmentWork.findMany({ where: { assignmentId }, select: { boardId: true } });
    if (works.length) this.events.emit('assignment.worksChanged', { boardIds: works.map((w) => w.boardId) });
  }

  // ------------------------------------------------------------------
  //  Ученик
  // ------------------------------------------------------------------

  async mine(user: AssignmentUser): Promise<StudentAssignment[]> {
    if (user.role !== 'STUDENT') throw Errors.forbidden('Список заданий ученика');
    const works = await this.prisma.assignmentWork.findMany({
      where: { studentId: user.id, board: { deletedAt: null } },
      include: { assignment: { include: { teacher: { select: { id: true, fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return works.map((w) => ({
      id: w.assignment.id,
      title: w.assignment.title,
      instructions: w.assignment.instructions,
      teacher: w.assignment.teacher,
      dueAt: w.assignment.dueAt?.toISOString() ?? null,
      closed: !!w.assignment.closedAt,
      createdAt: w.assignment.createdAt.toISOString(),
      work: {
        id: w.id,
        boardId: w.boardId,
        status: w.status,
        submittedAt: w.submittedAt?.toISOString() ?? null,
        reviewedAt: w.reviewedAt?.toISOString() ?? null,
        grade: w.grade,
      },
    }));
  }
}
