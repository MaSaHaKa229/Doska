import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { sanitizeDetails } from './logger.js';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  actorLogin?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Журнал действий. Ошибка записи в журнал не должна ломать основное действие,
 * поэтому она только логируется.
 */
export class AuditService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          actorLogin: entry.actorLogin?.slice(0, 64) ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          ip: entry.ip?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          details: (sanitizeDetails(entry.details ?? {}) ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (tx) throw err;
      this.log.error({ err, action: entry.action }, 'Не удалось записать событие в журнал действий');
    }
  }

  /** IP и User-Agent запроса для записи в журнал. */
  static requestMeta(request: FastifyRequest): { ip: string; userAgent: string | null } {
    const ua = request.headers['user-agent'];
    return { ip: request.ip, userAgent: typeof ua === 'string' ? ua : null };
  }
}
