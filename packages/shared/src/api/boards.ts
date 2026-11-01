import { z } from 'zod';
import { BOARD_KINDS, BOARD_MODES, type BoardKind, type BoardMode, type BoardMemberRole } from '../enums.js';
import { boardSettingsSchema, type BoardSettings } from '../board/settings.js';
import { paginationQuerySchema } from './admin.js';
import type { BoardCapabilities } from '../permissions/capabilities.js';

/**
 * Схемы API досок и папок (/api/boards, /api/folders).
 */

const uuid = z.string().uuid('Неверный идентификатор');

export const boardTitleSchema = z
  .string({ required_error: 'Укажите название' })
  .trim()
  .min(1, 'Укажите название')
  .max(300, 'Слишком длинное название');

export const createBoardSchema = z.object({
  title: boardTitleSchema,
  description: z.string().trim().max(2000).optional(),
  folderId: uuid.nullable().optional(),
  mode: z.enum(BOARD_MODES).default('LECTURE'),
  /** Доступ классам и отдельным ученикам сразу при создании. */
  classIds: z.array(uuid).max(50).default([]),
  studentIds: z.array(uuid).max(500).default([]),
});
export type CreateBoardRequest = z.infer<typeof createBoardSchema>;

export const updateBoardSchema = z
  .object({
    title: boardTitleSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    folderId: uuid.nullable().optional(),
    settings: boardSettingsSchema.partial().optional(),
    /** Для конспекта ученика: показывать учителям. */
    sharedWithTeachers: z.boolean().optional(),
    /** Режим доски урока (учитель). То же делает команда mode.set по WebSocket. */
    mode: z.enum(BOARD_MODES).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нет изменений');
export type UpdateBoardRequest = z.infer<typeof updateBoardSchema>;

export const BOARD_SORTS = ['lastActivityAt', 'title', 'createdAt'] as const;

export const listBoardsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  /** Папка; 'root' — доски вне папок; не задано — все доски. */
  folderId: z.union([uuid, z.literal('root')]).optional(),
  /**
   * Чьи доски: 'own' — созданные мной (учитель; ученик — его конспекты),
   * 'shared' — к которым мне дали доступ, 'all' — и то и другое.
   */
  scope: z.enum(['own', 'shared', 'all']).default('all'),
  kind: z.enum(BOARD_KINDS).optional(),
  sort: z.enum(BOARD_SORTS).default('lastActivityAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListBoardsQuery = z.infer<typeof listBoardsQuerySchema>;

export const boardMemberInputSchema = z.object({
  userId: uuid,
  role: z.enum(['CO_TEACHER', 'STUDENT', 'VIEWER']),
});

/** Полная замена списка доступа к доске. */
export const setBoardAccessSchema = z.object({
  classIds: z.array(uuid).max(50),
  members: z.array(boardMemberInputSchema).max(1000),
});
export type SetBoardAccessRequest = z.infer<typeof setBoardAccessSchema>;

/** Поиск людей для выдачи доступа к доске (учитель). */
export const directoryQuerySchema = z.object({
  role: z.enum(['STUDENT', 'TEACHER']),
  search: z.string().trim().max(100).default(''),
  /** Только ученики этого класса (из классов учителя). */
  classId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

export interface DirectoryUser {
  id: string;
  fullName: string;
  login: string;
  role: 'STUDENT' | 'TEACHER';
  /** Действующие классы пользователя (для различения однофамильцев). */
  classes: string[];
}

export const folderNameSchema = z.string().trim().min(1, 'Укажите название папки').max(200);

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: uuid.nullable().optional(),
});

export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: uuid.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, 'Нет изменений');

export interface FolderView {
  id: string;
  name: string;
  parentId: string | null;
  boardCount: number;
  createdAt: string;
}

export interface BoardSummary {
  id: string;
  kind: BoardKind;
  title: string;
  description: string | null;
  mode: BoardMode;
  owner: { id: string; fullName: string };
  folderId: string | null;
  /** URL миниатюры (presigned) или null. */
  thumbnailUrl: string | null;
  objectCount: number;
  pageCount: number;
  lastActivityAt: string;
  createdAt: string;
  /** Моя роль на доске. */
  role: BoardCapabilities['role'];
  /** Кому выдана доска (для списка учителя). */
  classes: { id: string; name: string }[];
  studentCount: number;
}

export interface BoardAccessView {
  classes: { id: string; name: string; academicYear: string | null }[];
  members: { userId: string; fullName: string; login: string; role: BoardMemberRole }[];
}

export interface BoardDetails extends BoardSummary {
  settings: BoardSettings;
  sharedWithTeachers: boolean;
  capabilities: BoardCapabilities;
  access: BoardAccessView | null;
}
