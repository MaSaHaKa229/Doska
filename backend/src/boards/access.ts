import type { Board, PrismaClient, UserRole } from '@prisma/client';
import {
  computeCapabilities,
  parseBoardSettings,
  type BoardAccessFacts,
  type BoardCapabilities,
} from '@doska/shared';

export interface BoardAccess {
  board: Board;
  facts: BoardAccessFacts;
  caps: BoardCapabilities;
}

/**
 * Сбор фактов о доступе пользователя к доске из БД и вычисление прав
 * общей функцией computeCapabilities (той же, что использует клиент).
 * Возвращает null, если доски нет или она удалена.
 *
 * Используется и REST-маршрутами, и сервером реального времени — правила
 * доступа описаны в одном месте.
 */
export async function loadBoardAccess(
  prisma: PrismaClient,
  user: { id: string; role: UserRole },
  boardId: string,
): Promise<BoardAccess | null> {
  const board = await prisma.board.findFirst({ where: { id: boardId, deletedAt: null } });
  if (!board) return null;

  const [member, viaClass, chalk, work, teachesOwner, template] = await Promise.all([
    prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: user.id } } }),
    user.role === 'STUDENT'
      ? prisma.boardClassAccess.findFirst({
          where: {
            boardId,
            class: { archivedAt: null, members: { some: { userId: user.id, role: 'STUDENT' } } },
          },
          select: { classId: true },
        })
      : null,
    prisma.chalkGrant.findUnique({ where: { boardId_userId: { boardId, userId: user.id } } }),
    board.kind === 'ASSIGNMENT_WORK'
      ? prisma.assignmentWork.findUnique({
          where: { boardId },
          select: { studentId: true, status: true, assignment: { select: { closedAt: true } } },
        })
      : null,
    board.kind === 'NOTEBOOK' && user.role === 'TEACHER'
      ? prisma.class.findFirst({
          where: {
            archivedAt: null,
            AND: [
              { members: { some: { userId: user.id, role: 'TEACHER' } } },
              { members: { some: { userId: board.ownerId, role: 'STUDENT' } } },
            ],
          },
          select: { id: true },
        })
      : null,
    board.kind === 'TEMPLATE' && user.role === 'TEACHER'
      ? prisma.template.findUnique({
          where: { boardId },
          select: { visibility: true, shares: { where: { userId: user.id }, select: { userId: true } } },
        })
      : null,
  ]);

  const templateVisible = template
    ? template.visibility === 'BUILTIN' || template.visibility === 'TEACHERS' || template.shares.length > 0
    : false;

  const facts: BoardAccessFacts = {
    user: { id: user.id, role: user.role },
    board: {
      kind: board.kind,
      mode: board.mode,
      ownerId: board.ownerId,
      settings: parseBoardSettings(board.settings),
      sharedWithTeachers: board.sharedWithTeachers,
    },
    memberRole: member?.role ?? null,
    studentViaClass: !!viaClass,
    teachesOwner: !!teachesOwner,
    hasChalk: !!chalk,
    assignment: work
      ? { studentId: work.studentId, closed: !!work.assignment.closedAt, submitted: work.status === 'SUBMITTED' || work.status === 'REVIEWED' }
      : undefined,
    templateVisible,
  };
  return { board, facts, caps: computeCapabilities(facts) };
}

/** id учителей доски (владелец и соведущие) — их объекты защищены от учеников. */
export async function loadModeratorIds(prisma: PrismaClient, boardId: string): Promise<Set<string>> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true, kind: true, members: { where: { role: 'CO_TEACHER' }, select: { userId: true } } },
  });
  if (!board) return new Set();
  return new Set([board.ownerId, ...board.members.map((m) => m.userId)]);
}
