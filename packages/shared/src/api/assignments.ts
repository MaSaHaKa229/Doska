import { z } from 'zod';
import type { AssignmentWorkStatus } from '../enums.js';

/**
 * Задания: учитель раздаёт копии доски ученикам (/api/assignments,
 * /api/works). Каждая копия — отдельная доска kind = ASSIGNMENT_WORK,
 * принадлежащая учителю; ученик пишет в ней, учитель проверяет и оставляет
 * пометки в слое review.
 */

const uuid = z.string().uuid('Неверный идентификатор');

export const assignmentTitleSchema = z
  .string({ required_error: 'Укажите название' })
  .trim()
  .min(1, 'Укажите название')
  .max(300, 'Слишком длинное название');

const instructionsSchema = z.string().trim().max(5000, 'Слишком длинное описание');
/** Срок сдачи: ISO-дата со временем или null. */
const dueAtSchema = z.string().datetime({ offset: true, message: 'Неверная дата' }).nullable();

export const createAssignmentSchema = z
  .object({
    title: assignmentTitleSchema,
    instructions: instructionsSchema.optional(),
    /** Доска, копии которой получат ученики (своя или где вы соведущий). */
    templateBoardId: uuid,
    /** Класс: работу получат все его ученики. */
    classId: uuid.nullable().default(null),
    /** Отдельные ученики (в дополнение к классу). */
    studentIds: z.array(uuid).max(500).default([]),
    dueAt: dueAtSchema.optional(),
  })
  .refine((v) => v.classId !== null || v.studentIds.length > 0, { message: 'Выберите класс или учеников', path: ['classId'] });
export type CreateAssignmentRequest = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z
  .object({
    title: assignmentTitleSchema.optional(),
    instructions: instructionsSchema.nullable().optional(),
    dueAt: dueAtSchema.optional(),
    /** true — закрыть приём работ (ученики больше не могут их менять). */
    closed: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нет изменений');
export type UpdateAssignmentRequest = z.infer<typeof updateAssignmentSchema>;

/** Выдать задание ещё ученикам: отдельным или всем новым ученикам класса задания. */
export const addAssignmentStudentsSchema = z
  .object({
    studentIds: z.array(uuid).max(500).default([]),
    fromClass: z.boolean().default(false),
  })
  .refine((v) => v.fromClass || v.studentIds.length > 0, 'Выберите учеников');

export const reviewWorkSchema = z.object({
  /** Отметка (оценка или «зачтено»), необязательна. */
  grade: z.string().trim().max(20, 'Не длиннее 20 символов').nullable().default(null),
});

export type WorkCounts = Record<AssignmentWorkStatus, number>;

export interface AssignmentSummary {
  id: string;
  title: string;
  instructions: string | null;
  templateBoardId: string;
  class: { id: string; name: string } | null;
  dueAt: string | null;
  closedAt: string | null;
  createdAt: string;
  total: number;
  counts: WorkCounts;
}

export interface AssignmentWorkView {
  id: string;
  boardId: string;
  student: { id: string; fullName: string };
  status: AssignmentWorkStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  grade: string | null;
  updatedAt: string;
  lastActivityAt: string;
}

export interface AssignmentDetails extends AssignmentSummary {
  works: AssignmentWorkView[];
  /** Ученики класса задания, которым работа ещё не выдана (пришли в класс позже). */
  missingClassStudents: number;
}

/** Задание глазами ученика (главная страница). */
export interface StudentAssignment {
  id: string;
  title: string;
  instructions: string | null;
  teacher: { id: string; fullName: string };
  dueAt: string | null;
  closed: boolean;
  createdAt: string;
  work: { id: string; boardId: string; status: AssignmentWorkStatus; submittedAt: string | null; reviewedAt: string | null; grade: string | null };
}

/** Сведения о задании на странице доски-работы (ученику и учителю). */
export interface BoardWorkInfo {
  workId: string;
  assignmentId: string;
  assignmentTitle: string;
  instructions: string | null;
  dueAt: string | null;
  closed: boolean;
  student: { id: string; fullName: string };
  status: AssignmentWorkStatus;
  grade: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export const WORK_STATUS_LABELS: Record<AssignmentWorkStatus, string> = {
  NOT_STARTED: 'Не начата',
  IN_PROGRESS: 'В работе',
  SUBMITTED: 'Сдана',
  REVIEWED: 'Проверена',
};
