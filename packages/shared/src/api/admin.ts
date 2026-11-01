import { z } from 'zod';
import { USER_ROLES, type UserRole } from '../enums.js';
import { loginFieldSchema } from './auth.js';
import type { Credential } from './csv.js';

/**
 * Схемы API панели администратора (/api/admin/*).
 */

// ---------------------------------------------------------------------
//  Общие
// ---------------------------------------------------------------------

const intFromQuery = (def: number, min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : Number(v)),
    z.number().int().min(min).max(max),
  );

export const paginationQuerySchema = z.object({
  page: intFromQuery(1, 1, 100_000),
  pageSize: intFromQuery(25, 1, 100),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const fullNameSchema = z
  .string({ required_error: 'Укажите ФИО' })
  .trim()
  .min(2, 'Укажите ФИО')
  .max(200, 'Слишком длинное ФИО')
  .transform((s) => s.replace(/\s+/g, ' '));

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB');

const uuid = z.string().uuid('Неверный идентификатор');

/** Учебный год «2026/2027». */
export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, 'Учебный год в формате 2026/2027')
  .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, 'Годы должны идти подряд');

/** Палитра цветов пользователей (курсоры, подписи) — различимые на светлом и тёмном фоне. */
export const USER_COLORS = [
  '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0284c7',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#65a30d', '#9333ea',
] as const;

// ---------------------------------------------------------------------
//  Пользователи
// ---------------------------------------------------------------------

export const USER_STATUS_FILTERS = ['active', 'blocked', 'pending', 'all'] as const;
export const USER_SORTS = ['fullName', 'login', 'createdAt', 'lastLoginAt'] as const;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  classId: uuid.optional(),
  /** без класса (удобно, чтобы найти нераспределённых учеников) */
  noClass: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  status: z.enum(USER_STATUS_FILTERS).default('all'),
  sort: z.enum(USER_SORTS).default('fullName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  /** Если не указан — генерируется из ФИО (ivanov.ps, ivanov.ps2…). */
  login: loginFieldSchema.optional(),
  role: z.enum(USER_ROLES),
  classIds: z.array(uuid).max(50).default([]),
  color: colorSchema.optional(),
});
export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    login: loginFieldSchema.optional(),
    role: z.enum(USER_ROLES).optional(),
    /** Полный новый список классов пользователя (заменяет текущий). */
    classIds: z.array(uuid).max(50).optional(),
    color: colorSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нет изменений');
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const blockUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** Удаление требует повторить логин — защита от случайного клика. */
export const deleteUserSchema = z.object({
  confirmLogin: z.string().trim().toLowerCase(),
});

export interface AdminUserClass {
  id: string;
  name: string;
  academicYear: string | null;
  role: 'STUDENT' | 'TEACHER';
}

export interface AdminUser {
  id: string;
  login: string;
  fullName: string;
  role: UserRole;
  color: string;
  isBlocked: boolean;
  blockedReason: string | null;
  /** Временная блокировка после неудачных входов (до этого момента). */
  lockedUntil: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  classes: AdminUserClass[];
}

export interface CreateUserResponse {
  user: AdminUser;
  credential: Credential;
}

export interface ResetPasswordResponse {
  credential: Credential;
}

// ---------------------------------------------------------------------
//  Импорт CSV
// ---------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 1000;

export const importUsersSchema = z.object({
  /** Текст CSV (файл читается на клиенте). */
  csv: z.string().min(1, 'Файл пуст').max(1_000_000, 'Файл слишком большой (максимум 1 МБ)'),
  /** Роль для строк, где роль не указана. */
  defaultRole: z.enum(['STUDENT', 'TEACHER']).default('STUDENT'),
  /** Добавить всех импортированных в этот класс. */
  classId: uuid.optional(),
  /** Создавать классы, указанные в файле, если их нет. */
  createMissingClasses: z.boolean().default(false),
  /** Учебный год для поиска/создания классов из файла. */
  academicYear: academicYearSchema.optional(),
  /** Только проверить и показать результат, ничего не создавая. */
  dryRun: z.boolean().default(false),
});
export type ImportUsersRequest = z.infer<typeof importUsersSchema>;

export interface ImportRowPreview {
  /** Номер строки в файле (с 1, с учётом заголовка). */
  line: number;
  fullName: string;
  login: string;
  loginGenerated: boolean;
  role: UserRole;
  className: string | null;
  /** Класс будет создан. */
  newClass: boolean;
}

export interface ImportRowError {
  line: number;
  messages: string[];
}

export interface ImportUsersResponse {
  dryRun: boolean;
  rows: ImportRowPreview[];
  errors: ImportRowError[];
  /** Заполняется только при реальном импорте. */
  credentials: Credential[];
  createdClasses: string[];
}

/** Распознавание роли из ячейки CSV. */
export function parseRoleCell(value: string): UserRole | null | undefined {
  const v = value.trim().toLowerCase().replace(/ё/g, 'е');
  if (!v) return undefined;
  if (['ученик', 'ученица', 'student', 'студент', 'студентка', 's'].includes(v)) return 'STUDENT';
  if (['учитель', 'преподаватель', 'teacher', 'педагог', 't'].includes(v)) return 'TEACHER';
  if (['администратор', 'админ', 'admin', 'a'].includes(v)) return 'ADMIN';
  return null;
}

export type ImportColumn = 'fullName' | 'login' | 'role' | 'className';

/**
 * Определение колонок по заголовку. Если первая строка не похожа на
 * заголовок — порядок по умолчанию: ФИО; логин; роль; класс.
 */
export function detectImportColumns(firstRow: readonly string[]): { header: boolean; columns: (ImportColumn | null)[] } {
  const norm = firstRow.map((c) => c.trim().toLowerCase().replace(/ё/g, 'е'));
  const map = (c: string): ImportColumn | null => {
    if (/^(фио|ф\.и\.о\.?|имя|full ?name|name)$/.test(c)) return 'fullName';
    if (/^(логин|login|username|user)$/.test(c)) return 'login';
    if (/^(роль|role)$/.test(c)) return 'role';
    if (/^(класс|группа|class|group|класс\/группа)$/.test(c)) return 'className';
    return null;
  };
  const mapped = norm.map(map);
  if (mapped.includes('fullName')) return { header: true, columns: mapped };
  return { header: false, columns: ['fullName', 'login', 'role', 'className'] };
}

// ---------------------------------------------------------------------
//  Классы
// ---------------------------------------------------------------------

export const listClassesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  academicYear: academicYearSchema.optional(),
  includeArchived: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).default(false),
});

export const createClassSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(100),
  description: z.string().trim().max(1000).optional(),
  academicYear: academicYearSchema.optional(),
});

export const updateClassSchema = z
  .object({
    name: z.string().trim().min(1, 'Укажите название').max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    academicYear: academicYearSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нет изменений');

export const classMembersSchema = z.object({
  userIds: z.array(uuid).min(1, 'Выберите пользователей').max(1000),
});

export const deleteClassSchema = z.object({
  confirmName: z.string().trim(),
});

export const resetClassPasswordsSchema = z.object({
  /** Только тем, кто ещё не сменил временный пароль (например, потерял листок). */
  onlyPending: z.boolean().default(false),
});

export interface ClassSummary {
  id: string;
  name: string;
  description: string | null;
  academicYear: string | null;
  archived: boolean;
  studentCount: number;
  teachers: { id: string; fullName: string }[];
  createdAt: string;
}

export interface ClassMemberInfo {
  id: string;
  login: string;
  fullName: string;
  role: UserRole;
  isBlocked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface ClassDetails extends ClassSummary {
  students: ClassMemberInfo[];
  teacherMembers: ClassMemberInfo[];
}

// ---------------------------------------------------------------------
//  Журнал действий
// ---------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT', 'TOKEN_REUSE_DETECTED',
  'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_CREATED', 'USER_IMPORTED', 'USER_UPDATED',
  'USER_BLOCKED', 'USER_UNBLOCKED', 'USER_DELETED', 'CLASS_CREATED', 'CLASS_UPDATED',
  'CLASS_DELETED', 'CLASS_MEMBERS_CHANGED', 'BOARD_CREATED', 'BOARD_DELETED',
  'BOARD_ACCESS_CHANGED', 'BOARD_MODE_CHANGED', 'BOARD_VERSION_RESTORED', 'BOARD_CLEARED',
  'ASSIGNMENT_CREATED', 'TEMPLATE_SHARED',
] as const;
export type AuditActionName = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditActionName, string> = {
  LOGIN_SUCCESS: 'Вход',
  LOGIN_FAILED: 'Неудачный вход',
  LOGIN_BLOCKED: 'Вход заблокирован',
  LOGOUT: 'Выход',
  TOKEN_REUSE_DETECTED: 'Повтор токена (возможна кража сессии)',
  PASSWORD_CHANGED: 'Смена пароля',
  PASSWORD_RESET: 'Сброс пароля',
  USER_CREATED: 'Создание пользователя',
  USER_IMPORTED: 'Импорт пользователей',
  USER_UPDATED: 'Изменение пользователя',
  USER_BLOCKED: 'Блокировка пользователя',
  USER_UNBLOCKED: 'Разблокировка пользователя',
  USER_DELETED: 'Удаление пользователя',
  CLASS_CREATED: 'Создание класса',
  CLASS_UPDATED: 'Изменение класса',
  CLASS_DELETED: 'Удаление класса',
  CLASS_MEMBERS_CHANGED: 'Изменение состава класса',
  BOARD_CREATED: 'Создание доски',
  BOARD_DELETED: 'Удаление доски',
  BOARD_ACCESS_CHANGED: 'Изменение доступа к доске',
  BOARD_MODE_CHANGED: 'Смена режима доски',
  BOARD_VERSION_RESTORED: 'Восстановление версии доски',
  BOARD_CLEARED: 'Очистка доски',
  ASSIGNMENT_CREATED: 'Выдача задания',
  TEMPLATE_SHARED: 'Публикация шаблона',
};

/** Группы для фильтра журнала. */
export const AUDIT_ACTION_GROUPS: Record<string, AuditActionName[]> = {
  Входы: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT', 'TOKEN_REUSE_DETECTED'],
  Аккаунты: ['USER_CREATED', 'USER_IMPORTED', 'USER_UPDATED', 'USER_BLOCKED', 'USER_UNBLOCKED', 'USER_DELETED', 'PASSWORD_CHANGED', 'PASSWORD_RESET'],
  Классы: ['CLASS_CREATED', 'CLASS_UPDATED', 'CLASS_DELETED', 'CLASS_MEMBERS_CHANGED'],
};

export const listAuditQuerySchema = paginationQuerySchema.extend({
  actions: z
    .preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.enum(AUDIT_ACTIONS)).max(30))
    .optional(),
  actorId: uuid.optional(),
  targetId: z.string().max(64).optional(),
  /** Поиск по логину/ФИО автора. */
  search: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export interface AuditEntryView {
  id: string;
  action: AuditActionName;
  createdAt: string;
  actor: { id: string; login: string; fullName: string } | null;
  actorLogin: string | null;
  targetType: string | null;
  targetId: string | null;
  /** Название цели (ФИО пользователя, имя класса), если удалось определить. */
  targetLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  details: unknown;
}

export interface AdminStats {
  users: { total: number; admins: number; teachers: number; students: number; blocked: number; pendingPassword: number };
  classes: number;
  loginsToday: number;
  failedLoginsToday: number;
}
