import { z } from 'zod';

/**
 * Библиотека шаблонов (/api/templates). Шаблон — доска kind = TEMPLATE с
 * описанием: раздел, уровень, теги, видимость. Встроенные шаблоны
 * поставляются с приложением; свои учитель сохраняет из любой видимой ему
 * доски. Из шаблона создаётся доска урока (копия) или выдаётся задание.
 */

const uuid = z.string().uuid('Неверный идентификатор');

export const TEMPLATE_LEVELS = ['SCHOOL', 'OLYMPIAD', 'UNIVERSITY'] as const;
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];
export const TEMPLATE_LEVEL_LABELS: Record<TemplateLevel, string> = { SCHOOL: 'Школа', OLYMPIAD: 'Олимпиада', UNIVERSITY: 'Вуз' };

export const TEMPLATE_VISIBILITIES = ['BUILTIN', 'PRIVATE', 'TEACHERS', 'SELECTED'] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];
export const TEMPLATE_VISIBILITY_LABELS: Record<TemplateVisibility, string> = {
  BUILTIN: 'Встроенный',
  PRIVATE: 'Только мне',
  TEACHERS: 'Всем учителям',
  SELECTED: 'Выбранным учителям',
};
/** Видимость, которую выбирает автор (встроенные создаются только приложением). */
export const userVisibilitySchema = z.enum(['PRIVATE', 'TEACHERS', 'SELECTED']);

/** Раздел: «math», «math.planimetry», «physics.mechanics», «other». */
const sectionSchema = z
  .string()
  .trim()
  .min(1, 'Выберите раздел')
  .max(120)
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, 'Неверный раздел');

const tagsSchema = z.array(z.string().trim().min(1).max(40, 'Тег не длиннее 40 символов')).max(10, 'Не больше 10 тегов');

export const templateTitleSchema = z.string({ required_error: 'Укажите название' }).trim().min(1, 'Укажите название').max(300, 'Слишком длинное название');
const descriptionSchema = z.string().trim().max(2000, 'Слишком длинное описание');

export const createTemplateSchema = z
  .object({
    /** Доска, из которой делается шаблон (её текущее содержимое копируется). */
    boardId: uuid,
    title: templateTitleSchema,
    description: descriptionSchema.optional(),
    section: sectionSchema,
    level: z.enum(TEMPLATE_LEVELS).default('SCHOOL'),
    tags: tagsSchema.default([]),
    visibility: userVisibilitySchema.default('PRIVATE'),
    /** Для SELECTED — учителя, которым виден шаблон. */
    shareUserIds: z.array(uuid).max(200).default([]),
  })
  .refine((v) => v.visibility !== 'SELECTED' || v.shareUserIds.length > 0, { message: 'Выберите учителей', path: ['shareUserIds'] });
export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    title: templateTitleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    section: sectionSchema.optional(),
    level: z.enum(TEMPLATE_LEVELS).optional(),
    tags: tagsSchema.optional(),
    visibility: userVisibilitySchema.optional(),
    shareUserIds: z.array(uuid).max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нет изменений')
  .refine((v) => v.visibility !== 'SELECTED' || v.shareUserIds === undefined || v.shareUserIds.length > 0, { message: 'Выберите учителей', path: ['shareUserIds'] });
export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;

export const TEMPLATE_SCOPES = ['all', 'mine', 'builtin', 'shared'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const listTemplatesQuerySchema = z.object({
  scope: z.enum(TEMPLATE_SCOPES).default('all'),
  /** Раздел или его начало: «physics» — вся физика. */
  section: z.string().trim().max(120).optional(),
  level: z.enum(TEMPLATE_LEVELS).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(48),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

/** Создать доску урока из шаблона. */
export const useTemplateSchema = z.object({
  title: templateTitleSchema.optional(),
  folderId: uuid.nullable().default(null),
});
export type UseTemplateRequest = z.infer<typeof useTemplateSchema>;

export interface TemplateSummary {
  id: string;
  title: string;
  description: string | null;
  section: string;
  level: TemplateLevel;
  tags: string[];
  visibility: TemplateVisibility;
  author: { id: string; fullName: string } | null;
  /** Доска шаблона: открыть, миниатюра, выдать заданием. */
  boardId: string;
  usageCount: number;
  /** Шаблон текущего пользователя — можно менять и удалять. */
  mine: boolean;
  /** Для SELECTED у своего шаблона — кому виден. */
  sharedWith: { id: string; fullName: string }[];
  /** Для миниатюры (меняется при изменении доски). */
  boardActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Разделы библиотеки: группы и разделы-плагины досок (названия — как у
 * плагинов; соответствие проверяет тест frontend/src/templates/builtin.test.ts).
 * Список статический, чтобы страница библиотеки не загружала код разделов.
 */
export const TEMPLATE_SECTIONS: { id: string; title: string; group?: boolean }[] = [
  { id: 'math', title: 'Математика', group: true },
  { id: 'math.planimetry', title: 'Планиметрия' },
  { id: 'math.stereo', title: 'Стереометрия' },
  { id: 'math.analysis', title: 'Графики и анализ' },
  { id: 'math.analytic', title: 'Аналитическая геометрия' },
  { id: 'math.linalg', title: 'Линейная алгебра' },
  { id: 'math.multivar', title: 'Функции нескольких переменных' },
  { id: 'math.diffeq', title: 'Дифференциальные уравнения' },
  { id: 'math.complex', title: 'Комплексные числа' },
  { id: 'math.prob', title: 'Вероятность и статистика' },
  { id: 'math.discrete', title: 'Дискретная математика' },
  { id: 'physics', title: 'Физика', group: true },
  { id: 'physics.common', title: 'Физика: общее' },
  { id: 'physics.mechanics', title: 'Механика' },
  { id: 'physics.electricity', title: 'Электричество' },
  { id: 'physics.magnetism', title: 'Магнетизм' },
  { id: 'physics.waves', title: 'Колебания и волны' },
  { id: 'physics.modern', title: 'Современная физика' },
  { id: 'other', title: 'Другое', group: true },
];

export const sectionTitle = (id: string) => TEMPLATE_SECTIONS.find((s) => s.id === id)?.title ?? id;
