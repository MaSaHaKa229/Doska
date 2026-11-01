import { EventEmitter } from 'node:events';

/**
 * Внутренняя шина событий процесса. Через неё модули узнают о событиях,
 * которые требуют немедленной реакции в других модулях: например, при
 * блокировке пользователя модуль realtime (этап 3) закрывает его WebSocket.
 */
export interface AppEventMap {
  /** Пользователь заблокирован, удалён или сменил пароль — все его сессии недействительны. */
  'user.sessionsRevoked': { userId: string; reason: 'blocked' | 'deleted' | 'password-changed' | 'password-reset' | 'logout-all' };
  /** Изменились данные пользователя (ФИО, роль, цвет) — обновить кэши. */
  'user.updated': { userId: string };
  /** Изменился доступ к доске (классы, участники, мел) — пересчитать права подключённых. */
  'board.accessChanged': { boardId: string };
  /** Изменились свойства доски (название, режим, настройки). */
  'board.updated': { boardId: string; /** Кто сменил режим (для mode.changed). */ by?: string };
  /** Доска удалена — закрыть подключения. */
  'board.deleted': { boardId: string };
}

export class AppEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit<K extends keyof AppEventMap>(event: K, payload: AppEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof AppEventMap>(event: K, listener: (payload: AppEventMap[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}
