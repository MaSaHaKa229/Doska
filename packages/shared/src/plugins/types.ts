import type { z } from 'zod';
import type { Point, Rect } from '../board/geometry.js';
import type { BoardObject, ObjectPatch } from '../board/object.js';
import type { JsonValue } from '../board/json.js';

/**
 * Интерфейсы системы плагинов.
 *
 * Плагин — это раздел (например, «Физика → Оптика»), который приносит:
 *  - модули объектов (ObjectModule) — как объект выглядит и ведёт себя;
 *  - инструменты (ToolModule) — как объект создаётся мышью/стилусом;
 *  - команды для палитры Ctrl+K, шаблоны, статьи справочника, воркеры.
 *
 * Ядро доски (холст, выделение, трансформации, привязки, undo/redo,
 * синхронизация, экспорт) работает только через эти интерфейсы и ничего не
 * знает о конкретных разделах. Новый раздел = новая папка с файлом
 * plugin.ts; ядро и сервер не меняются (docs/PLUGINS.md).
 *
 * Типы рендеринга параметризованы (R — то, что возвращает render; на
 * фронтенде это React-узел react-konva), чтобы пакет shared не зависел от
 * React/Konva и мог использоваться сервером и тестами.
 */

// ---------------------------------------------------------------------
//  Контексты
// ---------------------------------------------------------------------

export type Theme = 'light' | 'dark' | 'chalk';

/** Доступ к другим объектам и результатам вычислений (для зависимых объектов). */
export interface ResolveContext {
  getObject(id: string): BoardObject | undefined;
  /**
   * Результат фонового вычисления объекта (силовые линии, решение ОДУ, ход
   * лучей), посчитанный в Web Worker; undefined, пока не готов.
   */
  getComputed<T = unknown>(objectId: string): T | undefined;
  /** Текущий масштаб камеры (для толщины ручек, уровня детализации). */
  zoom: number;
  theme: Theme;
}

export interface RenderContext extends ResolveContext {
  /** Объект выделен / наведён — для подсветки. */
  selected: boolean;
  hovered: boolean;
  /** Видимая область в мировых координатах (виртуализация, LOD). */
  viewport: Rect;
  /** Перевод семантических цветов ('ink', 'accent-1'…) в hex для текущей темы. */
  resolveColor(color: string): string;
}

// ---------------------------------------------------------------------
//  Ручки и привязки
// ---------------------------------------------------------------------

export type HandleKind =
  /** Перемещаемая определяющая точка (вершина многоугольника, конец вектора). */
  | 'point'
  /** Параметр (угол наклонной плоскости, фокус линзы) — двигается вдоль направляющей. */
  | 'param'
  /** Стандартные ручки рамки трансформации — их рисует ядро, если не отключены. */
  | 'resize'
  | 'rotate';

export interface Handle {
  id: string;
  kind: HandleKind;
  /** Положение в мировых координатах. */
  position: Point;
  /** Подсказка при наведении («Фокус F», «Угол α»). */
  label?: string;
  cursor?: string;
  /** Применять ли привязки при перетаскивании этой ручки. */
  snap?: boolean;
}

export type SnapPointKind = 'endpoint' | 'midpoint' | 'center' | 'vertex' | 'quadrant' | 'intersection' | 'anchor';

export interface SnapPoint {
  kind: SnapPointKind;
  point: Point;
  /** Для привязок к точкам динамической геометрии — id точки (создаёт зависимость). */
  refId?: string;
}

/** Кривые для поиска пересечений (пересечения считает ядро). */
export type SnapCurve =
  | { kind: 'segment'; a: Point; b: Point }
  | { kind: 'ray'; origin: Point; direction: Point }
  | { kind: 'line'; point: Point; direction: Point }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'arc'; center: Point; radius: number; startAngle: number; endAngle: number }
  | { kind: 'polyline'; points: Point[]; closed: boolean };

export interface PointerModifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

// ---------------------------------------------------------------------
//  Инспектор (контекстная панель свойств сверху)
// ---------------------------------------------------------------------

export type InspectorField =
  | { kind: 'color'; key: string; label: string }
  | { kind: 'stroke-width'; key: string; label: string }
  | { kind: 'line-style'; key: string; label: string }
  | { kind: 'text'; key: string; label: string; maxLength?: number }
  | { kind: 'latex'; key: string; label: string }
  | {
      kind: 'number';
      key: string;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      /** Показывать как слайдер (параметры a, b, c функций; угол α). */
      slider?: boolean;
    }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] };

// ---------------------------------------------------------------------
//  Модуль объекта
// ---------------------------------------------------------------------

/**
 * Описание типа объекта. Каждый тип объекта — модуль с методами render,
 * hitTest, serialize, getHandles (+ необязательные возможности).
 */
export interface ObjectModule<P = Record<string, JsonValue>, R = unknown> {
  /** Полное имя типа: "<id плагина>.<имя>", например "physics.optics.lens". */
  type: string;
  /** Название для интерфейса: «Собирающая линза». */
  title: string;
  /** Текущая версия схемы props. */
  version: number;
  /** zod-схема props (проверяется на клиенте при загрузке и при изменении). */
  propsSchema: z.ZodType<P>;
  /** props нового объекта по умолчанию. */
  createProps(): P;
  /** Миграция props старой версии к текущей (если version увеличивалась). */
  migrate?(props: Record<string, JsonValue>, fromVersion: number): P;

  /** Преобразование объекта в JSON для Yjs и обратно (по умолчанию — как есть). */
  serialize(obj: BoardObject<P>): BoardObject<Record<string, JsonValue>>;
  deserialize(raw: BoardObject<Record<string, JsonValue>>): BoardObject<P>;

  /** Габарит в ЛОКАЛЬНЫХ координатах объекта (до x/y/rotation/scale). */
  getLocalBounds(obj: BoardObject<P>, ctx: ResolveContext): Rect;
  /**
   * Попадание мировой точки в объект с допуском tolerance (мировые единицы).
   * Ядро сначала отсекает кандидатов по габариту через пространственный индекс.
   */
  hitTest(obj: BoardObject<P>, point: Point, tolerance: number, ctx: ResolveContext): boolean;
  /** Пересечение с прямоугольником выделения (по умолчанию — по габариту). */
  hitTestRect?(obj: BoardObject<P>, rect: Rect, mode: 'contain' | 'intersect', ctx: ResolveContext): boolean;

  /** Ручки объекта в мировых координатах. */
  getHandles(obj: BoardObject<P>, ctx: ResolveContext): Handle[];
  /** Перетаскивание ручки → изменение объекта (null — изменений нет). */
  dragHandle?(
    obj: BoardObject<P>,
    handleId: string,
    to: Point,
    modifiers: PointerModifiers,
    ctx: ResolveContext,
  ): ObjectPatch<P> | null;

  /** Точки привязки (концы, середины, центры…) в мировых координатах. */
  getSnapPoints?(obj: BoardObject<P>, ctx: ResolveContext): SnapPoint[];
  /** Кривые для вычисления пересечений с другими объектами. */
  getSnapCurves?(obj: BoardObject<P>, ctx: ResolveContext): SnapCurve[];

  /** Отрисовка. */
  render(obj: BoardObject<P>, ctx: RenderContext): R;
  /** Векторный экспорт (SVG-фрагмент в мировых координатах). */
  toSVG?(obj: BoardObject<P>, ctx: RenderContext): string;

  /** Поля контекстной панели свойств. */
  inspector?: InspectorField[];
  /** Поведение рамки трансформации. */
  transform?: {
    rotatable: boolean;
    resize: 'free' | 'proportional' | 'none';
  };
  /** Имя редактора, открываемого двойным кликом ('formula', 'text', 'matrix'…). */
  editor?: string;
  /**
   * Тяжёлое вычисление в Web Worker: имя задания и входные данные.
   * Ядро перезапускает задание при изменении входа (с отменой старого).
   */
  compute?: {
    job: string;
    input(obj: BoardObject<P>, ctx: ResolveContext): JsonValue;
  };
}

// ---------------------------------------------------------------------
//  Инструменты
// ---------------------------------------------------------------------

export const TOOL_GROUPS = ['select', 'draw', 'shapes', 'formulas', 'math', 'physics', 'media'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  select: 'Выделение',
  draw: 'Рисование',
  shapes: 'Фигуры',
  formulas: 'Формулы',
  math: 'Математика',
  physics: 'Физика',
  media: 'Медиа',
};

/** Событие указателя, приведённое ядром к мировым координатам. */
export interface ToolPointerEvent {
  world: Point;
  /** Нажатие стилуса 0..1 (мышь — 0.5). */
  pressure: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  modifiers: PointerModifiers;
  /** Точка после применения привязок (если инструмент их запрашивает). */
  snapped: Point;
  snap: SnapPoint | null;
  timeStamp: number;
}

/**
 * API ядра, доступное инструменту. Все изменения документа идут через него —
 * ядро оборачивает их в транзакции Yjs (одна транзакция = один шаг undo),
 * проставляет автора/время и проверяет права заранее.
 */
export interface ToolContext {
  readonly userId: string;
  readonly pageId: string;
  readonly canWrite: boolean;
  resolve: ResolveContext;
  createObject<P>(type: string, init: { x: number; y: number; props: P; deps?: string[] }): string;
  updateObject<P>(id: string, patch: ObjectPatch<P>): void;
  deleteObjects(ids: string[]): void;
  /** Транзакция: несколько изменений = один шаг отмены. */
  transact(fn: () => void): void;
  hitTest(point: Point, tolerance: number): BoardObject[];
  setSelection(ids: string[]): void;
  /** Предпросмотр (рисуется в оверлее и транслируется в awareness.drawing). */
  setPreview(preview: unknown | null): void;
  /** Переключиться на другой инструмент (например, обратно на выделение). */
  activateTool(id: string): void;
  /** Значения панели свойств инструмента (цвет, толщина). */
  getToolOptions<T>(): T;
}

export interface ToolModule<R = unknown> {
  /** id: "<id плагина>.<имя>", например "physics.optics.lens-tool". */
  id: string;
  title: string;
  /** Имя иконки lucide-react ('Pen', 'Circle', 'Magnet') или ключ встроенной иконки. */
  icon: string;
  group: ToolGroup;
  /** Подраздел для подменю «Математика»/«Физика», например "physics.optics". */
  section?: string;
  /** Горячая клавиша ('P', 'Shift+L'); конфликты ловит реестр. */
  hotkey?: string;
  /** Ключевые слова для палитры Ctrl+K («линза», «собирающая», «оптика»). */
  keywords: string[];
  /** Инструмент изменяет документ (неактивен без права записи). */
  requiresWrite: boolean;
  /** Нужно ли ядру вычислять привязки для событий. */
  snapping?: boolean;
  cursor?: string;
  /** Опции инструмента в панели свойств. */
  options?: InspectorField[];
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
  /** true — клавиша обработана инструментом. */
  onKeyDown?(key: string, modifiers: PointerModifiers, ctx: ToolContext): boolean;
  /** Оверлей инструмента (предпросмотр, направляющие). */
  renderOverlay?(ctx: ToolContext): R;
}

// ---------------------------------------------------------------------
//  Команды, шаблоны, справочник
// ---------------------------------------------------------------------

export interface CommandDescriptor {
  id: string;
  title: string;
  keywords: string[];
  section?: string;
  hotkey?: string;
  /** Что делает команда: активирует инструмент, вставляет объект/шаблон, вызывает действие. */
  action:
    | { kind: 'tool'; toolId: string }
    | { kind: 'insert'; objectType: string; props?: Record<string, JsonValue> }
    | { kind: 'template'; templateKey: string }
    | { kind: 'custom'; run: () => void };
}

export interface TemplateDescriptor {
  /** Стабильный ключ, например "physics.mechanics.incline". */
  key: string;
  title: string;
  section: string;
  level: 'SCHOOL' | 'OLYMPIAD' | 'UNIVERSITY';
  tags: string[];
  /** Ленивая загрузка содержимого (объекты одной или нескольких страниц). */
  load(): Promise<{ pages: { title: string; objects: BoardObject[] }[] }>;
}

export interface ReferenceEntry {
  id: string;
  section: string;
  title: string;
  latex: string;
  description?: string;
  keywords: string[];
}

// ---------------------------------------------------------------------
//  Плагин
// ---------------------------------------------------------------------

export type WorkerFactory = () => { postMessage(data: unknown): void; terminate(): void };

export interface BoardPlugin<R = unknown> {
  /** Пространство имён: "core", "math.planimetry", "physics.optics". */
  id: string;
  title: string;
  /** Плагины, которые должны быть зарегистрированы раньше (общие объекты). */
  dependsOn?: string[];
  objects?: ObjectModule<any, R>[];
  tools?: ToolModule<R>[];
  commands?: CommandDescriptor[];
  templates?: TemplateDescriptor[];
  references?: ReferenceEntry[];
  /** Обработчики заданий Web Worker: имя задания → фабрика воркера. */
  workers?: Record<string, WorkerFactory>;
}
