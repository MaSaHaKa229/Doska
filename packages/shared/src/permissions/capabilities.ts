import type { BoardKind, BoardMemberRole, BoardMode, UserRole } from '../enums.js';
import type { BoardSettings } from '../board/settings.js';

/**
 * Права на доске.
 *
 * Одна и та же функция computeCapabilities используется:
 *  - сервером — для каждого REST-запроса и каждого WebSocket-сообщения
 *    (источник истины);
 *  - клиентом — чтобы заранее выключать недоступные инструменты и
 *    показывать подсказки (интерфейс никогда не считается защитой).
 *
 * Входные данные собирает сервер из БД (BoardAccessFacts), клиент получает
 * уже вычисленные capabilities в сообщении session.init / capabilities.
 */

/** Роль пользователя относительно конкретной доски. */
export type BoardRole =
  /** Владелец доски (учитель; для конспекта — ученик-владелец). */
  | 'owner'
  /** Соведущий учитель. */
  | 'teacher'
  /** Допущенный ученик. */
  | 'student'
  /** Только просмотр (администратор, гость-учитель, учитель для открытого конспекта). */
  | 'viewer'
  /** Нет доступа. */
  | 'none';

export interface BoardAccessFacts {
  user: { id: string; role: UserRole };
  board: {
    kind: BoardKind;
    mode: BoardMode;
    ownerId: string;
    settings: BoardSettings;
    /** Для NOTEBOOK: владелец открыл конспект своим учителям. */
    sharedWithTeachers: boolean;
  };
  /** Прямое членство (BoardMember) или null. */
  memberRole: BoardMemberRole | null;
  /** Пользователь — ученик класса, которому выдана доска (BoardClassAccess). */
  studentViaClass: boolean;
  /** Пользователь — учитель класса, в котором состоит владелец доски (для конспектов). */
  teachesOwner: boolean;
  /** У пользователя есть «мел» (ChalkGrant). */
  hasChalk: boolean;
  /**
   * Для ASSIGNMENT_WORK: данные задания. submitted — работа сдана или
   * проверена: ученик её больше не меняет, пока учитель не вернёт на доработку.
   */
  assignment?: { studentId: string; closed: boolean; submitted?: boolean } | undefined;
  /** Для TEMPLATE: шаблон виден пользователю (встроенный/общий/выдан ему). */
  templateVisible?: boolean | undefined;
}

/** Почему запись запрещена — для подсказки в интерфейсе. */
export type NoWriteReason =
  | 'lecture-mode'
  | 'no-chalk'
  | 'read-only'
  | 'assignment-closed'
  | 'assignment-submitted'
  | 'no-access';

export interface BoardCapabilities {
  role: BoardRole;
  /** Видеть доску. */
  view: boolean;
  /** Создавать объекты и менять разрешённые. */
  write: boolean;
  noWriteReason: NoWriteReason | null;
  /** Учительские права на содержимое: блокировка, слой background/review, чужие объекты. */
  moderate: boolean;
  /** Менять режим, выдавать мел, управлять доступом и настройками. */
  manageLesson: boolean;
  /** Добавлять, удалять, переименовывать и переставлять страницы. */
  managePages: boolean;
  /** Менять/стирать объекты других учеников (не учительские). */
  editOthers: boolean;
  /**
   * Менять незаблокированные объекты учителя. Ученику — только в своей работе
   * по заданию (например, двигать подготовленную учителем точку).
   */
  editTeacherObjects: boolean;
  /** Лазерная указка, видимая всем. */
  laser: boolean;
  /** Вести «Следуйте за мной». */
  leadFollow: boolean;
  /** Очищать следы учеников, удалять объекты конкретного ученика. */
  clearStudentObjects: boolean;
  /** Просматривать и восстанавливать историю версий. */
  restoreVersions: boolean;
  /** Поднимать руку. */
  raiseHand: boolean;
}

const NONE: BoardCapabilities = {
  role: 'none',
  view: false,
  write: false,
  noWriteReason: 'no-access',
  moderate: false,
  manageLesson: false,
  managePages: false,
  editOthers: false,
  editTeacherObjects: false,
  laser: false,
  leadFollow: false,
  clearStudentObjects: false,
  restoreVersions: false,
  raiseHand: false,
};

const VIEWER: BoardCapabilities = { ...NONE, role: 'viewer', view: true, noWriteReason: 'read-only' };

const FULL: BoardCapabilities = {
  role: 'owner',
  view: true,
  write: true,
  noWriteReason: null,
  moderate: true,
  manageLesson: true,
  managePages: true,
  editOthers: true,
  editTeacherObjects: true,
  laser: true,
  leadFollow: true,
  clearStudentObjects: true,
  restoreVersions: true,
  raiseHand: false,
};

/** Определение роли пользователя на доске. */
export function resolveBoardRole(f: BoardAccessFacts): BoardRole {
  const { user, board } = f;
  // Администратор управляет пользователями, но к содержимому досок — только просмотр.
  if (user.role === 'ADMIN') return 'viewer';

  switch (board.kind) {
    case 'LESSON':
    case 'TEMPLATE': {
      if (board.ownerId === user.id) return 'owner';
      if (f.memberRole === 'CO_TEACHER' && user.role === 'TEACHER') return 'teacher';
      if (user.role === 'STUDENT' && (f.memberRole === 'STUDENT' || f.studentViaClass)) {
        return board.kind === 'LESSON' ? 'student' : 'viewer';
      }
      if (f.memberRole === 'VIEWER') return 'viewer';
      if (board.kind === 'TEMPLATE' && user.role === 'TEACHER' && f.templateVisible) return 'viewer';
      return 'none';
    }
    case 'NOTEBOOK': {
      if (board.ownerId === user.id) return 'owner';
      if (user.role === 'TEACHER' && board.sharedWithTeachers && f.teachesOwner) return 'viewer';
      return 'none';
    }
    case 'ASSIGNMENT_WORK': {
      // Копия задания принадлежит выдавшему учителю.
      if (board.ownerId === user.id) return 'owner';
      if (f.memberRole === 'CO_TEACHER' && user.role === 'TEACHER') return 'teacher';
      if (f.assignment && f.assignment.studentId === user.id) return 'student';
      return 'none';
    }
  }
}

/** Полный набор прав пользователя на доске. */
export function computeCapabilities(f: BoardAccessFacts): BoardCapabilities {
  const role = resolveBoardRole(f);
  const { board } = f;

  if (role === 'none') return NONE;
  if (role === 'viewer') return VIEWER;

  if (role === 'owner' || role === 'teacher') {
    if (board.kind === 'NOTEBOOK') {
      // Владелец конспекта — ученик: полный контроль над своим, но без аудитории.
      return {
        ...FULL,
        role,
        manageLesson: false,
        leadFollow: false,
        clearStudentObjects: false,
      };
    }
    return { ...FULL, role };
  }

  // role === 'student'
  if (board.kind === 'ASSIGNMENT_WORK') {
    const closed = f.assignment?.closed ?? false;
    const submitted = f.assignment?.submitted ?? false;
    const locked = closed || submitted;
    return {
      ...NONE,
      role,
      view: true,
      write: !locked,
      noWriteReason: closed ? 'assignment-closed' : submitted ? 'assignment-submitted' : null,
      managePages: !locked,
      // Объекты шаблона (созданы учителем, не заблокированы) ученик может
      // двигать — например, точку для исследования. Пометки review и
      // заблокированные объекты защищены правилами object-rules.ts.
      editOthers: !locked,
      editTeacherObjects: !locked,
      laser: !locked,
      raiseHand: true,
    };
  }

  // Ученик на доске урока.
  let write: boolean;
  let noWriteReason: NoWriteReason | null = null;
  switch (board.mode) {
    case 'COLLABORATIVE':
      write = true;
      break;
    case 'SELECTIVE':
      write = f.hasChalk;
      if (!write) noWriteReason = 'no-chalk';
      break;
    case 'LECTURE':
      write = false;
      noWriteReason = 'lecture-mode';
      break;
  }
  return {
    ...NONE,
    role,
    view: true,
    write,
    noWriteReason,
    managePages: write && board.settings.allowStudentPages,
    editOthers: write && board.settings.allowStudentsEditOthers,
    laser: write && board.settings.allowStudentLaser,
    raiseHand: true,
  };
}

/** Текст подсказки, когда инструменты рисования неактивны. */
export function noWriteHint(reason: NoWriteReason | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'lecture-mode':
      return 'Сейчас режим «Лекция»: писать на доске может только учитель.';
    case 'no-chalk':
      return 'Писать могут ученики, которым учитель дал мел. Поднимите руку, чтобы попросить слово.';
    case 'read-only':
      return 'Эта доска открыта только для просмотра.';
    case 'assignment-closed':
      return 'Задание закрыто: работу больше нельзя изменять.';
    case 'assignment-submitted':
      return 'Работа сдана на проверку, изменять её нельзя. Пока учитель не проверил, сдачу можно отменить; после проверки — исправить, если учитель вернёт работу на доработку.';
    case 'no-access':
      return 'Нет доступа к этой доске.';
  }
}
