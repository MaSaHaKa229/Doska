import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, http, setHttpHooks } from './http';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, setCookie?: string) {
  if (setCookie) document.cookie = setCookie;
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let calls: { url: string; init: RequestInit }[] = [];
function mockFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

beforeEach(() => {
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});
afterEach(() => {
  vi.unstubAllGlobals();
  setHttpHooks({ onSessionLost: undefined, onPasswordChangeRequired: undefined });
});

describe('REST-клиент', () => {
  it('получает CSRF-токен перед первым изменяющим запросом и передаёт его в заголовке', async () => {
    mockFetch((url) => {
      if (url === '/api/auth/csrf') return json(200, { csrfToken: 'tok123' }, 'csrf_token=tok123');
      return json(200, { ok: true });
    });
    await http.post('/api/x', { a: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/csrf', '/api/x']);
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('tok123');
    expect(headers['content-type']).toBe('application/json');
    expect(calls[1]!.init.body).toBe('{"a":1}');
    expect(calls[1]!.init.credentials).toBe('same-origin');
  });

  it('GET не требует CSRF', async () => {
    mockFetch(() => json(200, { items: [] }));
    await http.get('/api/y', { query: { search: 'а б', empty: '', role: undefined, list: ['A', 'B'] } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/y?search=%D0%B0+%D0%B1&list=A%2CB');
  });

  it('при 401 обновляет сессию один раз и повторяет запрос', async () => {
    document.cookie = 'csrf_token=t';
    let meCalls = 0;
    mockFetch((url) => {
      if (url === '/api/auth/refresh') return json(200, { user: {} });
      if (url === '/api/me') {
        meCalls++;
        return meCalls === 1 ? json(401, { error: { code: 'SESSION_EXPIRED', message: 'истекла' } }) : json(200, { ok: 1 });
      }
      return json(404, {});
    });
    await expect(http.get('/api/me')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
  });

  it('параллельные 401 используют одно обновление сессии', async () => {
    document.cookie = 'csrf_token=t';
    const seen = new Map<string, number>();
    mockFetch(async (url) => {
      if (url === '/api/auth/refresh') {
        await new Promise((r) => setTimeout(r, 10));
        return json(200, {});
      }
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      return n === 1 ? json(401, { error: { code: 'SESSION_EXPIRED', message: '' } }) : json(200, { url });
    });
    await Promise.all([http.get('/api/a'), http.get('/api/b'), http.get('/api/c')]);
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('REFRESH_RACE (другая вкладка уже обновила сессию) считается успехом', async () => {
    document.cookie = 'csrf_token=t';
    let n = 0;
    mockFetch((url) => {
      if (url === '/api/auth/refresh') return json(409, { error: { code: 'REFRESH_RACE', message: '' } });
      return ++n === 1 ? json(401, { error: { code: 'SESSION_EXPIRED', message: '' } }) : json(200, { ok: true });
    });
    await expect(http.get('/api/z')).resolves.toEqual({ ok: true });
  });

  it('если обновить сессию нельзя — вызывается onSessionLost', async () => {
    document.cookie = 'csrf_token=t';
    const lost = vi.fn();
    setHttpHooks({ onSessionLost: lost });
    mockFetch((url) =>
      url === '/api/auth/refresh'
        ? json(401, { error: { code: 'SESSION_EXPIRED', message: '' } })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Необходимо войти' } }),
    );
    await expect(http.get('/api/q')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(lost).toHaveBeenCalledOnce();
  });

  it('ошибка входа не запускает обновление сессии', async () => {
    document.cookie = 'csrf_token=t';
    mockFetch(() => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль' } }));
    await expect(http.post('/api/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('CSRF_FAILED: перезапрос токена и повтор', async () => {
    document.cookie = 'csrf_token=old';
    let n = 0;
    mockFetch((url) => {
      if (url === '/api/auth/csrf') return json(200, {}, 'csrf_token=new');
      return ++n === 1 ? json(403, { error: { code: 'CSRF_FAILED', message: '' } }) : json(204, undefined);
    });
    await expect(http.post('/api/w')).resolves.toBeUndefined();
    const last = calls[calls.length - 1]!.init.headers as Record<string, string>;
    expect(last['x-csrf-token']).toBe('new');
  });

  it('ошибки по полям и требование смены пароля', async () => {
    document.cookie = 'csrf_token=t';
    const pwd = vi.fn();
    setHttpHooks({ onPasswordChangeRequired: pwd });
    mockFetch((url) =>
      url === '/api/form'
        ? json(400, { error: { code: 'VALIDATION_ERROR', message: 'Проверьте', details: { login: ['занят'], other: 5 } } })
        : json(403, { error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Смените пароль' } }),
    );
    const err = (await http.post('/api/form', {}).catch((e) => e)) as ApiError;
    expect(err.fieldErrors).toEqual({ login: ['занят'] });
    await http.get('/api/other').catch(() => undefined);
    expect(pwd).toHaveBeenCalledOnce();
  });

  it('нет сети — понятная ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(http.get('/api/n')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
