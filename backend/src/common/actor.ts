import type { FastifyRequest } from 'fastify';
import { AuditService } from './audit.js';
import { Errors } from './errors.js';

/** Кто выполняет действие и откуда — для журнала и проверок «не над собой». */
export interface Actor {
  id: string;
  login: string;
  ip: string;
  userAgent: string | null;
}

export function actorOf(request: FastifyRequest): Actor {
  if (!request.auth) throw Errors.unauthenticated();
  return { id: request.auth.userId, login: request.auth.login, ...AuditService.requestMeta(request) };
}

/** Поля журнала, общие для действий актора. */
export function auditBase(actor: Actor) {
  return { actorId: actor.id, actorLogin: actor.login, ip: actor.ip, userAgent: actor.userAgent };
}
