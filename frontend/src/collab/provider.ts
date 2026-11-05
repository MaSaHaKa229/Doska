import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  CloseCode,
  MessageType,
  PROTOCOL_VERSION,
  TERMINAL_CLOSE_CODES,
  decodeServerControl,
  encodeControl,
  readFrameType,
  type ClientControlMessage,
  type ServerControlMessage,
} from '@doska/shared';
import { refreshSession } from '../api/http';

export type ProviderStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed';

export interface ProviderEvents {
  status(status: ProviderStatus, reason: string | null, code: number | null): void;
  control(msg: ServerControlMessage): void;
  synced(): void;
  /** Свои изменения, накопленные без связи, отправлены серверу (ответ на его step1). */
  flushed(): void;
}

/** Сообщения пользователю по кодам закрытия, после которых переподключения нет. */
export const CLOSE_MESSAGES: Record<number, string> = {
  [CloseCode.Forbidden]: 'Доступ к доске закрыт',
  [CloseCode.NotFound]: 'Доска не найдена или удалена',
  [CloseCode.ProtocolMismatch]: 'Приложение обновилось — перезагрузите страницу',
  [CloseCode.AccountDisabled]: 'Учётная запись заблокирована',
  [CloseCode.PasswordChangeRequired]: 'Нужно сменить временный пароль',
  [CloseCode.Superseded]: 'Доска открыта в этой вкладке заново',
};

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** Задержка переподключения: 0,5 → 1 → 2 → … → 30 с, со случайным разбросом ±25 %. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/**
 * Провайдер синхронизации доски по WebSocket (протокол — docs/SYNC_PROTOCOL.md).
 *
 * Порядок: open → hello → (сервер) session.init + sync step1 → наш step1 →
 * обмен step2 (досылка офлайн-изменений) → поток update/awareness.
 * Переподключение с экспоненциальной задержкой; код 4401 — обновить сессию
 * через refresh и сразу переподключиться; коды из TERMINAL_CLOSE_CODES —
 * остановиться и показать причину.
 */
export class BoardProvider {
  readonly awareness: awarenessProtocol.Awareness;
  status: ProviderStatus = 'connecting';
  synced = false;

  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private readonly sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  private readonly listeners: { [K in keyof ProviderEvents]: Set<ProviderEvents[K]> } = {
    status: new Set(),
    control: new Set(),
    synced: new Set(),
    flushed: new Set(),
  };

  constructor(
    readonly boardId: string,
    readonly doc: Y.Doc,
    private readonly url = defaultUrl(boardId),
  ) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.awareness.setLocalState(null);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.connect();
  }

  on<K extends keyof ProviderEvents>(event: K, fn: ProviderEvents[K]): () => void {
    (this.listeners[event] as Set<ProviderEvents[K]>).add(fn);
    return () => (this.listeners[event] as Set<ProviderEvents[K]>).delete(fn);
  }

  private emitStatus(status: ProviderStatus, reason: string | null = null, code: number | null = null): void {
    this.status = status;
    this.listeners.status.forEach((l) => l(status, reason, code));
  }

  private connect(): void {
    if (this.destroyed) return;
    this.emitStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.sendControl({ t: 'hello', protocol: PROTOCOL_VERSION, sessionId: this.sessionId, yClientId: this.doc.clientID });
    };
    ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data as ArrayBuffer));
    ws.onclose = (ev) => this.onClose(ev.code, ev.reason);
    ws.onerror = () => undefined; // подробности придут в onclose
  }

  private onMessage(data: Uint8Array): void {
    const type = readFrameType(data);
    if (type === MessageType.Control) {
      const res = decodeServerControl(data);
      if (!res.ok) return;
      const msg = res.message;
      if (msg.t === 'session.init') {
        this.attempt = 0;
        this.emitStatus('online');
        // Наш step1: сервер пришлёт то, чего у нас нет.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MessageType.Sync);
        syncProtocol.writeSyncStep1(enc, this.doc);
        this.send(encoding.toUint8Array(enc));
        this.startPing();
        this.publishAwareness();
      }
      this.listeners.control.forEach((l) => l(msg));
      return;
    }
    const decoder = decoding.createDecoder(data);
    decoding.readVarUint(decoder);
    if (type === MessageType.Sync) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Sync);
      const syncType = syncProtocol.readSyncMessage(decoder, enc, this.doc, this);
      if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
      if (syncType === syncProtocol.messageYjsSyncStep1) this.listeners.flushed.forEach((l) => l());
      if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.listeners.synced.forEach((l) => l());
      }
    } else if (type === MessageType.Awareness) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private async onClose(code: number, reason: string): Promise<void> {
    this.stopPing();
    this.ws = null;
    if (this.destroyed) return;
    // Чужие курсоры исчезают, пока нет связи.
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);

    if (TERMINAL_CLOSE_CODES.has(code)) {
      this.emitStatus('closed', CLOSE_MESSAGES[code] ?? (reason || 'Соединение закрыто'), code);
      return;
    }
    if (code === CloseCode.Unauthenticated) {
      // Истёк access-токен: обновляем сессию и сразу переподключаемся.
      if (await refreshSession()) {
        this.attempt = 0;
        this.connect();
        return;
      }
      this.emitStatus('closed', 'Сессия завершена. Войдите снова', code);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.emitStatus(navigator.onLine === false ? 'offline' : 'reconnecting');
    const delay = backoffDelay(this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private onOnline = () => {
    if (this.ws || this.destroyed || this.status === 'closed') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.connect();
  };

  private onOffline = () => {
    if (this.status === 'closed') return;
    this.emitStatus('offline');
    // Закрываем сокет явно: после восстановления сети переподключение
    // выполнит полную синхронизацию (step1/step2) и отправит накопленное.
    this.ws?.close(1000, 'Нет сети');
  };

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendControl({ t: 'ping', ts: Date.now() }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Изменения, пришедшие от сервера, обратно не отправляем. Без связи
    // изменения остаются в документе и уйдут при переподключении (step2).
    if (origin === this || this.status !== 'online') return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    syncProtocol.writeUpdate(enc, update);
    this.send(encoding.toUint8Array(enc));
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const changed = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
    if (!changed.length || this.status !== 'online') return;
    this.publishAwareness();
  };

  private publishAwareness(): void {
    if (this.awareness.getLocalState() === null) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Awareness);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
    this.send(encoding.toUint8Array(enc));
  }

  send(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  sendControl(msg: ClientControlMessage): void {
    this.send(encodeControl(msg));
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.awareness.destroy();
    this.ws?.close(1000, 'Закрытие доски');
    this.ws = null;
  }
}

function defaultUrl(boardId: string): string {
  return boardSocketUrl(boardId);
}

/** Адрес WebSocket доски; lite — облегчённая подписка (только документ, для миниатюр). */
export function boardSocketUrl(boardId: string, lite = false): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/boards/${boardId}${lite ? '?lite=1' : ''}`;
}
