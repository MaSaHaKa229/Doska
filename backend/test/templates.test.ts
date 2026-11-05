import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import { BUILTIN_TEMPLATES } from '@doska/shared';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { ensureBuiltinTemplates } from '../src/templates/builtin.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});

let t1: TestClient;
let t2: TestClient;
let t3: TestClient;
let st: TestClient;
let ids: { t1: string; t2: string; t3: string; board: string; cls: string };

beforeEach(async () => {
  await resetDb(testPrisma(), app);
  await createUser({ login: 'admin', password: 'kot12345', role: 'ADMIN', fullName: 'Админ' });
  const a = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Один' });
  const b = await createUser({ login: 'teacher2', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Два' });
  const c = await createUser({ login: 'teacher3', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Три' });
  const s = await createUser({ login: 'anna', password: 'kot12345', role: 'STUDENT', fullName: 'Аннина Анна' });
  const cls = await testPrisma().class.create({ data: { name: '9А', members: { create: [{ userId: a.id, role: 'TEACHER' }, { userId: b.id, role: 'TEACHER' }, { userId: s.id, role: 'STUDENT' }] } } });
  [t1, t2, t3, st] = [new TestClient(app), new TestClient(app), new TestClient(app), new TestClient(app)];
  await t1.login('teacher', 'kot12345');
  await t2.login('teacher2', 'kot12345');
  await t3.login('teacher3', 'kot12345');
  await st.login('anna', 'kot12345');
  const res = await t1.request('POST', '/api/boards', { title: 'Урок про маятник' });
  ids = { t1: a.id, t2: b.id, t3: c.id, board: res.json().board.id, cls: cls.id };
});

const objectsOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const out = [...doc.getMap<Y.Map<unknown>>('objects').values()].map((m) => m.toJSON() as { type: string; deps: string[]; id: string });
  doc.destroy();
  return out;
};

async function save(c: TestClient, body: Record<string, unknown>) {
  return c.request('POST', '/api/templates', { boardId: ids.board, title: 'Маятник', section: 'physics.waves', ...body });
}

describe('библиотека шаблонов', () => {
  it('встроенные шаблоны: создаются один раз, видны учителям, не видны ученикам, не меняются', async () => {
    expect(await ensureBuiltinTemplates(testPrisma())).toBe(BUILTIN_TEMPLATES.length);
    expect(await ensureBuiltinTemplates(testPrisma())).toBe(0);
    const list = await t1.request('GET', '/api/templates?scope=builtin');
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(BUILTIN_TEMPLATES.length);
    const physics = await t1.request('GET', '/api/templates?section=physics');
    expect(physics.json().items.every((t: { section: string }) => t.section.startsWith('physics.'))).toBe(true);
    const found = await t1.request('GET', `/api/templates?search=${encodeURIComponent('маятник')}`);
    expect(found.json().items.map((t: { title: string }) => t.title)).toContain('Математический маятник');
    expect((await st.request('GET', '/api/templates')).statusCode).toBe(403);

    // Документ: текст условия + объекты, зависимости — настоящие id.
    const graphs = BUILTIN_TEMPLATES.find((t) => t.key === 'math.analysis.intersection')!;
    const row = await testPrisma().template.findUnique({ where: { builtinKey: graphs.key }, include: { board: { include: { document: true } } } });
    const objs = objectsOf(row!.board.document!.state);
    expect(objs.map((o) => o.type).sort()).toEqual(['core.text', 'math.analysis.axes', 'math.analysis.curve', 'math.analysis.curve']);
    const axes = objs.find((o) => o.type === 'math.analysis.axes')!;
    expect(objs.filter((o) => o.type === 'math.analysis.curve').every((c) => c.deps[0] === axes.id)).toBe(true);

    // Учитель видит доску встроенного шаблона, но изменить шаблон не может.
    expect((await t1.request('GET', `/api/boards/${row!.boardId}/snapshot`)).statusCode).toBe(200);
    expect((await t1.request('PATCH', `/api/templates/${row!.id}`, { title: 'Моё' })).statusCode).toBe(403);
  });

  it('видимость своих шаблонов: только мне, всем учителям, выбранным', async () => {
    const own = await save(t1, { visibility: 'PRIVATE' });
    expect(own.statusCode).toBe(201);
    const tpl = own.json().template;
    expect(tpl.mine).toBe(true);
    expect((await t2.request('GET', `/api/templates/${tpl.id}`)).statusCode).toBe(404);
    expect((await t2.request('GET', `/api/boards/${tpl.boardId}/snapshot`)).statusCode).toBe(404);

    const sel = await t1.request('PATCH', `/api/templates/${tpl.id}`, { visibility: 'SELECTED', shareUserIds: [ids.t2] });
    expect(sel.json().template.sharedWith).toEqual([{ id: ids.t2, fullName: 'Учитель Два' }]);
    expect((await t2.request('GET', `/api/templates/${tpl.id}`)).json().template.mine).toBe(false);
    expect((await t2.request('GET', `/api/boards/${tpl.boardId}/snapshot`)).statusCode).toBe(200);
    expect((await t3.request('GET', `/api/templates/${tpl.id}`)).statusCode).toBe(404);

    await t1.request('PATCH', `/api/templates/${tpl.id}`, { visibility: 'TEACHERS' });
    expect((await t3.request('GET', `/api/templates?scope=shared`)).json().total).toBe(1);
    // Чужой шаблон менять и удалять нельзя.
    expect((await t2.request('PATCH', `/api/templates/${tpl.id}`, { title: 'Чужое' })).statusCode).toBe(403);
    expect((await t2.request('DELETE', `/api/templates/${tpl.id}`)).statusCode).toBe(403);

    // Выбранным — только учителям, и хотя бы одному.
    expect((await save(t1, { visibility: 'SELECTED', shareUserIds: [] })).statusCode).toBe(400);
    const student = await testPrisma().user.findFirst({ where: { login: 'anna' } });
    expect((await save(t1, { visibility: 'SELECTED', shareUserIds: [student!.id] })).statusCode).toBe(400);
  });

  it('доска шаблона не попадает в «Мои доски»; удаление — автором', async () => {
    const tpl = (await save(t1, {})).json().template;
    const own = await t1.request('GET', '/api/boards?scope=own');
    expect(own.json().items.map((b: { id: string }) => b.id)).toEqual([ids.board]);
    expect((await t1.request('GET', '/api/boards?scope=own&kind=TEMPLATE')).json().items[0].id).toBe(tpl.boardId);
    expect((await t1.request('DELETE', `/api/templates/${tpl.id}`)).statusCode).toBe(204);
    expect((await t1.request('GET', `/api/templates/${tpl.id}`)).statusCode).toBe(404);
    expect((await testPrisma().board.findUnique({ where: { id: tpl.boardId } }))?.deletedAt).not.toBeNull();
  });

  it('доска из шаблона: копия содержимого у другого учителя, счётчик использований', async () => {
    await ensureBuiltinTemplates(testPrisma());
    const builtin = (await t2.request('GET', '/api/templates?scope=builtin&search=' + encodeURIComponent('наклонной'))).json().items[0];
    const res = await t2.request('POST', `/api/templates/${builtin.id}/use`, { title: 'Урок 5' });
    expect(res.statusCode).toBe(201);
    const board = await testPrisma().board.findUnique({ where: { id: res.json().boardId }, include: { document: true } });
    expect(board).toMatchObject({ kind: 'LESSON', ownerId: ids.t2, title: 'Урок 5' });
    expect(objectsOf(board!.document!.state).map((o) => o.type).sort()).toEqual(['core.text', 'physics.mechanics.incline']);
    expect((await t2.request('GET', `/api/templates/${builtin.id}`)).json().template.usageCount).toBe(1);
    expect((await st.request('POST', `/api/templates/${builtin.id}/use`, {})).statusCode).toBe(403);
  });

  it('задание из встроенного шаблона: учитель только видит шаблон, но раздать может', async () => {
    await ensureBuiltinTemplates(testPrisma());
    const builtin = (await t1.request('GET', '/api/templates?scope=builtin')).json().items[0];
    const res = await t1.request('POST', '/api/assignments', { title: 'Домашняя', templateBoardId: builtin.boardId, classId: ids.cls });
    expect(res.statusCode).toBe(201);
    expect((await t1.request('GET', `/api/templates/${builtin.id}`)).json().template.usageCount).toBe(1);
  });
});
