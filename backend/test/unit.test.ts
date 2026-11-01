import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from '@doska/shared';
import { PasswordHasher, generateTempPassword } from '../src/auth/password.js';
import { TokenService } from '../src/auth/tokens.js';
import { sanitizeDetails } from '../src/common/logger.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import * as Y from 'yjs';
import { removeObjects } from '../src/realtime/lesson.js';

describe('пароли', () => {
  it('временный пароль соответствует политике и читаем', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{4}$/);
      expect(p).not.toMatch(/[01lo]/);
      expect(checkPasswordPolicy(p)).toEqual([]);
    }
  });

  it('argon2id: хеш и проверка', async () => {
    const h = new PasswordHasher({ memoryCost: 1024, timeCost: 1 });
    const hash = await h.hash('kot12345');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await h.verify(hash, 'kot12345')).toBe(true);
    expect(await h.verify(hash, 'kot12346')).toBe(false);
    expect(await h.verify('мусор', 'kot12345')).toBe(false);
    expect(await h.verifyDummy('x')).toBe(false);
    expect(new PasswordHasher({ memoryCost: 2048, timeCost: 1 }).needsRehash(hash)).toBe(true);
  });
});

describe('токены', () => {
  const secret = new TextEncoder().encode('x'.repeat(40));
  it('подпись и проверка access-токена', async () => {
    const t = new TokenService(secret, 60, 3600);
    const jwt = await t.signAccess({ sub: 'u1', role: 'TEACHER', pwd: false, sid: 's1' });
    expect(await t.verifyAccess(jwt)).toMatchObject({ sub: 'u1', role: 'TEACHER', pwd: false, sid: 's1' });
    const other = new TokenService(new TextEncoder().encode('y'.repeat(40)), 60, 3600);
    expect(await other.verifyAccess(jwt)).toBeNull();
    expect(await t.verifyAccess(jwt.slice(0, -2) + 'aa')).toBeNull();
  });
  it('истёкший токен распознаётся', async () => {
    const t = new TokenService(secret, 1, 3600);
    const jwt = await t.signAccess({ sub: 'u1', role: 'STUDENT', pwd: false, sid: 's1' });
    await new Promise((r) => setTimeout(r, 2100));
    expect(await t.verifyAccess(jwt)).toBe('expired');
  });
  it('refresh-токены случайны', () => {
    const t = new TokenService(secret, 60, 3600);
    const a = t.generateRefreshToken();
    const b = t.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('журнал и конфигурация', () => {
  it('секреты вырезаются из деталей журнала', () => {
    expect(
      sanitizeDetails({ login: 'a', password: 'p', nested: { refreshToken: 't', ok: 1 }, list: [{ passwordHash: 'h' }] }),
    ).toEqual({ login: 'a', password: '[скрыто]', nested: { refreshToken: '[скрыто]', ok: 1 }, list: [{ passwordHash: '[скрыто]' }] });
  });

  it('понятная ошибка конфигурации без значений секретов', () => {
    try {
      loadConfig({ DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'short-secret', PUBLIC_ORIGIN: 'https://a.ru' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain('JWT_ACCESS_SECRET');
      expect(msg).not.toContain('short-secret');
    }
  });

  it('значения по умолчанию', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgresql://a:b@localhost/db',
      JWT_ACCESS_SECRET: 'z'.repeat(32),
      PUBLIC_ORIGIN: 'https://a.ru/, https://b.ru',
      NODE_ENV: 'production',
    });
    expect(c.publicOrigins).toEqual(['https://a.ru', 'https://b.ru']);
    expect(c.cookieSecure).toBe(true);
    expect(c.jwt.accessTtlSeconds).toBe(900);
    expect(c.argon2.memoryCost).toBe(65536);
  });
});

describe('удаление объектов сервером (очистка)', () => {
  function docWith(objs: { id: string; type?: string; groupId?: string | null }[]) {
    const doc = new Y.Doc();
    const map = doc.getMap('objects');
    for (const o of objs) map.set(o.id, new Y.Map<unknown>([['type', o.type ?? 'core.stroke'], ['groupId', o.groupId ?? null]]));
    return { doc, map: map as Y.Map<Y.Map<unknown>> };
  }

  it('пустые группы удаляются по цепочке, дети удалённой группы переходят к её родителю', () => {
    const { doc, map } = docWith([
      { id: 'outer', type: 'core.group' },
      { id: 'inner', type: 'core.group', groupId: 'outer' },
      { id: 'a', groupId: 'inner' },
      { id: 'b', groupId: 'inner' },
      { id: 'g2', type: 'core.group' },
      { id: 'c', groupId: 'g2' },
      { id: 'keep', groupId: 'g2' },
    ]);
    // Удаляются все дети inner (а затем пустые inner и outer) и сама g2 — её ребёнок keep остаётся без группы.
    expect(removeObjects(doc, ['a', 'b', 'g2', 'c', 'missing'])).toBe(6);
    expect([...map.keys()]).toEqual(['keep']);
    expect(map.get('keep')!.get('groupId')).toBeNull();
  });

  it('группа с оставшимися детьми сохраняется', () => {
    const { doc, map } = docWith([{ id: 'g', type: 'core.group' }, { id: 'x', groupId: 'g' }, { id: 'y', groupId: 'g' }]);
    expect(removeObjects(doc, ['x'])).toBe(1);
    expect([...map.keys()].sort()).toEqual(['g', 'y']);
  });
});
