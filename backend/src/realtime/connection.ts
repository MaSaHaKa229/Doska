import { WebSocket } from 'ws';
import type { UserRole } from '@prisma/client';
import {
  CloseCode,
  encodeControl,
  type BoardAccessFacts,
  type BoardCapabilities,
  type ServerControlMessage,
} from '@doska/shared';
import { TokenBucket } from './rate-limit.js';

export interface ConnUser {
  id: string;
  login: string;
  fullName: string;
  role: UserRole;
  color: string;
}

/** Если клиент не успевает принимать данные — соединение разрывается (он переподключится). */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

/**
 * Одно WebSocket-подключение пользователя к доске.
 */
export class Connection {
  /** Получено hello, соединение участвует в синхронизации. */
  ready = false;
  sessionId: string | null = null;
  yClientId: number | null = null;
  /** clientID awareness, опубликованные этим соединением (удаляются при отключении). */
  readonly awarenessClients = new Set<number>();
  caps: BoardCapabilities;
  facts: BoardAccessFacts;
  readonly buckets = {
    // Пиковая и средняя частота по docs/SYNC_PROTOCOL.md, раздел 10.
    sync: new TokenBucket(60, 20),
    syncBytes: new TokenBucket(4 * 1024 * 1024, 2 * 1024 * 1024),
    awareness: new TokenBucket(40, 40),
    control: new TokenBucket(20, 20),
  };
  private lastSlowDown = 0;

  constructor(
    readonly ws: WebSocket,
    public user: ConnUser,
    readonly ip: string,
    caps: BoardCapabilities,
    facts: BoardAccessFacts,
    readonly userAgent: string | null = null,
  ) {
    this.caps = caps;
    this.facts = facts;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(data: Uint8Array): void {
    if (!this.open) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.close(CloseCode.Internal, 'Клиент не успевает принимать данные');
      return;
    }
    this.ws.send(data, { binary: true });
  }

  sendControl(message: ServerControlMessage): void {
    this.send(encodeControl(message));
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) return;
    // Причина в кадре закрытия ограничена 123 байтами UTF-8.
    let r = reason;
    while (Buffer.byteLength(r) > 120) r = r.slice(0, -1);
    this.ws.close(code, r);
  }

  /**
   * Превышение лимита частоты: первое — предупреждение SLOW_DOWN, повторное
   * в течение 10 с — закрытие соединения (4429). Возвращает false, если
   * соединение закрыто.
   */
  rateLimited(): boolean {
    const now = Date.now();
    if (now - this.lastSlowDown < 10_000) {
      this.close(CloseCode.RateLimited, 'Слишком частые сообщения');
      return false;
    }
    this.lastSlowDown = now;
    this.sendControl({ t: 'notice', level: 'warning', code: 'SLOW_DOWN', message: 'Слишком частые изменения — часть пропущена' });
    return true;
  }
}
