import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createVersionSchema } from '@doska/shared';
import { Errors, parseInput } from '../common/errors.js';
import { actorOf } from '../common/actor.js';
import { VersionsService } from './versions.service.js';

const boardParams = z.object({ id: z.string().uuid('Неверный идентификатор') });
const versionParams = boardParams.extend({ vid: z.string().uuid('Неверный идентификатор') });

/**
 * История версий доски (право restoreVersions):
 *   GET  /api/boards/:id/versions                     список (новые сверху)
 *   POST /api/boards/:id/versions                     сохранить версию с подписью
 *   GET  /api/boards/:id/versions/:vid/snapshot       документ версии (Yjs) для предпросмотра
 *   POST /api/boards/:id/versions/:vid/restore        восстановить (у всех — как обычные изменения)
 */
export async function versionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });
  const service = new VersionsService(app);
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });
  const user = (req: { auth: { userId: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' } | null }) => {
    if (!req.auth) throw Errors.unauthenticated();
    return { id: req.auth.userId, role: req.auth.role };
  };

  app.get('/boards/:id/versions', { config: limit(300) }, async (req) => ({ versions: await service.list(user(req), parseInput(boardParams, req.params).id) }));

  app.post('/boards/:id/versions', { config: limit(30) }, async (req, reply) => {
    const version = await service.create(user(req), parseInput(boardParams, req.params).id, parseInput(createVersionSchema, req.body).label);
    return reply.status(201).send({ version });
  });

  app.get('/boards/:id/versions/:vid/snapshot', { config: limit(300) }, async (req, reply) => {
    const p = parseInput(versionParams, req.params);
    const state = await service.snapshot(user(req), p.id, p.vid);
    return reply.type('application/octet-stream').send(Buffer.from(state));
  });

  app.post('/boards/:id/versions/:vid/restore', { config: limit(20) }, async (req) => {
    const p = parseInput(versionParams, req.params);
    return { restored: await service.restore(user(req), p.id, p.vid, actorOf(req)) };
  });
}
