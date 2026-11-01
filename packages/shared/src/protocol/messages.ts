import { z } from 'zod';
import { BOARD_KINDS, BOARD_MODES, USER_ROLES } from '../enums.js';
import { boardSettingsSchema } from '../board/settings.js';
import { ENTITY_ID_RE } from '../board/object.js';

/**
 * Протокол реального времени (WebSocket /ws/boards/:boardId).
 * Подробное описание — docs/SYNC_PROTOCOL.md.
 *
 * Все кадры бинарные. Первый varuint кадра — тип сообщения:
 *   0   — Yjs sync (y-protocols/sync: step1, step2, update)
 *   1   — Yjs awareness (y-protocols/awareness)
 *   3   — запрос awareness (queryAwareness)
 *   100 — управляющее сообщение: varString с JSON, схема ниже
 * Типы 0, 1, 3 совместимы с y-websocket, поэтому клиент использует
 * стандартные функции y-protocols; 100 — расширение приложения.
 */

export const PROTOCOL_VERSION = 1;

export const MessageType = {
  Sync: 0,
  Awareness: 1,
  QueryAwareness: 3,
  Control: 100,
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Коды закрытия WebSocket (4000–4999 — коды приложения). */
export const CloseCode = {
  /** Нет/истёк access-токен → клиент обновляет токен и переподключается. */
  Unauthenticated: 4401,
  /** Нет доступа к доске (или доступ отозван во время сессии). */
  Forbidden: 4403,
  NotFound: 4404,
  /** Версия протокола клиента не поддерживается → перезагрузить страницу. */
  ProtocolMismatch: 4426,
  /** Пользователь заблокирован/удалён администратором. */
  AccountDisabled: 4423,
  /** Пользователь обязан сменить временный пароль. */
  PasswordChangeRequired: 4428,
  MessageTooLarge: 4413,
  /** Нарушение протокола (битый кадр, недопустимая структура обновления). */
  ProtocolViolation: 4400,
  RateLimited: 4429,
  /** Тот же клиент открыл доску в другой вкладке с тем же sessionId. */
  Superseded: 4409,
  /** Сервер перезапускается — переподключиться. */
  ServerRestart: 4503,
  Internal: 4500,
} as const;
export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode];

/** Коды, после которых клиент НЕ переподключается автоматически. */
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCode.Forbidden,
  CloseCode.NotFound,
  CloseCode.ProtocolMismatch,
  CloseCode.AccountDisabled,
  CloseCode.PasswordChangeRequired,
  CloseCode.Superseded,
]);

// ---------------------------------------------------------------------
//  Общие фрагменты
// ---------------------------------------------------------------------

const entityId = z.string().regex(ENTITY_ID_RE);
const userId = z.string().uuid();
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);

/** Вид (камера) пользователя на доске. */
export const viewportSchema = z.object({
  pageId: entityId,
  /** Мировая точка в центре экрана. */
  centerX: finite,
  centerY: finite,
  zoom: z.number().finite().min(0.01).max(100),
});
export type Viewport = z.infer<typeof viewportSchema>;

/** Камера 3D-сцены (объект math.stereo.scene и др.). */
export const scene3dCameraSchema = z.object({
  objectId: entityId,
  position: vec3,
  target: vec3,
  up: vec3,
  zoom: z.number().finite().positive(),
});
export type Scene3dCamera = z.infer<typeof scene3dCameraSchema>;

export const followStateSchema = z.object({
  leaderId: userId,
  leaderName: z.string(),
  viewport: viewportSchema,
  scenes: z.array(scene3dCameraSchema).max(16),
  /** true — ученики не могут временно «отойти» от вида учителя. */
  strict: z.boolean(),
});
export type FollowState = z.infer<typeof followStateSchema>;

export const raisedHandSchema = z.object({
  userId,
  fullName: z.string(),
  at: z.number().int(),
});
export type RaisedHand = z.infer<typeof raisedHandSchema>;

export const participantUserSchema = z.object({
  id: userId,
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type ParticipantUser = z.infer<typeof participantUserSchema>;

export const capabilitiesSchema = z.object({
  role: z.enum(['owner', 'teacher', 'student', 'viewer', 'none']),
  view: z.boolean(),
  write: z.boolean(),
  noWriteReason: z.enum(['lecture-mode', 'no-chalk', 'read-only', 'assignment-closed', 'no-access']).nullable(),
  moderate: z.boolean(),
  manageLesson: z.boolean(),
  managePages: z.boolean(),
  editOthers: z.boolean(),
  editTeacherObjects: z.boolean(),
  laser: z.boolean(),
  leadFollow: z.boolean(),
  clearStudentObjects: z.boolean(),
  restoreVersions: z.boolean(),
  raiseHand: z.boolean(),
});

// ---------------------------------------------------------------------
//  Клиент → сервер
// ---------------------------------------------------------------------

export const clientControlSchema = z.discriminatedUnion('t', [
  /** Первое сообщение после открытия сокета. */
  z.object({
    t: z.literal('hello'),
    protocol: z.number().int(),
    /** Случайный id вкладки: повторное подключение той же вкладки вытесняет старое. */
    sessionId: z.string().min(8).max(64),
    /** Yjs clientID документа клиента (сервер связывает его с пользователем). */
    yClientId: z.number().int().nonnegative(),
  }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
  /** Переключить режим доски (учитель). */
  z.object({ t: z.literal('mode.set'), mode: z.enum(BOARD_MODES) }),
  /** Дать/забрать мел (учитель). */
  z.object({ t: z.literal('chalk.set'), userId, granted: z.boolean() }),
  z.object({ t: z.literal('chalk.revokeAll') }),
  /** «Следуйте за мной» (учитель). */
  z.object({ t: z.literal('follow.start'), viewport: viewportSchema, strict: z.boolean() }),
  z.object({
    t: z.literal('follow.update'),
    viewport: viewportSchema,
    scenes: z.array(scene3dCameraSchema).max(16),
  }),
  z.object({ t: z.literal('follow.stop') }),
  /** Поднять/опустить руку (ученик), снять руку ученику (учитель). */
  z.object({ t: z.literal('hand.raise') }),
  z.object({ t: z.literal('hand.lower') }),
  z.object({ t: z.literal('hand.dismiss'), userId }),
  /**
   * Очистка следов учеников (учитель). authors: 'students' — все не-учительские
   * объекты; либо список id учеников. pageId — только эта страница.
   */
  z.object({
    t: z.literal('objects.clearByAuthors'),
    authors: z.union([z.literal('students'), z.array(userId).min(1).max(500)]),
    pageId: entityId.nullable(),
  }),
  /** Изменение настроек доски (учитель). */
  z.object({ t: z.literal('settings.set'), settings: boardSettingsSchema.partial() }),
]);
export type ClientControlMessage = z.infer<typeof clientControlSchema>;

// ---------------------------------------------------------------------
//  Сервер → клиент
// ---------------------------------------------------------------------

export const NOTICE_CODES = [
  /** Часть изменений отменена сервером (подробности — reason). */
  'CHANGE_REVERTED',
  /** Изменился режим доски / права. */
  'RIGHTS_CHANGED',
  /** Учитель снял руку. */
  'HAND_DISMISSED',
  /** Учитель очистил объекты. */
  'BOARD_CLEARED',
  /** Учитель восстановил версию. */
  'VERSION_RESTORED',
  /** Слишком частые сообщения. */
  'SLOW_DOWN',
] as const;

export const serverControlSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('session.init'),
    protocol: z.number().int(),
    serverTime: z.number(),
    user: participantUserSchema,
    board: z.object({
      id: z.string().uuid(),
      title: z.string(),
      kind: z.enum(BOARD_KINDS),
      mode: z.enum(BOARD_MODES),
      ownerId: userId,
      settings: boardSettingsSchema,
    }),
    capabilities: capabilitiesSchema,
    chalkHolders: z.array(userId),
    hands: z.array(raisedHandSchema),
    follow: followStateSchema.nullable(),
  }),
  z.object({ t: z.literal('pong'), ts: z.number(), serverTime: z.number() }),
  z.object({ t: z.literal('capabilities'), capabilities: capabilitiesSchema }),
  z.object({ t: z.literal('mode.changed'), mode: z.enum(BOARD_MODES), by: userId }),
  z.object({ t: z.literal('chalk.changed'), holders: z.array(userId) }),
  z.object({ t: z.literal('follow.state'), state: followStateSchema.nullable() }),
  z.object({ t: z.literal('hands'), hands: z.array(raisedHandSchema) }),
  z.object({ t: z.literal('settings.changed'), settings: boardSettingsSchema }),
  z.object({
    t: z.literal('notice'),
    level: z.enum(['info', 'warning', 'error']),
    code: z.enum(NOTICE_CODES),
    message: z.string(),
    reason: z.string().optional(),
    objectIds: z.array(z.string()).max(1000).optional(),
  }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ServerControlMessage = z.infer<typeof serverControlSchema>;

// ---------------------------------------------------------------------
//  Awareness (присутствие)
// ---------------------------------------------------------------------

/**
 * Состояние awareness, которое публикует клиент. Сервер проверяет его этой
 * схемой, ограничивает размер, удаляет laser/drawing при отсутствии прав и
 * ПОДМЕНЯЕТ поле user данными из сессии (имя и цвет нельзя подделать).
 *
 * Массивы точек плоские: [x0, y0, a0, x1, y1, a1, ...], где a — нажатие
 * стилуса (drawing) или время в мс от начала следа (laser).
 */
export const awarenessStateSchema = z.object({
  user: participantUserSchema.optional(),
  cursor: z.object({ pageId: entityId, x: finite, y: finite }).nullable(),
  /** id выделенных объектов (рамки выделения других пользователей). */
  selection: z.array(entityId).max(1000),
  /** Текущий инструмент (для подписи у курсора). */
  tool: z.string().max(80).nullable(),
  /** Объект, который пользователь редактирует сейчас (мягкая блокировка). */
  editing: entityId.nullable(),
  viewport: viewportSchema.nullable(),
  laser: z
    .object({ pageId: entityId, points: z.array(finite).max(3 * 400) })
    .nullable(),
  /** Незавершённый штрих: другие видят линию во время рисования. */
  drawing: z
    .object({
      pageId: entityId,
      tool: z.string().max(80),
      color: z.string().max(32),
      width: z.number().finite().positive().max(500),
      opacity: z.number().finite().min(0).max(1),
      points: z.array(finite).max(3 * 4000),
    })
    .nullable(),
});
export type AwarenessState = z.infer<typeof awarenessStateSchema>;

export const EMPTY_AWARENESS: AwarenessState = {
  cursor: null,
  selection: [],
  tool: null,
  editing: null,
  viewport: null,
  laser: null,
  drawing: null,
};
