import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import { BoardPersistence } from './persistence.js';

/**
 * Текущее состояние документа доски: из загруженной комнаты (самое свежее,
 * включая ещё не записанные изменения) или из БД (снимок + журнал).
 * Используется для копий задания и для миниатюр в списках.
 */
export async function currentBoardState(app: FastifyInstance, boardId: string, ownerId: string): Promise<Uint8Array> {
  const room = await app.realtime?.peek(boardId);
  if (room) return Y.encodeStateAsUpdate(room.doc);
  const doc = await BoardPersistence.load(app.prisma, boardId, ownerId);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
