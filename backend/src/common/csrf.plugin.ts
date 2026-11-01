import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AUTH_COOKIES, CSRF_HEADER } from '@doska/shared';
import { Errors } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Защита от CSRF для всех изменяющих запросов к /api:
 *  1) Origin (или Referer, если Origin нет) должен совпадать с PUBLIC_ORIGIN;
 *  2) double submit: заголовок X-CSRF-Token должен совпадать с cookie csrf_token.
 * Злоумышленный сайт не может ни прочитать cookie нашего домена, ни подделать
 * Origin. Дополнительно все cookie имеют SameSite=Strict.
 */
export const csrfPlugin = fp(async (app: FastifyInstance) => {
  const allowed = new Set(app.config.publicOrigins.map((o) => new URL(o).origin));

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (!request.url.startsWith('/api/')) return;

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const source = typeof origin === 'string' ? originOf(origin) : typeof referer === 'string' ? originOf(referer) : undefined;
    if (source === null || (source !== undefined && !allowed.has(source))) {
      request.log.warn({ origin, url: request.url.split('?')[0] }, 'CSRF: чужой Origin');
      throw Errors.csrf();
    }

    const cookie = request.cookies[AUTH_COOKIES.csrf];
    const header = request.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw Errors.csrf();
    }
  });
});
