import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  blockUserSchema,
  classMembersSchema,
  createClassSchema,
  createUserSchema,
  deleteClassSchema,
  deleteUserSchema,
  fullNameSchema,
  importUsersSchema,
  listAuditQuerySchema,
  listClassesQuerySchema,
  listUsersQuerySchema,
  resetClassPasswordsSchema,
  updateClassSchema,
  updateUserSchema,
} from '@doska/shared';
import { parseInput } from '../common/errors.js';
import { actorOf } from '../common/actor.js';
import { UsersService } from '../users/users.service.js';
import { UsersImportService } from '../users/users.import.js';
import { ClassesService } from '../classes/classes.service.js';
import { AuditQueryService } from './audit.service.js';

const idParams = z.object({ id: z.string().uuid('Неверный идентификатор') });
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/**
 * Панель администратора: /api/admin/*. Все маршруты требуют роль ADMIN
 * (проверка в хуке на уровне всего префикса — новый маршрут нельзя
 * случайно оставить без защиты).
 *
 * Пользователи
 *   GET    /users                     список (поиск, роль, класс, статус, сортировка, пагинация)
 *   GET    /users/suggest-login?fullName=  предложить свободный логин
 *   POST   /users                     создать → временный пароль
 *   POST   /users/import              импорт CSV (dryRun — предпросмотр)
 *   GET    /users/:id
 *   PATCH  /users/:id                 ФИО, логин, роль, классы, цвет
 *   POST   /users/:id/block           заблокировать (+ завершить сессии)
 *   POST   /users/:id/unblock         разблокировать (и снять временную блокировку входа)
 *   POST   /users/:id/reset-password  новый временный пароль
 *   DELETE /users/:id                 удалить (тело: confirmLogin)
 * Классы
 *   GET    /classes, POST /classes, GET/PATCH/DELETE /classes/:id
 *   POST   /classes/:id/members       добавить учеников/учителей
 *   DELETE /classes/:id/members/:userId
 *   POST   /classes/:id/reset-passwords  временные пароли ученикам класса
 * Журнал и сводка
 *   GET    /audit                     журнал действий с фильтрами
 *   GET    /stats                     сводка для главной панели
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireRole('ADMIN'));
  app.addHook('onSend', async (_req, reply) => {
    // Ответы содержат персональные данные и временные пароли — не кэшировать.
    reply.header('cache-control', 'no-store');
  });

  const users = new UsersService(app.prisma, app.passwords, app.audit, app.events);
  const importer = new UsersImportService(app.prisma, users, app.audit);
  const classes = new ClassesService(app.prisma, users, app.audit);
  const auditQuery = new AuditQueryService(app.prisma);
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

  // ----- Пользователи -----
  app.get('/users', { config: limit(600) }, async (req) => users.list(parseInput(listUsersQuerySchema, req.query)));

  app.get('/users/suggest-login', { config: limit(600) }, async (req) => {
    const { fullName } = parseInput(z.object({ fullName: fullNameSchema }), req.query);
    return { login: await users.suggestLogin(fullName) };
  });

  app.post('/users', { config: limit(120) }, async (req, reply) => {
    const result = await users.create(parseInput(createUserSchema, req.body), actorOf(req));
    return reply.status(201).send(result);
  });

  app.post('/users/import', { config: limit(30), bodyLimit: 1_200_000 }, async (req) =>
    importer.import(parseInput(importUsersSchema, req.body), actorOf(req)),
  );

  app.get('/users/:id', async (req) => ({ user: await users.get(parseInput(idParams, req.params).id) }));

  app.patch('/users/:id', { config: limit(240) }, async (req) => ({
    user: await users.update(parseInput(idParams, req.params).id, parseInput(updateUserSchema, req.body), actorOf(req)),
  }));

  app.post('/users/:id/block', { config: limit(120) }, async (req) => ({
    user: await users.block(parseInput(idParams, req.params).id, parseInput(blockUserSchema, req.body ?? {}).reason, actorOf(req)),
  }));

  app.post('/users/:id/unblock', { config: limit(120) }, async (req) => ({
    user: await users.unblock(parseInput(idParams, req.params).id, actorOf(req)),
  }));

  app.post('/users/:id/reset-password', { config: limit(120) }, async (req) => ({
    credential: await users.resetPassword(parseInput(idParams, req.params).id, actorOf(req)),
  }));

  app.delete('/users/:id', { config: limit(60) }, async (req, reply) => {
    const { confirmLogin } = parseInput(deleteUserSchema, req.body ?? {});
    await users.delete(parseInput(idParams, req.params).id, confirmLogin, actorOf(req));
    return reply.status(204).send();
  });

  // ----- Классы -----
  app.get('/classes', { config: limit(600) }, async (req) => classes.list(parseInput(listClassesQuerySchema, req.query)));

  app.post('/classes', { config: limit(120) }, async (req, reply) => {
    const created = await classes.create(parseInput(createClassSchema, req.body), actorOf(req));
    return reply.status(201).send({ class: created });
  });

  app.get('/classes/:id', async (req) => ({ class: await classes.get(parseInput(idParams, req.params).id) }));

  app.patch('/classes/:id', { config: limit(240) }, async (req) => ({
    class: await classes.update(parseInput(idParams, req.params).id, parseInput(updateClassSchema, req.body), actorOf(req)),
  }));

  app.delete('/classes/:id', { config: limit(60) }, async (req, reply) => {
    const { confirmName } = parseInput(deleteClassSchema, req.body ?? {});
    await classes.delete(parseInput(idParams, req.params).id, confirmName, actorOf(req));
    return reply.status(204).send();
  });

  app.post('/classes/:id/members', { config: limit(240) }, async (req) => ({
    class: await classes.addMembers(
      parseInput(idParams, req.params).id,
      parseInput(classMembersSchema, req.body).userIds,
      actorOf(req),
    ),
  }));

  app.delete('/classes/:id/members/:userId', { config: limit(240) }, async (req) => {
    const p = parseInput(memberParams, req.params);
    return { class: await classes.removeMember(p.id, p.userId, actorOf(req)) };
  });

  app.post('/classes/:id/reset-passwords', { config: limit(20) }, async (req) => ({
    credentials: await classes.resetPasswords(
      parseInput(idParams, req.params).id,
      parseInput(resetClassPasswordsSchema, req.body ?? {}).onlyPending,
      actorOf(req),
    ),
  }));

  // ----- Журнал и сводка -----
  app.get('/audit', { config: limit(600) }, async (req) => auditQuery.list(parseInput(listAuditQuerySchema, req.query)));
  app.get('/stats', { config: limit(600) }, async () => users.stats());
}
