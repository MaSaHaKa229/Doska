/**
 * Перечисления, общие для фронтенда и бэкенда.
 * Значения совпадают с enum-ами Prisma (backend/prisma/schema.prisma);
 * соответствие проверяется тестом enums.test.ts.
 */

export const USER_ROLES = ['ADMIN', 'TEACHER', 'STUDENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BOARD_KINDS = ['LESSON', 'NOTEBOOK', 'ASSIGNMENT_WORK', 'TEMPLATE'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const BOARD_MODES = ['LECTURE', 'COLLABORATIVE', 'SELECTIVE'] as const;
export type BoardMode = (typeof BOARD_MODES)[number];

export const BOARD_MEMBER_ROLES = ['CO_TEACHER', 'STUDENT', 'VIEWER'] as const;
export type BoardMemberRole = (typeof BOARD_MEMBER_ROLES)[number];

export const ASSIGNMENT_WORK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED'] as const;
export type AssignmentWorkStatus = (typeof ASSIGNMENT_WORK_STATUSES)[number];

export const EDUCATION_LEVELS = ['SCHOOL', 'OLYMPIAD', 'UNIVERSITY'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Человекочитаемые подписи для интерфейса. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Администратор',
  TEACHER: 'Учитель',
  STUDENT: 'Ученик',
};

export const BOARD_MODE_LABELS: Record<BoardMode, string> = {
  LECTURE: 'Лекция',
  COLLABORATIVE: 'Совместная работа',
  SELECTIVE: 'Выборочно',
};

export const BOARD_KIND_LABELS: Record<BoardKind, string> = {
  LESSON: 'Доска урока',
  NOTEBOOK: 'Конспект',
  ASSIGNMENT_WORK: 'Работа по заданию',
  TEMPLATE: 'Шаблон',
};
