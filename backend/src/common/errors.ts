import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ApiErrorCode } from '@doska/shared';

/** Ошибка приложения с HTTP-статусом и стабильным кодом. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: unknown, message = 'Проверьте правильность заполнения полей') =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Необходимо войти в систему') => new AppError(401, 'UNAUTHENTICATED', message),
  sessionExpired: () => new AppError(401, 'SESSION_EXPIRED', 'Сессия истекла, войдите снова'),
  forbidden: (message = 'Недостаточно прав') => new AppError(403, 'FORBIDDEN', message),
  passwordChangeRequired: () =>
    new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Необходимо сменить временный пароль'),
  notFound: (message = 'Не найдено') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  csrf: () => new AppError(403, 'CSRF_FAILED', 'Сессия устарела, обновите страницу'),
};

/** Сообщения zod → { поле: [сообщения] } для подсветки полей формы. */
export function zodDetails(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Разбор тела/параметров запроса zod-схемой с ошибкой 400. */
export function parseInput<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw Errors.validation(zodDetails(r.error));
  return r.data;
}

function send(reply: FastifyReply, status: number, code: ApiErrorCode, message: string, details?: unknown) {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return reply.status(status).send(body);
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
    return send(reply, error.statusCode, error.code, error.message, error.details);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Нарушение уникальности (гонка между проверкой и записью) и «запись не найдена».
    if (error.code === 'P2002') {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
      return target.includes('login')
        ? send(reply, 409, 'CONFLICT', 'Логин уже занят', { login: ['Логин уже занят'] })
        : send(reply, 409, 'CONFLICT', 'Запись с такими данными уже существует');
    }
    if (error.code === 'P2025') return send(reply, 404, 'NOT_FOUND', 'Не найдено');
  }
  if (error instanceof ZodError) {
    return send(reply, 400, 'VALIDATION_ERROR', 'Проверьте правильность заполнения полей', zodDetails(error));
  }
  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    return send(reply, 429, 'RATE_LIMITED', 'Слишком много запросов. Подождите немного и попробуйте снова');
  }
  if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fe.statusCode === 413) {
    return send(reply, 413, 'PAYLOAD_TOO_LARGE', 'Слишком большой запрос');
  }
  if (fe.validation || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || (fe.statusCode === 400)) {
    return send(reply, 400, 'VALIDATION_ERROR', 'Некорректный запрос');
  }
  if (fe.statusCode === 415) {
    return send(reply, 415, 'VALIDATION_ERROR', 'Неподдерживаемый тип содержимого');
  }
  request.log.error({ err: error }, 'Необработанная ошибка');
  return send(reply, 500, 'INTERNAL', 'Внутренняя ошибка сервера');
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return send(reply, 404, 'NOT_FOUND', 'Не найдено');
}
