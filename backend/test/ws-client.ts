import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import WebSocket from 'ws';
import {
  MessageType,
  PROTOCOL_VERSION,
  decodeServerControl,
  encodeControl,
  readFrameType,
  type ClientControlMessage,
  type ServerControlMessage,
} from '@doska/shared';

const REMOTE = 'remote';

/**
 * Минимальный клиент протокола доски для интеграционных тестов
 * (ведёт себя как браузерный провайдер: hello → sync → awareness).
 */
export class YClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly controls: ServerControlMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  httpStatus: number | null = null;
  private ws!: WebSocket;

  static connect(url: string, cookie: string | null, origin = 'https://doska.test', sendHello = true): Promise<YClient> {
    const c = new YClient();
    return new Promise((resolve) => {
      c.ws = new WebSocket(url, { headers: { origin, ...(cookie ? { cookie } : {}) } });
      c.ws.binaryType = 'nodebuffer';
      c.ws.on('unexpected-response', (_req, res) => {
        c.httpStatus = res.statusCode ?? null;
        c.closed = { code: -1, reason: 'http' };
        resolve(c);
      });
      c.ws.on('open', () => {
        if (sendHello) c.sendControl({ t: 'hello', protocol: PROTOCOL_VERSION, sessionId: 'sess-' + c.doc.clientID, yClientId: c.doc.clientID });
        resolve(c);
      });
      c.ws.on('error', () => undefined);
      c.ws.on('close', (code, reason) => {
        c.closed = { code, reason: reason.toString() };
      });
      c.ws.on('message', (data: Buffer) => c.onMessage(new Uint8Array(data)));
    });
    // недостижимо
  }

  private constructor() {
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Sync);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    });
    this.awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      if (origin === REMOTE) return;
      const changed = [...added!, ...updated!, ...removed!];
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Awareness);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.send(encoding.toUint8Array(enc));
    });
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  sendControl(msg: ClientControlMessage): void {
    this.send(encodeControl(msg));
  }

  private onMessage(data: Uint8Array): void {
    const type = readFrameType(data);
    if (type === MessageType.Control) {
      const r = decodeServerControl(data);
      if (!r.ok) throw new Error('bad control ' + r.error);
      this.controls.push(r.message);
      if (r.message.t === 'session.init') {
        // Наш step1: сервер пришлёт то, чего у нас нет.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MessageType.Sync);
        syncProtocol.writeSyncStep1(enc, this.doc);
        this.send(encoding.toUint8Array(enc));
      }
      return;
    }
    const decoder = decoding.createDecoder(data);
    decoding.readVarUint(decoder);
    if (type === MessageType.Sync) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Sync);
      syncProtocol.readSyncMessage(decoder, enc, this.doc, REMOTE);
      if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
    } else if (type === MessageType.Awareness) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), REMOTE);
    }
  }

  control<T extends ServerControlMessage['t']>(t: T): Extract<ServerControlMessage, { t: T }>[] {
    return this.controls.filter((c) => c.t === t) as Extract<ServerControlMessage, { t: T }>[];
  }

  objects(): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  }

  pageId(): string {
    return [...this.doc.getMap('pages').keys()][0]!;
  }

  close(): void {
    this.ws.close();
    this.awareness.destroy();
  }

  /** Отправить сырые байты обновления (для проверки нарушений протокола). */
  sendRawUpdate(update: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    syncProtocol.writeUpdate(enc, update);
    this.send(encoding.toUint8Array(enc));
  }
}

export async function waitFor(check: () => boolean, timeoutMs = 4000, what = 'условие'): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Не дождались: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
