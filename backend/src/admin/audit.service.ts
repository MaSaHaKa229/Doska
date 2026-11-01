import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { AuditActionName, AuditEntryView, Paginated, listAuditQuerySchema } from '@doska/shared';

type Query = z.infer<typeof listAuditQuerySchema>;

/** Просмотр журнала действий с фильтрами (кто, что, когда). */
export class AuditQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(q: Query): Promise<Paginated<AuditEntryView>> {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.actions?.length) and.push({ action: { in: q.actions } });
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.targetId) and.push({ targetId: q.targetId });
    if (q.from) and.push({ createdAt: { gte: q.from } });
    if (q.to) and.push({ createdAt: { lte: q.to } });
    if (q.search) {
      and.push({
        OR: [
          { actorLogin: { contains: q.search.toLowerCase() } },
          { actor: { fullName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, login: true, fullName: true, deletedAt: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    // Подписи целей: ФИО пользователей и названия классов одним запросом на тип.
    const userIds = [...new Set(rows.filter((r) => r.targetType === 'user' && r.targetId).map((r) => r.targetId!))];
    const classIds = [...new Set(rows.filter((r) => r.targetType === 'class' && r.targetId).map((r) => r.targetId!))];
    const [users, classes] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
        : [],
      classIds.length ? this.prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } }) : [],
    ]);
    const labels = new Map<string, string>([
      ...users.map((u) => [u.id, u.fullName] as [string, string]),
      ...classes.map((c) => [c.id, c.name] as [string, string]),
    ]);

    return {
      items: rows.map((r) => {
        const details = r.details as Record<string, unknown>;
        const fallback =
          typeof details?.name === 'string'
            ? details.name
            : typeof details?.fullName === 'string'
              ? details.fullName
              : typeof details?.login === 'string'
                ? details.login
                : null;
        return {
          id: r.id.toString(),
          action: r.action as AuditActionName,
          createdAt: r.createdAt.toISOString(),
          actor: r.actor
            ? { id: r.actor.id, login: r.actor.deletedAt ? (r.actorLogin ?? r.actor.login) : r.actor.login, fullName: r.actor.fullName }
            : null,
          actorLogin: r.actorLogin,
          targetType: r.targetType,
          targetId: r.targetId,
          targetLabel: (r.targetId && labels.get(r.targetId)) || fallback,
          ip: r.ip,
          userAgent: r.userAgent,
          details: r.details,
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
