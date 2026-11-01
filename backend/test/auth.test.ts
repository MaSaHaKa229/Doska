import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AUTH_COOKIES } from '@doska/shared';
import { ORIGIN, TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { hashToken } from '../src/auth/tokens.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp({}, (a) => {
    // Тестовые маршруты для проверки guard-ов ролей.
    a.get('/api/test/admin-only', { preHandler: [a.authenticate, a.requireRole('ADMIN')] }, async () => ({ ok: true }));
    a.post('/api/test/echo', { preHandler: [a.authenticate] }, async () => ({ ok: true }));
  });
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});
beforeEach(async () => {
  await resetDb();
});

describe('вход', () => {
  it('успешный вход ставит httpOnly-cookie и возвращает пользователя', async () => {
    await createUser({ login: 'ivanov', password: 'kot12345', role: 'TEACHER', fullName: 'Иванов Иван' });
    const c = new TestClient(app);
    const res = await c.login('  Ivanov ', 'kot12345');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ login: 'ivanov', role: 'TEACHER', fullName: 'Иванов Иван', mustChangePassword: false });
    expect(body.user.passwordHash).toBeUndefined();

    const setCookies = res.cookies as { name: string; httpOnly?: boolean; sameSite?: string; path?: string }[];
    const access = setCookies.find((x) => x.name === AUTH_COOKIES.access);
    const refresh = setCookies.find((x) => x.name === AUTH_COOKIES.refresh);
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe('Strict');
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/api/auth');

    // В БД хранится только хеш refresh-токена.
    const rt = await testPrisma().refreshToken.findFirst();
    expect(rt?.tokenHash).toBe(hashToken(c.cookies.get(AUTH_COOKIES.refresh)!));

    const me = await c.request('GET', '/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.login).toBe('ivanov');

    const log = await testPrisma().auditLog.findMany({ where: { action: 'LOGIN_SUCCESS' } });
    expect(log).toHaveLength(1);
  });

  it('неверный пароль и несуществующий логин дают одинаковый ответ', async () => {
    await createUser({ login: 'petrov', password: 'kot12345' });
    const c = new TestClient(app);
    const a = await c.login('petrov', 'wrong-pass1');
    const b = await c.login('nobody', 'wrong-pass1');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect(a.json().error.code).toBe('INVALID_CREDENTIALS');
    const failed = await testPrisma().auditLog.count({ where: { action: 'LOGIN_FAILED' } });
    expect(failed).toBe(2);
  });

  it('после 5 неудач подряд учётная запись временно блокируется', async () => {
    await createUser({ login: 'sidorov', password: 'kot12345' });
    const c = new TestClient(app);
    for (let i = 0; i < 5; i++) expect((await c.login('sidorov', 'bad-pass-' + i)).statusCode).toBe(401);
    // Даже верный пароль не принимается во время блокировки.
    const locked = await c.login('sidorov', 'kot12345');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.json().error.message).toMatch(/15 минут/);

    // После истечения блокировки вход возможен, счётчик сбрасывается.
    await testPrisma().user.update({ where: { login: 'sidorov' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const ok = await c.login('sidorov', 'kot12345');
    expect(ok.statusCode).toBe(200);
    const u = await testPrisma().user.findUniqueOrThrow({ where: { login: 'sidorov' } });
    expect(u.failedLoginCount).toBe(0);
  });

  it('заблокированный администратором — отказ только после верного пароля', async () => {
    await createUser({ login: 'blocked', password: 'kot12345', isBlocked: true });
    const c = new TestClient(app);
    expect((await c.login('blocked', 'wrong-pass1')).json().error.code).toBe('INVALID_CREDENTIALS');
    const res = await c.login('blocked', 'kot12345');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('ошибки валидации', async () => {
    const c = new TestClient(app);
    const res = await c.login('', '');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details.login).toBeDefined();
  });

  it('rate limiting по IP', async () => {
    const limited = await createTestApp({ RATE_LIMIT_LOGIN_PER_MINUTE: '3' });
    try {
      const c = new TestClient(limited);
      for (let i = 0; i < 3; i++) await c.login('x' + i + 'yz', 'whatever1');
      const res = await c.login('abc', 'whatever1');
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});

describe('CSRF', () => {
  it('изменяющий запрос без CSRF-токена отклоняется', async () => {
    await createUser({ login: 'user1', password: 'kot12345' });
    const c = new TestClient(app);
    await c.initCsrf();
    const res = await c.request('POST', '/api/auth/login', { login: 'user1', password: 'kot12345' }, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it('чужой Origin отклоняется даже с верным токеном', async () => {
    await createUser({ login: 'user1', password: 'kot12345' });
    const c = new TestClient(app);
    await c.initCsrf();
    const res = await c.request('POST', '/api/auth/login', { login: 'user1', password: 'kot12345' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    const ok = await c.request('POST', '/api/auth/login', { login: 'user1', password: 'kot12345' }, { origin: ORIGIN });
    expect(ok.statusCode).toBe(200);
  });

  it('GET /csrf не меняет действующий токен', async () => {
    const c = new TestClient(app);
    await c.initCsrf();
    const first = c.cookies.get(AUTH_COOKIES.csrf);
    const res = await c.request('GET', '/api/auth/csrf');
    expect(res.json().csrfToken).toBe(first);
  });
});

describe('доступ и роли', () => {
  it('без входа — 401, без нужной роли — 403', async () => {
    await createUser({ login: 'student', password: 'kot12345' });
    await createUser({ login: 'admin', password: 'kot12345', role: 'ADMIN' });
    const anon = new TestClient(app);
    expect((await anon.request('GET', '/api/auth/me')).statusCode).toBe(401);

    const s = new TestClient(app);
    await s.login('student', 'kot12345');
    const forbidden = await s.request('GET', '/api/test/admin-only');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');

    const a = new TestClient(app);
    await a.login('admin', 'kot12345');
    expect((await a.request('GET', '/api/test/admin-only')).statusCode).toBe(200);
  });

  it('подделанный токен отклоняется', async () => {
    const c = new TestClient(app);
    c.cookies.set(AUTH_COOKIES.access, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    expect((await c.request('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('смена роли администратором действует сразу (роль берётся из БД)', async () => {
    const u = await createUser({ login: 'promoted', password: 'kot12345', role: 'TEACHER' });
    const c = new TestClient(app);
    await c.login('promoted', 'kot12345');
    expect((await c.request('GET', '/api/test/admin-only')).statusCode).toBe(403);
    await testPrisma().user.update({ where: { id: u.id }, data: { role: 'ADMIN' } });
    app.events.emit('user.updated', { userId: u.id });
    expect((await c.request('GET', '/api/test/admin-only')).statusCode).toBe(200);
  });

  it('блокировка пользователя прекращает доступ по уже выданному токену', async () => {
    const u = await createUser({ login: 'tobeblocked', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('tobeblocked', 'kot12345');
    expect((await c.request('GET', '/api/auth/me')).statusCode).toBe(200);
    await testPrisma().user.update({ where: { id: u.id }, data: { isBlocked: true } });
    app.events.emit('user.sessionsRevoked', { userId: u.id, reason: 'blocked' });
    const res = await c.request('GET', '/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('ACCOUNT_BLOCKED');
  });
});

describe('временный пароль', () => {
  it('до смены пароля доступны только /me и смена пароля', async () => {
    await createUser({ login: 'newbie', password: 'tmp-48p-qaz7', mustChangePassword: true });
    const c = new TestClient(app);
    const login = await c.login('newbie', 'tmp-48p-qaz7');
    expect(login.json().user.mustChangePassword).toBe(true);

    expect((await c.request('GET', '/api/auth/me')).statusCode).toBe(200);
    const blocked = await c.request('POST', '/api/test/echo', {});
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await c.request('POST', '/api/auth/change-password', { currentPassword: 'tmp-48p-qaz7', newPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('WEAK_PASSWORD');

    const wrong = await c.request('POST', '/api/auth/change-password', { currentPassword: 'nope', newPassword: 'NewPass2026' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details.currentPassword).toBeDefined();

    const ok = await c.request('POST', '/api/auth/change-password', { currentPassword: 'tmp-48p-qaz7', newPassword: 'NewPass2026' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.mustChangePassword).toBe(false);
    expect((await c.request('POST', '/api/test/echo', {})).statusCode).toBe(200);

    const audit = await testPrisma().auditLog.count({ where: { action: 'PASSWORD_CHANGED' } });
    expect(audit).toBe(1);
  });

  it('смена пароля завершает другие сессии', async () => {
    await createUser({ login: 'twodevices', password: 'kot12345' });
    const phone = new TestClient(app);
    const laptop = new TestClient(app);
    await phone.login('twodevices', 'kot12345');
    await laptop.login('twodevices', 'kot12345');

    await new Promise((r) => setTimeout(r, 1100)); // iat старых токенов < времени смены пароля
    const res = await laptop.request('POST', '/api/auth/change-password', { currentPassword: 'kot12345', newPassword: 'Other2026pass' });
    expect(res.statusCode).toBe(200);

    expect((await phone.request('GET', '/api/auth/me')).json().error.code).toBe('SESSION_EXPIRED');
    expect((await phone.request('POST', '/api/auth/refresh')).statusCode).toBe(401);
    expect((await laptop.request('GET', '/api/auth/me')).statusCode).toBe(200);
  });
});

describe('refresh и выход', () => {
  it('ротация refresh-токена', async () => {
    await createUser({ login: 'rot', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('rot', 'kot12345');
    const first = c.cookies.get(AUTH_COOKIES.refresh)!;
    const res = await c.request('POST', '/api/auth/refresh');
    expect(res.statusCode).toBe(200);
    const second = c.cookies.get(AUTH_COOKIES.refresh)!;
    expect(second).not.toBe(first);
    const old = await testPrisma().refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(first) } });
    expect(old.revokeReason).toBe('rotated');
    expect(old.replacedById).not.toBeNull();
  });

  it('гонка двух вкладок не считается кражей', async () => {
    await createUser({ login: 'tabs', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('tabs', 'kot12345');
    const stale = c.cookies.get(AUTH_COOKIES.refresh)!;
    await c.request('POST', '/api/auth/refresh');
    const other = new TestClient(app);
    other.cookies.set(AUTH_COOKIES.refresh, stale);
    other.cookies.set(AUTH_COOKIES.csrf, c.cookies.get(AUTH_COOKIES.csrf)!);
    const res = await other.request('POST', '/api/auth/refresh');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REFRESH_RACE');
    // Семья не отозвана — основная вкладка продолжает работать.
    expect((await c.request('POST', '/api/auth/refresh')).statusCode).toBe(200);
  });

  it('повтор старого токена после окна гонки отзывает всю семью', async () => {
    await createUser({ login: 'thief', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('thief', 'kot12345');
    const stolen = c.cookies.get(AUTH_COOKIES.refresh)!;
    await c.request('POST', '/api/auth/refresh');
    // Отодвигаем момент ротации за пределы окна гонки.
    await testPrisma().refreshToken.update({
      where: { tokenHash: hashToken(stolen) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const attacker = new TestClient(app);
    attacker.cookies.set(AUTH_COOKIES.refresh, stolen);
    attacker.cookies.set(AUTH_COOKIES.csrf, 'csrf-token-for-attacker-test');
    const res = await attacker.request('POST', '/api/auth/refresh');
    expect(res.statusCode).toBe(401);
    expect(await testPrisma().auditLog.count({ where: { action: 'TOKEN_REUSE_DETECTED' } })).toBe(1);
    // Легитимный пользователь тоже разлогинен (семья отозвана).
    expect((await c.request('POST', '/api/auth/refresh')).statusCode).toBe(401);
  });

  it('выход отзывает сессию и удаляет cookie', async () => {
    await createUser({ login: 'bye', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('bye', 'kot12345');
    const refresh = c.cookies.get(AUTH_COOKIES.refresh)!;
    const res = await c.request('POST', '/api/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(c.cookies.has(AUTH_COOKIES.access)).toBe(false);
    const row = await testPrisma().refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(refresh) } });
    expect(row.revokeReason).toBe('logout');
    expect(await testPrisma().auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('выход на всех устройствах', async () => {
    await createUser({ login: 'everywhere', password: 'kot12345' });
    const a = new TestClient(app);
    const b = new TestClient(app);
    await a.login('everywhere', 'kot12345');
    await b.login('everywhere', 'kot12345');
    expect((await a.request('POST', '/api/auth/logout-all')).statusCode).toBe(204);
    expect((await b.request('POST', '/api/auth/refresh')).statusCode).toBe(401);
  });
});

describe('настройки и служебное', () => {
  it('настройки интерфейса сохраняются', async () => {
    await createUser({ login: 'prefs', password: 'kot12345' });
    const c = new TestClient(app);
    await c.login('prefs', 'kot12345');
    const res = await c.request('PATCH', '/api/auth/me/preferences', { theme: 'dark', penOnly: true });
    expect(res.statusCode).toBe(200);
    expect((await c.request('GET', '/api/auth/me')).json().user.preferences).toMatchObject({ theme: 'dark', penOnly: true });
    expect((await c.request('PATCH', '/api/auth/me/preferences', { theme: 'neon' })).statusCode).toBe(400);
    expect((await c.request('PATCH', '/api/auth/me/preferences', { evil: 1 })).statusCode).toBe(400);
  });

  it('health и 404', async () => {
    const c = new TestClient(app);
    expect((await c.request('GET', '/api/health')).json()).toMatchObject({ status: 'ok', db: 'ok' });
    const nf = await c.request('GET', '/api/nope');
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe('NOT_FOUND');
  });
});
