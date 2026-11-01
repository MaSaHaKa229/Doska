import * as Y from 'yjs';
import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { DOC_ROOTS } from '@doska/shared';
import { createInitialDocState } from './doc.js';

export interface PersistenceOptions {
  /** Как часто писать накопленные обновления в BoardUpdate. */
  flushIntervalMs: number;
  /** Компактация не реже этого интервала (при наличии изменений)… */
  compactIntervalMs: number;
  /** …или после такого числа записей в журнале. */
  compactEveryUpdates: number;
  /** Автоматическая версия не чаще этого интервала активного редактирования. */
  versionIntervalMs: number;
  /** Сколько автоматических версий хранить. */
  keepAutoVersions: number;
}

export const DEFAULT_PERSISTENCE: PersistenceOptions = {
  flushIntervalMs: 1000,
  compactIntervalMs: 60_000,
  compactEveryUpdates: 500,
  versionIntervalMs: 10 * 60_000,
  keepAutoVersions: 50,
};

/**
 * Хранение Yjs-документа доски в PostgreSQL.
 *
 *   принятое обновление → буфер → (раз в 1 с) INSERT BoardUpdate(merge(буфер))
 *   каждые 60 с или 500 записей: снимок encodeStateAsUpdate → BoardDocument,
 *   записи журнала, вошедшие в снимок, удаляются (в одной транзакции)
 *
 * При падении процесса теряется не более ~1 с работы. Повторное применение
 * обновлений, уже вошедших в снимок, безопасно — Yjs идемпотентен.
 * Все операции записи выполняются последовательно (цепочка промисов).
 */
export class BoardPersistence {
  private pending: Uint8Array[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private updatesSinceCompact = 0;
  private lastCompactAt = Date.now();
  private dirtySinceCompact = false;
  private lastVersionAt = Date.now();
  private dirtySinceVersion = false;
  private closed = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly boardId: string,
    private readonly doc: Y.Doc,
    private readonly log: FastifyBaseLogger,
    private readonly opts: PersistenceOptions = DEFAULT_PERSISTENCE,
  ) {}

  /** Загрузка документа: снимок + журнал после него. Документа нет — создаётся начальный. */
  static async load(prisma: PrismaClient, boardId: string, ownerId: string): Promise<Y.Doc> {
    const doc = new Y.Doc({ gc: true });
    const stored = await prisma.boardDocument.findUnique({ where: { boardId } });
    if (stored) {
      Y.applyUpdate(doc, stored.state);
      const updates = await prisma.boardUpdate.findMany({
        where: { boardId, seq: { gt: stored.compactedSeq } },
        orderBy: { seq: 'asc' },
        select: { data: true },
      });
      for (const u of updates) Y.applyUpdate(doc, u.data);
    } else {
      const state = createInitialDocState(ownerId);
      Y.applyUpdate(doc, state);
      await prisma.boardDocument.upsert({
        where: { boardId },
        create: { boardId, state: Buffer.from(state), stateVector: Buffer.from(Y.encodeStateVector(doc)), sizeBytes: state.byteLength },
        update: {},
      });
    }
    return doc;
  }

  /** Поставить принятое (уже проверенное) обновление в очередь на запись. */
  enqueue(update: Uint8Array): void {
    if (this.closed) return;
    this.pending.push(update);
    this.dirtySinceCompact = true;
    this.dirtySinceVersion = true;
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.opts.flushIntervalMs);
  }

  private run(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch((err) => {
      this.log.error({ err, boardId: this.boardId }, 'Ошибка сохранения доски');
    });
    return this.chain;
  }

  /** Записать буфер в журнал; при необходимости — компактация и автоверсия. */
  flush(): Promise<void> {
    return this.run(async () => {
      if (this.pending.length) {
        const batch = this.pending;
        this.pending = [];
        const merged = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
        try {
          await this.prisma.boardUpdate.create({ data: { boardId: this.boardId, data: Buffer.from(merged) } });
          this.updatesSinceCompact++;
        } catch (err) {
          // Не теряем изменения: вернём в буфер, следующая попытка — по таймеру.
          this.pending.unshift(merged);
          this.flushTimer ??= setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
          }, this.opts.flushIntervalMs * 5);
          throw err;
        }
      }
      const now = Date.now();
      if (
        this.dirtySinceCompact &&
        (this.updatesSinceCompact >= this.opts.compactEveryUpdates || now - this.lastCompactAt >= this.opts.compactIntervalMs)
      ) {
        await this.compactNow();
      }
      if (this.dirtySinceVersion && now - this.lastVersionAt >= this.opts.versionIntervalMs) {
        await this.createVersionNow('AUTO', null, null);
      }
    });
  }

  /** Компактация: полный снимок в BoardDocument, журнал до снимка удаляется. */
  compact(): Promise<void> {
    return this.flush().then(() => this.run(() => this.compactNow()));
  }

  private async compactNow(): Promise<void> {
    const state = Y.encodeStateAsUpdate(this.doc);
    const sv = Y.encodeStateVector(this.doc);
    const objectCount = this.doc.getMap(DOC_ROOTS.objects).size;
    const pageCount = this.doc.getMap(DOC_ROOTS.pages).size;
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.boardUpdate.findFirst({
        where: { boardId: this.boardId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      const seq = last?.seq ?? 0n;
      await tx.boardDocument.upsert({
        where: { boardId: this.boardId },
        create: {
          boardId: this.boardId,
          state: Buffer.from(state),
          stateVector: Buffer.from(sv),
          compactedSeq: seq,
          sizeBytes: state.byteLength,
        },
        update: { state: Buffer.from(state), stateVector: Buffer.from(sv), compactedSeq: seq, sizeBytes: state.byteLength },
      });
      if (last) await tx.boardUpdate.deleteMany({ where: { boardId: this.boardId, seq: { lte: seq } } });
      await tx.board.update({
        where: { id: this.boardId },
        data: { objectCount, pageCount, lastActivityAt: new Date() },
      });
    });
    this.updatesSinceCompact = 0;
    this.lastCompactAt = Date.now();
    this.dirtySinceCompact = false;
  }

  /** Снимок в историю версий (AUTO — с ограничением числа хранимых). */
  createVersion(
    reason: 'AUTO' | 'MANUAL' | 'BEFORE_RESTORE' | 'BEFORE_CLEAR',
    createdById: string | null,
    label: string | null,
  ): Promise<void> {
    return this.run(() => this.createVersionNow(reason, createdById, label));
  }

  private async createVersionNow(
    reason: 'AUTO' | 'MANUAL' | 'BEFORE_RESTORE' | 'BEFORE_CLEAR',
    createdById: string | null,
    label: string | null,
  ): Promise<void> {
    const state = Y.encodeStateAsUpdate(this.doc);
    await this.prisma.boardVersion.create({
      data: {
        boardId: this.boardId,
        reason,
        label,
        createdById,
        state: Buffer.from(state),
        sizeBytes: state.byteLength,
        objectCount: this.doc.getMap(DOC_ROOTS.objects).size,
      },
    });
    this.lastVersionAt = Date.now();
    this.dirtySinceVersion = false;
    if (reason === 'AUTO') {
      const old = await this.prisma.boardVersion.findMany({
        where: { boardId: this.boardId, reason: 'AUTO' },
        orderBy: { createdAt: 'desc' },
        skip: this.opts.keepAutoVersions,
        select: { id: true },
      });
      if (old.length) await this.prisma.boardVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
    }
  }

  /** Финальное сохранение перед выгрузкой комнаты. */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    if (this.dirtySinceCompact || this.updatesSinceCompact > 0) await this.run(() => this.compactNow());
    this.closed = true;
  }
}
