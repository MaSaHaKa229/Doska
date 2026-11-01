import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createBoardSchema,
  createFolderSchema,
  listBoardsQuerySchema,
  setBoardAccessSchema,
  updateBoardSchema,
  directoryQuerySchema,
  updateFolderSchema,
} from '@doska/shared';
import { Errors, parseInput } from '../common/errors.js';
import { actorOf } from '../common/actor.js';
import { BoardsService } from './boards.service.js';
import { FoldersService } from './folders.service.js';
import { currentBoardState } from '../realtime/state.js';

const idParams = z.object({ id: z.string().uuid('Неверный идентификатор') });

/**
 * Доски и папки:
 *   GET    /api/boards                 список (scope own/shared/all, папка, поиск, сортировка)
 *   POST   /api/boards                 создать (учитель — урок, ученик — конспект)
 *   GET    /api/boards/:id             свойства, мои права, доступ (для учителя)
 *   GET    /api/boards/:id/people      люди доски (подписи авторов)
 *   GET    /api/boards/:id/snapshot    документ доски (Yjs) для миниатюр
 *   PATCH  /api/boards/:id             название, описание, папка, настройки
 *   PUT    /api/boards/:id/access      классы и участники (полная замена)
 *   DELETE /api/boards/:id             удалить (владелец)
 *   GET    /api/boards/my-classes      классы учителя для выдачи досок
 *   GET    /api/directory/users        поиск учеников и учителей для выдачи доступа (учитель)
 *   GET/POST /api/folders, PATCH/DELETE /api/folders/:id
 */
export async function boardsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });
  const boards = new BoardsService(app.prisma, app.audit, app.events);
  const folders = new FoldersService(app.prisma);
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });
  const user = (req: { auth: { userId: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' } | null }) => {
    if (!req.auth) throw Errors.unauthenticated();
    return { id: req.auth.userId, role: req.auth.role };
  };

  app.get('/boards', { config: limit(600) }, async (req) => boards.list(user(req), parseInput(listBoardsQuerySchema, req.query)));

  app.get('/directory/users', { config: limit(600) }, async (req) => ({
    users: await boards.directory(user(req), parseInput(directoryQuerySchema, req.query)),
  }));

  app.get('/boards/my-classes', { config: limit(300) }, async (req) => ({ classes: await boards.myClasses(user(req)) }));

  app.post('/boards', { config: limit(120) }, async (req, reply) => {
    const board = await boards.create(user(req), parseInput(createBoardSchema, req.body), actorOf(req));
    return reply.status(201).send({ board });
  });

  app.get('/boards/:id', { config: limit(600) }, async (req) => ({
    board: await boards.get(user(req), parseInput(idParams, req.params).id),
  }));

  // Документ доски целиком (Yjs) — для миниатюр в списках, рисуются в браузере.
  app.get('/boards/:id/snapshot', { config: limit(1200) }, async (req, reply) => {
    const boardId = parseInput(idParams, req.params).id;
    const board = await boards.requireView(user(req), boardId);
    const state = await currentBoardState(app, boardId, board.ownerId);
    return reply.type('application/octet-stream').send(Buffer.from(state));
  });

  app.get('/boards/:id/people', { config: limit(300) }, async (req) => ({
    people: await boards.people(user(req), parseInput(idParams, req.params).id),
  }));

  app.patch('/boards/:id', { config: limit(240) }, async (req) => ({
    board: await boards.update(user(req), parseInput(idParams, req.params).id, parseInput(updateBoardSchema, req.body), actorOf(req)),
  }));

  app.put('/boards/:id/access', { config: limit(120) }, async (req) => ({
    access: await boards.setAccess(user(req), parseInput(idParams, req.params).id, parseInput(setBoardAccessSchema, req.body), actorOf(req)),
  }));

  app.delete('/boards/:id', { config: limit(120) }, async (req, reply) => {
    await boards.delete(user(req), parseInput(idParams, req.params).id, actorOf(req));
    return reply.status(204).send();
  });

  // ----- Папки (только свои; администратору не нужны) -----
  const folderOwner = (req: Parameters<typeof user>[0]) => {
    const u = user(req);
    if (u.role === 'ADMIN') throw Errors.forbidden();
    return u.id;
  };

  app.get('/folders', { config: limit(600) }, async (req) => ({ folders: await folders.list(folderOwner(req)) }));

  app.post('/folders', { config: limit(120) }, async (req, reply) => {
    const input = parseInput(createFolderSchema, req.body);
    const folder = await folders.create(folderOwner(req), input.name, input.parentId ?? null);
    return reply.status(201).send({ folder });
  });

  app.patch('/folders/:id', { config: limit(240) }, async (req) => ({
    folder: await folders.update(folderOwner(req), parseInput(idParams, req.params).id, parseInput(updateFolderSchema, req.body)),
  }));

  app.delete('/folders/:id', { config: limit(120) }, async (req, reply) => {
    await folders.delete(folderOwner(req), parseInput(idParams, req.params).id);
    return reply.status(204).send();
  });
}
