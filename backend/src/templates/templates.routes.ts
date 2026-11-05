import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTemplateSchema, listTemplatesQuerySchema, updateTemplateSchema, useTemplateSchema } from '@doska/shared';
import { Errors, parseInput } from '../common/errors.js';
import { actorOf } from '../common/actor.js';
import { currentBoardState } from '../realtime/state.js';
import { TemplatesService } from './templates.service.js';

const idParams = z.object({ id: z.string().uuid('Неверный идентификатор') });

/**
 * Библиотека шаблонов:
 *   GET    /api/templates            список (видимые: встроенные, свои, общие; поиск, раздел, уровень)
 *   POST   /api/templates            сохранить доску как шаблон (копия содержимого)
 *   GET    /api/templates/:id        шаблон
 *   PATCH  /api/templates/:id        описание и видимость (автор)
 *   DELETE /api/templates/:id        удалить (автор)
 *   POST   /api/templates/:id/use    создать доску урока из шаблона
 */
export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });
  const service = new TemplatesService(app.prisma, app.audit, (id, owner) => currentBoardState(app, id, owner));
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });
  const user = (req: { auth: { userId: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' } | null }) => {
    if (!req.auth) throw Errors.unauthenticated();
    return { id: req.auth.userId, role: req.auth.role };
  };

  app.get('/templates', { config: limit(600) }, async (req) => service.list(user(req), parseInput(listTemplatesQuerySchema, req.query)));

  app.post('/templates', { config: limit(60) }, async (req, reply) => {
    const template = await service.create(user(req), parseInput(createTemplateSchema, req.body), actorOf(req));
    return reply.status(201).send({ template });
  });

  app.get('/templates/:id', { config: limit(600) }, async (req) => ({ template: await service.get(user(req), parseInput(idParams, req.params).id) }));

  app.patch('/templates/:id', { config: limit(240) }, async (req) => ({
    template: await service.update(user(req), parseInput(idParams, req.params).id, parseInput(updateTemplateSchema, req.body), actorOf(req)),
  }));

  app.delete('/templates/:id', { config: limit(120) }, async (req, reply) => {
    await service.delete(user(req), parseInput(idParams, req.params).id, actorOf(req));
    return reply.status(204).send();
  });

  app.post('/templates/:id/use', { config: limit(120) }, async (req, reply) => {
    const res = await service.use(user(req), parseInput(idParams, req.params).id, parseInput(useTemplateSchema, req.body ?? {}), actorOf(req));
    return reply.status(201).send(res);
  });
}
