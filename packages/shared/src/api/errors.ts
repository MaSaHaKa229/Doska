/**
 * Формат ошибок REST API:
 *   { "error": { "code": "INVALID_CREDENTIALS", "message": "…", "details"?: … } }
 * Коды стабильны (на них опирается клиент), сообщения — для показа пользователю.
 */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'REFRESH_RACE',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_BLOCKED',
  'WEAK_PASSWORD',
  'CSRF_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Имена cookie и заголовков авторизации. */
export const AUTH_COOKIES = {
  access: 'access_token',
  refresh: 'refresh_token',
  csrf: 'csrf_token',
} as const;

export const CSRF_HEADER = 'x-csrf-token';
