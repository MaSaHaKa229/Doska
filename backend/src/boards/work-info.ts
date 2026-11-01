import type { PrismaClient } from '@prisma/client';
import type { BoardWorkInfo } from '@doska/shared';

/** Сведения о работе по заданию для доски kind = ASSIGNMENT_WORK (или null). */
export async function loadWorkInfo(prisma: PrismaClient, boardId: string): Promise<BoardWorkInfo | null> {
  const w = await prisma.assignmentWork.findUnique({
    where: { boardId },
    include: {
      student: { select: { id: true, fullName: true } },
      assignment: { select: { id: true, title: true, instructions: true, dueAt: true, closedAt: true } },
    },
  });
  if (!w) return null;
  return {
    workId: w.id,
    assignmentId: w.assignment.id,
    assignmentTitle: w.assignment.title,
    instructions: w.assignment.instructions,
    dueAt: w.assignment.dueAt?.toISOString() ?? null,
    closed: !!w.assignment.closedAt,
    student: w.student,
    status: w.status,
    grade: w.grade,
    submittedAt: w.submittedAt?.toISOString() ?? null,
    reviewedAt: w.reviewedAt?.toISOString() ?? null,
  };
}
