import { z } from 'zod';
import { isValidOrderKey } from './fractional-index.js';
import { jsonValueSchema, type JsonValue } from './json.js';

/**
 * Модель объекта доски.
 *
 * Каждый объект в Yjs-документе — это Y.Map в корневой карте `objects`
 * (ключ — id объекта). Значения полей Y.Map — только JSON (никаких
 * вложенных Y-типов), поэтому любое изменение затрагивает ровно два уровня:
 * objects → объект → поле. Это делает серверную проверку прав простой и
 * надёжной (см. docs/SYNC_PROTOCOL.md, раздел «Проверка обновлений»).
 *
 * Поля делятся на:
 *  - базовые (одинаковые для всех типов; их понимает ядро: выделение,
 *    трансформации, слои, блокировка, авторство);
 *  - `props` — свойства, специфичные для типа, их схему задаёт модуль
 *    объекта (плагин). props записывается целиком (last-writer-wins).
 */

/**
 * Имя типа объекта: пространство имён плагина + имя,
 * например "core.stroke", "math.planimetry.segment", "physics.optics.lens".
 */
export const OBJECT_TYPE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,5}$/;

/** id объектов и страниц: 21 символ алфавита nanoid. */
export const ENTITY_ID_RE = /^[A-Za-z0-9_-]{8,36}$/;

/**
 * Слой объекта.
 *  - background — подложка (PDF-страница, условие задачи); управляет учитель;
 *  - content — обычное содержимое;
 *  - review — пометки учителя в работе ученика (ученик их не меняет).
 */
export const OBJECT_LAYERS = ['background', 'content', 'review'] as const;
export type ObjectLayer = (typeof OBJECT_LAYERS)[number];

export interface BoardObject<P = Record<string, JsonValue>> {
  /** Уникальный id (nanoid). Совпадает с ключом в карте objects. */
  id: string;
  /** Тип объекта (определяет модуль-плагин). */
  type: string;
  /** Версия схемы props этого типа (для миграций при обновлении плагина). */
  v: number;
  /** Страница, на которой лежит объект. */
  pageId: string;
  /** Порядок отрисовки внутри слоя: дробный индекс (fractional-index.ts). */
  z: string;
  layer: ObjectLayer;
  /** Трансформация: мировые координаты начала локальной системы объекта. */
  x: number;
  y: number;
  /** Поворот в радианах по часовой стрелке. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Заблокирован учителем: нельзя сдвинуть, изменить, стереть. */
  locked: boolean;
  hidden: boolean;
  /** id объекта-группы (тип core.group) или null. */
  groupId: string | null;
  /**
   * Объекты, от которых зависит этот (динамическая геометрия: перпендикуляр
   * зависит от точки и прямой; изображение в линзе — от предмета и линзы).
   * Ядро строит по ним граф зависимостей для пересчёта и предупреждения
   * при удалении.
   */
  deps: string[];
  /** Автор (id пользователя) и время создания, мс UNIX. Неизменяемы. */
  createdBy: string;
  createdAt: number;
  /** Последний изменивший и время изменения. */
  updatedBy: string;
  updatedAt: number;
  /** Свойства, специфичные для типа. */
  props: P;
}

export type SerializedBoardObject = BoardObject<Record<string, JsonValue>>;

/** Список базовых полей (всё, кроме них, в Y.Map объекта запрещено). */
export const BASE_OBJECT_FIELDS = [
  'id',
  'type',
  'v',
  'pageId',
  'z',
  'layer',
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'locked',
  'hidden',
  'groupId',
  'deps',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'props',
] as const satisfies readonly (keyof BoardObject)[];
export type BaseObjectField = (typeof BASE_OBJECT_FIELDS)[number];

const BASE_FIELD_SET: ReadonlySet<string> = new Set(BASE_OBJECT_FIELDS);
export function isKnownObjectField(field: string): field is BaseObjectField {
  return BASE_FIELD_SET.has(field);
}

/** Поля, которые нельзя изменить после создания. */
export const IMMUTABLE_OBJECT_FIELDS: ReadonlySet<BaseObjectField> = new Set([
  'id',
  'type',
  'createdBy',
  'createdAt',
]);

/** Поля, которые меняет только учитель (владелец/соведущий) доски. */
export const TEACHER_ONLY_OBJECT_FIELDS: ReadonlySet<BaseObjectField> = new Set(['locked', 'layer']);

/** Ограничения размеров (защита от злоупотреблений; проверяются сервером). */
export const LIMITS = {
  /** Максимальный размер props одного объекта (сериализованный JSON). */
  maxPropsBytes: 512 * 1024,
  /** Максимальное число объектов на доске. */
  maxObjectsPerBoard: 50_000,
  /** Максимальное число страниц. */
  maxPagesPerBoard: 300,
  /** Максимум зависимостей у одного объекта. */
  maxDeps: 64,
  /** Максимальная координата по модулю (бесконечный холст, но конечные числа). */
  maxCoordinate: 1e9,
  /** Максимальный размер одного входящего WebSocket-сообщения. */
  maxMessageBytes: 4 * 1024 * 1024,
  /** Максимальный размер состояния awareness одного клиента. */
  maxAwarenessBytes: 64 * 1024,
} as const;

const coordinate = z.number().finite().min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);
const scale = z.number().finite().refine((s) => Math.abs(s) >= 1e-4 && Math.abs(s) <= 1e4, {
  message: 'Недопустимый масштаб',
});
const entityId = z.string().regex(ENTITY_ID_RE);
const userId = z.string().uuid();
const timestamp = z.number().int().nonnegative();

/** Схема значения каждого базового поля (для проверки отдельных изменений). */
export const objectFieldSchemas: { [K in BaseObjectField]: z.ZodTypeAny } = {
  id: entityId,
  type: z.string().regex(OBJECT_TYPE_RE),
  v: z.number().int().min(1).max(10_000),
  pageId: entityId,
  z: z.string().min(2).max(128).refine(isValidOrderKey, { message: 'Неверный ключ порядка' }),
  layer: z.enum(OBJECT_LAYERS),
  x: coordinate,
  y: coordinate,
  rotation: z.number().finite(),
  scaleX: scale,
  scaleY: scale,
  locked: z.boolean(),
  hidden: z.boolean(),
  groupId: entityId.nullable(),
  deps: z.array(entityId).max(LIMITS.maxDeps),
  createdBy: userId,
  createdAt: timestamp,
  updatedBy: userId,
  updatedAt: timestamp,
  props: z.record(jsonValueSchema),
};

export const boardObjectSchema = z
  .object(objectFieldSchemas as { [K in BaseObjectField]: z.ZodTypeAny })
  .strict() as unknown as z.ZodType<SerializedBoardObject>;

/** Значения базовых полей по умолчанию для нового объекта. */
export function createObjectBase(params: {
  id: string;
  type: string;
  pageId: string;
  z: string;
  userId: string;
  now: number;
  v?: number;
  layer?: ObjectLayer;
  x?: number;
  y?: number;
}): Omit<SerializedBoardObject, 'props'> {
  return {
    id: params.id,
    type: params.type,
    v: params.v ?? 1,
    pageId: params.pageId,
    z: params.z,
    layer: params.layer ?? 'content',
    x: params.x ?? 0,
    y: params.y ?? 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    hidden: false,
    groupId: null,
    deps: [],
    createdBy: params.userId,
    createdAt: params.now,
    updatedBy: params.userId,
    updatedAt: params.now,
  };
}

/** Частичное изменение объекта (то, что возвращают обработчики ручек и инспектор). */
export type ObjectPatch<P = Record<string, JsonValue>> = Partial<
  Omit<BoardObject<P>, 'id' | 'type' | 'createdBy' | 'createdAt' | 'props'>
> & { props?: Partial<P> };

const ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/**
 * Новый id объекта/страницы: 21 случайный символ (как nanoid), ~126 бит.
 * Использует crypto.getRandomValues — доступен и в браузере, и в Node.js 22.
 */
export function newEntityId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  for (let i = 0; i < size; i++) id += ID_ALPHABET[bytes[i]! & 63];
  return id;
}
