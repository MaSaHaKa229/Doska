import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@prisma/client';
import { VERSION_REASON_LABELS, type BoardVersionSummary } from '@doska/shared';
import { Errors } from '../common/errors.js';
import { auditBase, type Actor } from '../common/actor.js';
import { loadBoardAccess } from './access.js';
import { restoreFromState } from '../realtime/restore.js';

export interface VersionUser {
  id: string;
  role: UserRole;
}

/** Сколько версий показывать в истории (самые новые). */
const LIST_LIMIT = 200;

/**
 * История версий доски: список, снимок версии, ручная версия, восстановление.
 * Всё — с правом restoreVersions (владелец и соведущий; ученик — в своём
 * конспекте). Изменения документа идут через комнату реального времени:
 * так версия берёт самое свежее состояние, а восстановление сразу
 * приходит всем участникам (Room.applyServerChange).
 */
export class VersionsService {
  constructor(private readonly app: FastifyInstance) {}

  private async requireRestore(user: VersionUser, boardId: string) {
    const access = await loadBoardAccess(this.app.prisma, user, boardId);
    if (!access || !access.caps.view) throw Errors.notFound('Доска не найдена');
    if (!access.caps.restoreVersions) throw Errors.forbidden('Историю версий видит владелец доски и соведущий');
    return access.board;
  }

  /** Комната доски на время операции (загружается при необходимости и отпускается). */
  private async withRoom<T>(boardId: string, fn: (room: Awaited<ReturnType<FastifyInstance['realtime']['acquire']>>) => Promise<T>): Promise<T> {
    const room = await this.app.realtime.acquire(boardId);
    try {
      return await fn(room);
    } finally {
      this.app.realtime.release(room);
    }
  }

  async list(user: VersionUser, boardId: string): Promise<BoardVersionSummary[]> {
    await this.requireRestore(user, boardId);
    const rows = await this.app.prisma.boardVersion.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: { id: true, reason: true, label: true, createdAt: true, objectCount: true, sizeBytes: true, createdBy: { select: { id: true, fullName: true } } },
    });
    return rows.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
  }

  async snapshot(user: VersionUser, boardId: string, versionId: string): Promise<Uint8Array> {
    await this.requireRestore(user, boardId);
    const v = await this.app.prisma.boardVersion.findFirst({ where: { id: versionId, boardId }, select: { state: true } });
    if (!v) throw Errors.notFound('Версия не найдена');
    return v.state;
  }

  async create(user: VersionUser, boardId: string, label: string): Promise<BoardVersionSummary> {
    await this.requireRestore(user, boardId);
    const startedAt = new Date();
    await this.withRoom(boardId, (room) => room.persistence.createVersion('MANUAL', user.id, label));
    const v = await this.app.prisma.boardVersion.findFirst({
      where: { boardId, reason: 'MANUAL', createdById: user.id, createdAt: { gte: new Date(startedAt.getTime() - 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, label: true, createdAt: true, objectCount: true, sizeBytes: true, createdBy: { select: { id: true, fullName: true } } },
    });
    if (!v) throw new Error('Версия не сохранилась');
    return { ...v, createdAt: v.createdAt.toISOString() };
  }

  /**
   * Восстановление: снимок текущего состояния (BEFORE_RESTORE), затем
   * семантическая правка документа к состоянию версии — у всех участников
   * это обычные изменения (docs/SYNC_PROTOCOL.md, раздел 12).
   */
  async restore(user: VersionUser, boardId: string, versionId: string, actor: Actor): Promise<{ pages: number; objects: number }> {
    await this.requireRestore(user, boardId);
    const v = await this.app.prisma.boardVersion.findFirst({ where: { id: versionId, boardId }, select: { id: true, state: true, reason: true, label: true, createdAt: true } });
    if (!v) throw Errors.notFound('Версия не найдена');
    const name = v.label ? `«${v.label}»` : VERSION_REASON_LABELS[v.reason].toLowerCase();
    return this.withRoom(boardId, async (room) => {
      await room.persistence.createVersion('BEFORE_RESTORE', user.id, `Перед восстановлением: ${name}`.slice(0, 200));
      const changed = room.applyServerChange(() => restoreFromState(room.doc, v.state));
      await this.app.audit.record({
        action: 'BOARD_VERSION_RESTORED',
        ...auditBase(actor),
        targetType: 'board',
        targetId: boardId,
        details: { versionId: v.id, reason: v.reason, label: v.label, versionCreatedAt: v.createdAt.toISOString(), ...changed },
      });
      for (const c of room.conns) {
        if (c.ready && !c.lite) c.sendControl({ t: 'notice', level: 'info', code: 'VERSION_RESTORED', message: `Доска восстановлена из версии: ${name}` });
      }
      return changed;
    });
  }
}
