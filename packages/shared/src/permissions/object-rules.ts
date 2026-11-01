import type { BoardCapabilities } from './capabilities.js';
import {
  IMMUTABLE_OBJECT_FIELDS,
  TEACHER_ONLY_OBJECT_FIELDS,
  isKnownObjectField,
  type ObjectLayer,
} from '../board/object.js';
import type { PageRecord } from '../board/doc-layout.js';

/**
 * Правила на уровне отдельных объектов и страниц.
 * Сервер применяет их к каждому изменению из Yjs-обновления; клиент — до
 * изменения, чтобы не создавать заведомо отклоняемых правок.
 */

/** Минимум сведений об объекте, нужный для проверки прав. */
export interface ObjectGuardInfo {
  createdBy: string;
  locked: boolean;
  layer: ObjectLayer;
  pageId: string;
  /** Автор объекта — учитель доски (владелец или соведущий). */
  authorIsModerator: boolean;
}

/** Код причины отказа — уходит клиенту в сообщении notice. */
export type DenyReason =
  | 'NO_WRITE'
  | 'IMMUTABLE_FIELD'
  | 'UNKNOWN_FIELD'
  | 'TEACHER_ONLY'
  | 'LOCKED'
  | 'BACKGROUND_LOCKED'
  | 'REVIEW_LAYER'
  | 'NOT_OWNER'
  | 'AUTHOR_MISMATCH'
  | 'PAGE_NOT_FOUND'
  | 'NO_PAGE_RIGHTS'
  | 'INVALID_VALUE'
  | 'LIMIT_EXCEEDED';

export type Decision = { ok: true } | { ok: false; reason: DenyReason };

const OK: Decision = { ok: true };
const deny = (reason: DenyReason): Decision => ({ ok: false, reason });

export const DENY_MESSAGES: Record<DenyReason, string> = {
  NO_WRITE: 'Нет права записи на этой доске',
  IMMUTABLE_FIELD: 'Это свойство объекта нельзя изменить',
  UNKNOWN_FIELD: 'Недопустимое поле объекта',
  TEACHER_ONLY: 'Это может изменить только учитель',
  LOCKED: 'Объект заблокирован учителем',
  BACKGROUND_LOCKED: 'Фон страницы заблокирован учителем',
  REVIEW_LAYER: 'Пометки учителя нельзя изменять',
  NOT_OWNER: 'Можно изменять только свои объекты',
  AUTHOR_MISMATCH: 'Неверный автор объекта',
  PAGE_NOT_FOUND: 'Страница не найдена',
  NO_PAGE_RIGHTS: 'Нет права управлять страницами',
  INVALID_VALUE: 'Недопустимое значение',
  LIMIT_EXCEEDED: 'Превышен допустимый размер',
};

/** Можно ли создать объект с данными базовыми полями. */
export function canCreateObject(
  caps: BoardCapabilities,
  userId: string,
  obj: ObjectGuardInfo,
  page: Pick<PageRecord, 'backgroundLocked'> | undefined,
): Decision {
  if (!caps.write) return deny('NO_WRITE');
  if (!page) return deny('PAGE_NOT_FOUND');
  if (obj.createdBy !== userId) return deny('AUTHOR_MISMATCH');
  if (!caps.moderate) {
    if (obj.locked) return deny('TEACHER_ONLY');
    if (obj.layer === 'review') return deny('REVIEW_LAYER');
    if (obj.layer === 'background') return deny(page.backgroundLocked ? 'BACKGROUND_LOCKED' : 'TEACHER_ONLY');
  }
  return OK;
}

/** Общая проверка «можно ли трогать существующий объект». */
function canTouch(caps: BoardCapabilities, userId: string, obj: ObjectGuardInfo, page: Pick<PageRecord, 'backgroundLocked'> | undefined): Decision {
  if (!caps.write) return deny('NO_WRITE');
  if (caps.moderate) return OK;
  if (obj.locked) return deny('LOCKED');
  if (obj.layer === 'review') return deny('REVIEW_LAYER');
  if (obj.layer === 'background' && (page?.backgroundLocked ?? true)) return deny('BACKGROUND_LOCKED');
  if (obj.createdBy === userId) return OK;
  if (obj.authorIsModerator) return caps.editTeacherObjects ? OK : deny('TEACHER_ONLY');
  return caps.editOthers ? OK : deny('NOT_OWNER');
}

/** Можно ли изменить поле field существующего объекта. */
export function canUpdateObjectField(
  caps: BoardCapabilities,
  userId: string,
  obj: ObjectGuardInfo,
  field: string,
  page: Pick<PageRecord, 'backgroundLocked'> | undefined,
): Decision {
  if (!isKnownObjectField(field)) return deny('UNKNOWN_FIELD');
  if (IMMUTABLE_OBJECT_FIELDS.has(field)) return deny('IMMUTABLE_FIELD');
  const touch = canTouch(caps, userId, obj, page);
  if (!touch.ok) return touch;
  if (TEACHER_ONLY_OBJECT_FIELDS.has(field) && !caps.moderate) return deny('TEACHER_ONLY');
  return OK;
}

/** Можно ли удалить объект. */
export function canDeleteObject(
  caps: BoardCapabilities,
  userId: string,
  obj: ObjectGuardInfo,
  page: Pick<PageRecord, 'backgroundLocked'> | undefined,
): Decision {
  return canTouch(caps, userId, obj, page);
}

/** Можно ли создать/удалить/переименовать/переставить страницу. */
export function canEditPage(caps: BoardCapabilities, field?: keyof PageRecord): Decision {
  if (!caps.managePages) return deny('NO_PAGE_RIGHTS');
  if ((field === 'backgroundLocked' || field === 'background') && !caps.moderate) {
    return deny('TEACHER_ONLY');
  }
  if (field === 'id' || field === 'createdBy' || field === 'createdAt') return deny('IMMUTABLE_FIELD');
  return OK;
}

/** Метаданные документа (meta) меняет только сервер. */
export function canEditMeta(): Decision {
  return deny('TEACHER_ONLY');
}

/** Можно ли создать страницу. */
export function canCreatePage(caps: BoardCapabilities, userId: string, page: Pick<PageRecord, 'createdBy' | 'backgroundLocked'>): Decision {
  if (!caps.managePages) return deny('NO_PAGE_RIGHTS');
  if (page.createdBy !== userId) return deny('AUTHOR_MISMATCH');
  if (page.backgroundLocked && !caps.moderate) return deny('TEACHER_ONLY');
  return OK;
}
