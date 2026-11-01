import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addAssignmentStudentsSchema, createAssignmentSchema, reviewWorkSchema, updateAssignmentSchema } from '@doska/shared';
import { Errors, parseInput } from '../common/errors.js';
import { actorOf } from '../common/actor.js';
import { currentBoardState } from '../realtime/state.js';
import { AssignmentsService } from './assignments.service.js';

const idParams = z.object({ id: z.string().uuid('Неверный идентификатор') });

/**
 * Задания и работы:
 *   GET    /api/assignments                 задания учителя со счётчиками статусов
 *   POST   /api/assignments                 раздать копии доски классу и/или ученикам
 *   GET    /api/assignments/mine            задания ученика (его работы)
 *   GET    /api/assignments/:id             задание и работы (учитель)
 *   PATCH  /api/assignments/:id             название, описание, срок, закрыть/открыть приём
 *   DELETE /api/assignments/:id             удалить задание вместе с работами
 *   POST   /api/assignments/:id/students    выдать ещё ученикам (или новым ученикам класса)
 *   POST   /api/works/:id/submit|unsubmit   сдать работу / отменить сдачу (ученик)
 *   POST   /api/works/:id/review|return     проверено (с отметкой) / вернуть на доработку (учитель)
 */
export async function assignmentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });
  const service = new AssignmentsService(app.prisma, app.audit, app.events, (id, owner) => currentBoardState(app, id, owner));
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });
  const user = (req: { auth: { userId: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' } | null }) => {
    if (!req.auth) throw Errors.unauthenticated();
    return { id: req.auth.userId, role: req.auth.role };
  };
  const id = (req: { params: unknown }) => parseInput(idParams, req.params).id;

  app.get('/assignments', { config: limit(600) }, async (req) => ({ assignments: await service.list(user(req)) }));
  app.get('/assignments/mine', { config: limit(600) }, async (req) => ({ assignments: await service.mine(user(req)) }));
  app.post('/assignments', { config: limit(60) }, async (req, reply) => {
    const assignment = await service.create(user(req), parseInput(createAssignmentSchema, req.body), actorOf(req));
    return reply.status(201).send({ assignment });
  });
  app.get('/assignments/:id', { config: limit(1200) }, async (req) => ({ assignment: await service.get(user(req), id(req)) }));
  app.patch('/assignments/:id', { config: limit(240) }, async (req) => ({
    assignment: await service.update(user(req), id(req), parseInput(updateAssignmentSchema, req.body)),
  }));
  app.delete('/assignments/:id', { config: limit(60) }, async (req, reply) => {
    await service.delete(user(req), id(req));
    return reply.status(204).send();
  });
  app.post('/assignments/:id/students', { config: limit(60) }, async (req) => ({
    assignment: await service.addStudents(user(req), id(req), parseInput(addAssignmentStudentsSchema, req.body)),
  }));

  app.post('/works/:id/submit', { config: limit(120) }, async (req, reply) => {
    await service.submit(user(req), id(req));
    return reply.status(204).send();
  });
  app.post('/works/:id/unsubmit', { config: limit(120) }, async (req, reply) => {
    await service.unsubmit(user(req), id(req));
    return reply.status(204).send();
  });
  app.post('/works/:id/review', { config: limit(600) }, async (req, reply) => {
    await service.review(user(req), id(req), parseInput(reviewWorkSchema, req.body ?? {}).grade);
    return reply.status(204).send();
  });
  app.post('/works/:id/return', { config: limit(600) }, async (req, reply) => {
    await service.returnWork(user(req), id(req));
    return reply.status(204).send();
  });
}
