import { AUTH_COOKIES, CSRF_HEADER, type ApiErrorBody } from '@doska/shared';

/**
 * REST-клиент.
 *
 *  - Токены лежат в httpOnly-cookie, JavaScript их не видит; запросы идут с
 *    credentials: 'same-origin'.
 *  - Для изменяющих запросов значение cookie csrf_token повторяется в
 *    заголовке X-CSRF-Token (double submit). Если cookie ещё нет — сначала
 *    GET /api/auth/csrf.
 *  - На 401 (истёк access-токен) клиент один раз обновляет сессию через
 *    POST /api/auth/refresh и повторяет запрос. Параллельные запросы ждут
 *    одно и то же обновление (single flight). Ответ REFRESH_RACE означает,
 *    что сессию уже обновила другая вкладка, — cookie свежие, можно повторять.
 *  - Если обновить сессию не удалось — вызывается onSessionLost (переход на вход).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Ошибки по полям формы: { поле: [сообщения] }. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[];
      }
      return out;
    }
    return {};
  }
}

export interface HttpHooks {
  onSessionLost?: () => void;
  onPasswordChangeRequired?: () => void;
}

const hooks: HttpHooks = {};
export function setHttpHooks(h: HttpHooks): void {
  Object.assign(hooks, h);
}

export function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_REFRESH_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/csrf'];

let refreshing: Promise<boolean> | null = null;
let csrfLoading: Promise<void> | null = null;

async function ensureCsrf(force = false): Promise<void> {
  if (!force && readCookie(AUTH_COOKIES.csrf)) return;
  csrfLoading ??= fetch('/api/auth/csrf', { credentials: 'same-origin' })
    .then(() => undefined)
    .finally(() => {
      csrfLoading = null;
    });
  await csrfLoading;
}

/** Обновление сессии; true — успешно (или уже обновлена другой вкладкой). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      await ensureCsrf();
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { [CSRF_HEADER]: readCookie(AUTH_COOKIES.csrf) ?? '' },
      });
      if (res.ok) return true;
      if (res.status === 409) return true; // REFRESH_RACE
      return false;
    } catch {
      return false;
    }
  })().finally(() => {
    // Ожидающие уже держат ссылку на этот промис — «замок» можно снимать сразу.
    refreshing = null;
  });
  return refreshing;
}

export interface RequestOptions {
  body?: unknown;
  /** Тело как есть (файл) вместо JSON. */
  raw?: { data: Blob; contentType: string; headers?: Record<string, string> };
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* не JSON */
  }
  if (body?.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(res.status, 'SERVICE_UNAVAILABLE', 'Сервер временно недоступен. Попробуйте через минуту');
  }
  return new ApiError(res.status, 'INTERNAL', `Ошибка сервера (${res.status})`);
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const unsafe = UNSAFE.has(method);
  let csrfRetried = false;
  let refreshed = false;

  for (;;) {
    if (unsafe) await ensureCsrf();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.raw) Object.assign(headers, opts.raw.headers, { 'content-type': opts.raw.contentType });
    else if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (unsafe) headers[CSRF_HEADER] = readCookie(AUTH_COOKIES.csrf) ?? '';

    let res: Response;
    try {
      res = await fetch(buildUrl(path, opts.query), {
        method,
        headers,
        credentials: 'same-origin',
        body: opts.raw ? opts.raw.data : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверьте подключение к интернету');
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    const error = await parseError(res);

    if (res.status === 401 && !refreshed && !NO_REFRESH_PATHS.includes(path) && error.code !== 'ACCOUNT_BLOCKED') {
      refreshed = true;
      if (await refreshSession()) continue;
      hooks.onSessionLost?.();
      throw error;
    }
    if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
      hooks.onSessionLost?.();
    }
    if (error.code === 'CSRF_FAILED' && !csrfRetried) {
      csrfRetried = true;
      await ensureCsrf(true);
      continue;
    }
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') hooks.onPasswordChangeRequired?.();
    throw error;
  }
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  delete: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('DELETE', path, { ...opts, body }),
};

/** Текст ошибки для показа пользователю. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === 'AbortError') return '';
  return 'Что-то пошло не так. Попробуйте ещё раз';
}
