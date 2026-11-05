import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { AUTH_COOKIES, CloseCode, LIMITS } from '@doska/shared';
import { Connection } from './connection.js';
import { Room } from './room.js';
import { DEFAULT_PERSISTENCE, type PersistenceOptions } from './persistence.js';
import { loadBoardAccess } from '../boards/access.js';

export interface RealtimeOptions {
  /** Через сколько после ухода последнего участника выгружать доску из памяти. */
  unloadDelayMs: number;
  /** Сколько ждать сообщение hello после подключения. */
  helloTimeoutMs: number;
  /** Периодическая перепроверка, что пользователь не заблокирован. */
  recheckIntervalMs: number;
  /** Максимум одновременных подключений одного пользователя. */
  maxConnectionsPerUser: number;
  /** Максимум облегчённых подписок (?lite=1, сетка работ) одного пользователя. */
  maxLiteConnectionsPerUser: number;
  persistence: PersistenceOptions;
}

export const DEFAULT_REALTIME: RealtimeOptions = {
  unloadDelayMs: 30_000,
  helloTimeoutMs: 10_000,
  recheckIntervalMs: 60_000,
  maxConnectionsPerUser: 20,
  maxLiteConnectionsPerUser: 60,
  persistence: DEFAULT_PERSISTENCE,
};

const PATH_RE = /^\/ws\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Менеджер комнат: загрузка доски в память при первом подключении,
 * выгрузка после ухода всех участников, корректное завершение работы.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Promise<Room>>();
  private readonly unloading = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly app: FastifyInstance,
    private readonly opts: RealtimeOptions,
  ) {}

  /** Загруженная комната (без загрузки), если есть. */
  async peek(boardId: string): Promise<Room | undefined> {
    const p = this.rooms.get(boardId);
    return p ? p.catch(() => undefined) : undefined;
  }

  async acquire(boardId: string): Promise<Room> {
    const pendingUnload = this.unloading.get(boardId);
    if (pendingUnload) await pendingUnload;
    let p = this.rooms.get(boardId);
    if (!p) {
      p = Room.load(this.app, boardId, this.opts.persistence);
      this.rooms.set(boardId, p);
      p.catch(() => this.rooms.delete(boardId));
    }
    return p;
  }

  /** Вызывается при отключении: пустая комната выгружается через unloadDelayMs. */
  release(room: Room): void {
    if (room.conns.size > 0 || this.shuttingDown || room.destroyed) return;
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    room.unloadTimer = setTimeout(() => {
      room.unloadTimer = null;
      if (room.conns.size === 0) void this.unload(room);
    }, this.opts.unloadDelayMs);
  }

  private async unload(room: Room): Promise<void> {
    if (this.unloading.has(room.boardId)) return this.unloading.get(room.boardId);
    if (room.destroyed) return;
    this.rooms.delete(room.boardId);
    const p = room
      .destroy()
      .catch((err) => this.app.log.error({ err, boardId: room.boardId }, 'Ошибка выгрузки доски'))
      .finally(() => this.unloading.delete(room.boardId));
    this.unloading.set(room.boardId, p);
    return p;
  }

  async loadedRooms(): Promise<Room[]> {
    const list = await Promise.allSettled([...this.rooms.values()]);
    return list.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  }

  connectionsOfUser(userId: string, rooms: Room[]): Connection[] {
    return rooms.flatMap((r) => [...r.conns].filter((c) => c.user.id === userId));
  }

  async closeUser(userId: string, code: number, reason: string): Promise<void> {
    for (const c of this.connectionsOfUser(userId, await this.loadedRooms())) c.close(code, reason);
  }

  /**
   * Выгрузить все комнаты сейчас (с сохранением), подключения закрываются
   * кодом «переподключитесь». Для тестов: дождаться окончания фоновой записи.
   */
  async unloadAll(): Promise<void> {
    const rooms = await this.loadedRooms();
    for (const room of rooms) {
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      room.unloadTimer = null;
      for (const c of room.conns) c.close(CloseCode.ServerRestart, 'Доска выгружается');
    }
    await Promise.all(rooms.map((r) => this.unload(r)));
    await Promise.all([...this.unloading.values()]);
  }

  /** Остановка сервера: сохранить все доски, клиентам — «переподключитесь». */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const rooms = await this.loadedRooms();
    for (const room of rooms) {
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      for (const c of room.conns) c.close(CloseCode.ServerRestart, 'Сервер перезапускается');
    }
    await Promise.all(rooms.map((r) => this.unload(r)));
    await Promise.all([...this.unloading.values()]);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RoomManager;
  }
}

/** IP клиента для журнала: за обратным прокси (TRUST_PROXY) — из X-Forwarded-For. */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const fwd = req.headers['x-forwarded-for'];
  if (trustProxy && typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? '';
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Подключение сервера реального времени к HTTP-серверу Fastify.
 *
 * На этапе upgrade проверяются только адрес и Origin (защита от
 * Cross-Site WebSocket Hijacking). Остальные ошибки (нет входа, нет
 * доступа, доска удалена) сообщаются кодами закрытия 44xx после upgrade —
 * браузер не показывает скрипту HTTP-статус неудачного upgrade, а код
 * закрытия клиент различает и реагирует правильно.
 */
export function registerRealtime(app: FastifyInstance, partial: Partial<RealtimeOptions> = {}): RoomManager {
  const opts: RealtimeOptions = { ...DEFAULT_REALTIME, ...partial, persistence: { ...DEFAULT_PERSISTENCE, ...partial.persistence } };
  const manager = new RoomManager(app, opts);
  app.decorate('realtime', manager);
  const allowedOrigins = new Set(app.config.publicOrigins.map((o) => new URL(o).origin));
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.maxMessageBytes,
    perMessageDeflate: { threshold: 1024 },
  });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = PATH_RE.exec(url.pathname);
    if (!m) return reject(socket, 404, 'Not Found');
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      app.log.warn({ origin }, 'WebSocket: чужой Origin');
      return reject(socket, 403, 'Forbidden');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws, req, m[1]!.toLowerCase(), url.searchParams.get('lite') === '1');
    });
  };
  app.server.on('upgrade', onUpgrade);

  async function onConnection(ws: WebSocket, req: IncomingMessage, boardId: string, lite: boolean): Promise<void> {
    // Сообщения, пришедшие до завершения проверки прав, копятся в очереди.
    const queue: Uint8Array[] = [];
    let handler: ((data: Uint8Array) => void) | null = null;
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        ws.close(CloseCode.ProtocolViolation, 'Ожидались бинарные кадры');
        return;
      }
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (handler) handler(u8);
      else if (queue.length < 100) queue.push(u8);
      else ws.close(CloseCode.RateLimited, 'Слишком много сообщений до авторизации');
    });
    ws.on('error', (err) => app.log.debug({ err }, 'WebSocket error'));
    const closeWith = (code: number, reason: string) => ws.close(code, reason);

    try {
      const cookies = app.parseCookie(req.headers.cookie ?? '');
      const token = cookies[AUTH_COOKIES.access];
      if (!token) return closeWith(CloseCode.Unauthenticated, 'Требуется вход');
      const claims = await app.tokens.verifyAccess(token);
      if (!claims || claims === 'expired') return closeWith(CloseCode.Unauthenticated, 'Сессия истекла');
      const status = await app.userStatus.get(claims.sub);
      if (!status) return closeWith(CloseCode.Unauthenticated, 'Требуется вход');
      if (!status.active) return closeWith(CloseCode.AccountDisabled, 'Учётная запись заблокирована');
      if (claims.iat < status.passwordChangedAtSec) return closeWith(CloseCode.Unauthenticated, 'Сессия истекла');
      if (status.mustChangePassword) return closeWith(CloseCode.PasswordChangeRequired, 'Смените временный пароль');

      const access = await loadBoardAccess(app.prisma, { id: status.id, role: status.role }, boardId);
      if (!access) return closeWith(CloseCode.NotFound, 'Доска не найдена');
      if (!access.caps.view) return closeWith(CloseCode.Forbidden, 'Нет доступа к доске');

      const rooms = await manager.loadedRooms();
      const same = manager.connectionsOfUser(status.id, rooms).filter((c) => c.lite === lite).length;
      if (same >= (lite ? opts.maxLiteConnectionsPerUser : opts.maxConnectionsPerUser)) {
        return closeWith(CloseCode.RateLimited, 'Слишком много открытых досок');
      }
      if (ws.readyState !== ws.OPEN) return;

      const room = await manager.acquire(boardId);
      const ip = clientIp(req, app.config.trustProxy);
      const ua = req.headers['user-agent'];
      const conn = new Connection(
        ws,
        { id: status.id, login: status.login, fullName: status.fullName, role: status.role, color: status.color },
        ip,
        access.caps,
        access.facts,
        typeof ua === 'string' ? ua : null,
      );
      conn.lite = lite;
      room.attach(conn);
      ws.on('close', () => {
        room.detach(conn);
        manager.release(room);
      });
      if (ws.readyState !== ws.OPEN) {
        room.detach(conn);
        manager.release(room);
        return;
      }
      const helloTimer = setTimeout(() => {
        if (!conn.ready) conn.close(CloseCode.ProtocolViolation, 'Не получено сообщение hello');
      }, opts.helloTimeoutMs);
      ws.on('close', () => clearTimeout(helloTimer));

      handler = (data) => room.handleMessage(conn, data);
      for (const data of queue.splice(0)) handler(data);
    } catch (err) {
      app.log.error({ err, boardId }, 'Ошибка подключения к доске');
      closeWith(CloseCode.Internal, 'Внутренняя ошибка');
    }
  }

  // ----- Реакция на события других модулей -----
  app.events.on('user.sessionsRevoked', ({ userId, reason }) => {
    const disabled = reason === 'blocked' || reason === 'deleted';
    void manager.closeUser(
      userId,
      disabled ? CloseCode.AccountDisabled : CloseCode.Unauthenticated,
      disabled ? 'Учётная запись заблокирована' : 'Сессия завершена',
    );
  });
  const refresh = async (boardId: string, by?: string) => {
    const room = await manager.peek(boardId);
    if (room) await room.refreshAccess(by).catch((err) => app.log.error({ err, boardId }, 'Ошибка пересчёта прав'));
  };
  app.events.on('board.accessChanged', ({ boardId }) => void refresh(boardId));
  app.events.on('board.updated', ({ boardId, by }) => void refresh(boardId, by));
  app.events.on('board.deleted', ({ boardId }) => void refresh(boardId));
  app.events.on('assignment.worksChanged', ({ boardIds }) => {
    for (const boardId of boardIds) {
      void manager.peek(boardId).then(async (room) => {
        if (!room) return;
        // О смене статуса работы клиент сообщает сам — общее «права изменились» не нужно.
        await room.refreshAccess(undefined, true).catch((err) => app.log.error({ err, boardId }, 'Ошибка пересчёта прав'));
        await room.broadcastWork().catch((err) => app.log.error({ err, boardId }, 'Ошибка рассылки статуса работы'));
      });
    }
  });
  app.events.on('user.updated', ({ userId }) => {
    void manager.loadedRooms().then(async (rooms) => {
      for (const room of rooms) if ([...room.conns].some((c) => c.user.id === userId)) await room.refreshAccess();
    });
  });

  // Периодическая перепроверка: блокировка, истечение прав.
  const recheck = setInterval(() => {
    void manager.loadedRooms().then(async (rooms) => {
      for (const room of rooms) {
        for (const conn of room.conns) {
          const status = await app.userStatus.get(conn.user.id).catch(() => null);
          if (status && !status.active) conn.close(CloseCode.AccountDisabled, 'Учётная запись заблокирована');
        }
      }
    });
  }, opts.recheckIntervalMs);
  recheck.unref();

  app.addHook('preClose', async () => {
    clearInterval(recheck);
    app.server.off('upgrade', onUpgrade);
    await manager.shutdown();
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  return manager;
}
