import { z } from 'zod';
import { ENTITY_ID_RE } from './object.js';
import { isValidOrderKey } from './fractional-index.js';

/**
 * Структура Yjs-документа доски (один Y.Doc на доску, все страницы внутри).
 *
 *   Y.Doc
 *   ├── meta    : Y.Map<string, Json>             — версия формата, дата создания
 *   ├── pages   : Y.Map<pageId, Y.Map<field, Json>> — страницы (вкладки внизу)
 *   └── objects : Y.Map<objectId, Y.Map<field, Json>> — все объекты всех страниц
 *
 * Объекты хранятся плоско (а не внутри страниц): так любой путь в документе
 * имеет глубину не более 2, а перенос объекта на другую страницу — это
 * изменение одного поля pageId. Клиент поддерживает индекс pageId → объекты.
 */
export const DOC_ROOTS = {
  meta: 'meta',
  pages: 'pages',
  objects: 'objects',
} as const;
export type DocRootName = (typeof DOC_ROOTS)[keyof typeof DOC_ROOTS];

export const ALLOWED_DOC_ROOTS: ReadonlySet<string> = new Set(Object.values(DOC_ROOTS));

/** Текущая версия формата документа (meta.schemaVersion). */
export const DOC_SCHEMA_VERSION = 1;

/** Фоны страницы. */
export const BACKGROUND_KINDS = [
  'blank',
  'grid',
  'ruled',
  'dots',
  'millimeter',
  'polar',
  'isometric',
] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

export const BACKGROUND_LABELS: Record<BackgroundKind, string> = {
  blank: 'Чистый',
  grid: 'Клетка',
  ruled: 'Линейка',
  dots: 'Точки',
  millimeter: 'Миллиметровка',
  polar: 'Полярная сетка',
  isometric: 'Изометрическая сетка',
};

/**
 * Поверхность страницы. 'chalk' — режим «меловая доска» (тёмно-зелёный фон);
 * 'auto' — следует теме пользователя (светлая/тёмная).
 */
export const SURFACES = ['auto', 'chalk'] as const;
export type Surface = (typeof SURFACES)[number];

export const backgroundSchema = z.object({
  kind: z.enum(BACKGROUND_KINDS),
  /** Шаг сетки в мировых единицах (клетка 5 мм ≈ 20 ед.). */
  step: z.number().finite().min(4).max(400),
  surface: z.enum(SURFACES),
  /** Для полярной сетки — центр. */
  originX: z.number().finite(),
  originY: z.number().finite(),
  /**
   * Страница PDF как фон: файл (Asset), номер страницы (с 1) и размер в
   * мировых единицах; левый верхний угол — в начале координат страницы.
   */
  pdf: z
    .object({
      assetId: z.string().uuid(),
      page: z.number().int().min(1).max(10_000),
      width: z.number().finite().positive().max(1e6),
      height: z.number().finite().positive().max(1e6),
    })
    .nullable()
    .optional(),
});

/** Мировых единиц в типографском пункте PDF: клетка 5 мм = 20 ед., 1 пт = 25,4/72 мм. */
export const PDF_POINT_TO_WORLD = (20 / 5) * (25.4 / 72);
export type Background = z.infer<typeof backgroundSchema>;

export const DEFAULT_BACKGROUND: Background = {
  kind: 'grid',
  step: 20,
  surface: 'auto',
  originX: 0,
  originY: 0,
};

export const pageSchema = z
  .object({
    id: z.string().regex(ENTITY_ID_RE),
    title: z.string().max(100),
    /** Порядок вкладок: дробный индекс. */
    order: z.string().refine(isValidOrderKey, { message: 'Неверный ключ порядка' }),
    background: backgroundSchema,
    /**
     * Фон и объекты слоя background заблокированы: менять их может только
     * учитель (условие задачи нельзя сдвинуть или стереть).
     */
    backgroundLocked: z.boolean(),
    createdBy: z.string().uuid(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type PageRecord = z.infer<typeof pageSchema>;

export const PAGE_FIELDS = Object.keys(pageSchema.shape) as (keyof PageRecord)[];

export const metaSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type DocMeta = z.infer<typeof metaSchema>;
