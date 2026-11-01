import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});

let teacher: TestClient;
let teacher2: TestClient;
let student: TestClient;
let outsider: TestClient;
let admin: TestClient;
let ids: { teacher: string; teacher2: string; student: string; outsider: string; cls: string; otherCls: string };

beforeEach(async () => {
  await resetDb();
  const t = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Один' });
  const t2 = await createUser({ login: 'teacher2', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Два' });
  const s = await createUser({ login: 'student', password: 'kot12345', role: 'STUDENT', fullName: 'Ученик Класса' });
  const o = await createUser({ login: 'outsider', password: 'kot12345', role: 'STUDENT', fullName: 'Ученик Другой' });
  await createUser({ login: 'admin', password: 'kot12345', role: 'ADMIN' });
  const cls = await testPrisma().class.create({
    data: { name: '9А', members: { create: [{ userId: t.id, role: 'TEACHER' }, { userId: s.id, role: 'STUDENT' }] } },
  });
  const otherCls = await testPrisma().class.create({ data: { name: '5Б', members: { create: [{ userId: o.id, role: 'STUDENT' }] } } });
  ids = { teacher: t.id, teacher2: t2.id, student: s.id, outsider: o.id, cls: cls.id, otherCls: otherCls.id };
  teacher = new TestClient(app);
  teacher2 = new TestClient(app);
  student = new TestClient(app);
  outsider = new TestClient(app);
  admin = new TestClient(app);
  await teacher.login('teacher', 'kot12345');
  await teacher2.login('teacher2', 'kot12345');
  await student.login('student', 'kot12345');
  await outsider.login('outsider', 'kot12345');
  await admin.login('admin', 'kot12345');
});

async function createBoard(c: TestClient, body: Record<string, unknown>) {
  const res = await c.request('POST', '/api/boards', body);
  expect(res.statusCode).toBe(201);
  return res.json().board;
}

describe('доски', () => {
  it('учитель создаёт доску урока с начальным документом и доступом классу', async () => {
    const board = await createBoard(teacher, { title: 'Механика', classIds: [ids.cls] });
    expect(board).toMatchObject({
      kind: 'LESSON',
      mode: 'LECTURE',
      role: 'owner',
      classes: [{ id: ids.cls, name: '9А' }],
      capabilities: { manageLesson: true },
      access: { classes: [{ id: ids.cls, name: '9А', academicYear: null }], members: [] },
    });
    const stored = await testPrisma().boardDocument.findUniqueOrThrow({ where: { boardId: board.id } });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored.state);
    expect(doc.getMap('pages').size).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(await testPrisma().auditLog.count({ where: { action: 'BOARD_CREATED' } })).toBe(1);
  });

  it('выдавать можно только своим классам; соведущий — только учитель', async () => {
    const bad = await teacher.request('POST', '/api/boards', { title: 'X', classIds: [ids.otherCls] });
    expect(bad.statusCode).toBe(400);
    const board = await createBoard(teacher, { title: 'Y' });
    const wrong = await teacher.request('PUT', `/api/boards/${board.id}/access`, {
      classIds: [],
      members: [{ userId: ids.student, role: 'CO_TEACHER' }],
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await teacher.request('PUT', `/api/boards/${board.id}/access`, {
      classIds: [ids.cls],
      members: [
        { userId: ids.teacher2, role: 'CO_TEACHER' },
        { userId: ids.outsider, role: 'STUDENT' },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().access.members.map((m: { role: string }) => m.role).sort()).toEqual(['CO_TEACHER', 'STUDENT']);
    // Соведущий видит доску и управляет ею, но не удаляет.
    const asCo = await teacher2.request('GET', `/api/boards/${board.id}`);
    expect(asCo.json().board.capabilities).toMatchObject({ role: 'teacher', manageLesson: true });
    expect((await teacher2.request('DELETE', `/api/boards/${board.id}`)).statusCode).toBe(403);
  });

  it('список: свои и доступные, поиск; ученик видит только выданные', async () => {
    const a = await createBoard(teacher, { title: 'Кинематика', classIds: [ids.cls] });
    await createBoard(teacher, { title: 'Черновик учителя' });
    await createBoard(teacher2, { title: 'Чужой урок' });

    const own = (await teacher.request('GET', '/api/boards?scope=own')).json();
    expect(own.items.map((b: { title: string }) => b.title).sort()).toEqual(['Кинематика', 'Черновик учителя']);
    const search = (await teacher.request('GET', `/api/boards?search=${encodeURIComponent('кинем')}`)).json();
    expect(search.total).toBe(1);

    const forStudent = (await student.request('GET', '/api/boards')).json();
    expect(forStudent.items.map((b: { id: string }) => b.id)).toEqual([a.id]);
    expect(forStudent.items[0]).toMatchObject({ role: 'student', folderId: null });
    expect((await outsider.request('GET', '/api/boards')).json().total).toBe(0);
    // Нет доступа — доска «не существует».
    expect((await outsider.request('GET', `/api/boards/${a.id}`)).statusCode).toBe(404);
    // Ученик видит доску, но не управляет ею.
    const asStudent = (await student.request('GET', `/api/boards/${a.id}`)).json().board;
    expect(asStudent.capabilities).toMatchObject({ role: 'student', write: false, noWriteReason: 'lecture-mode' });
    expect(asStudent.access).toBeNull();
    // Администратор видит всё, только просмотр.
    expect((await admin.request('GET', '/api/boards')).json().total).toBe(3);
    expect((await admin.request('GET', `/api/boards/${a.id}`)).json().board.capabilities).toMatchObject({ role: 'viewer', write: false });
    expect((await admin.request('POST', '/api/boards', { title: 'Админ' })).statusCode).toBe(403);
  });

  it('ученик создаёт личный конспект и может открыть его учителям', async () => {
    const nb = await createBoard(student, { title: 'Мой конспект' });
    expect(nb.kind).toBe('NOTEBOOK');
    expect((await student.request('POST', '/api/boards', { title: 'x', classIds: [ids.cls] })).statusCode).toBe(400);
    expect((await teacher.request('GET', `/api/boards/${nb.id}`)).statusCode).toBe(404);
    expect((await student.request('PATCH', `/api/boards/${nb.id}`, { sharedWithTeachers: true })).statusCode).toBe(200);
    const asTeacher = (await teacher.request('GET', `/api/boards/${nb.id}`)).json().board;
    expect(asTeacher.capabilities).toMatchObject({ role: 'viewer', write: false });
    expect((await teacher.request('GET', '/api/boards?scope=shared')).json().items.map((b: { id: string }) => b.id)).toContain(nb.id);
    // Учитель другого класса конспект не видит.
    expect((await teacher2.request('GET', `/api/boards/${nb.id}`)).statusCode).toBe(404);
  });

  it('изменение свойств и права на это', async () => {
    const b = await createBoard(teacher, { title: 'Старое', classIds: [ids.cls] });
    const res = await teacher.request('PATCH', `/api/boards/${b.id}`, { title: 'Новое', settings: { allowStudentsEditOthers: true } });
    expect(res.json().board).toMatchObject({ title: 'Новое', settings: { allowStudentsEditOthers: true, allowStudentLaser: true } });
    expect((await student.request('PATCH', `/api/boards/${b.id}`, { title: 'Взлом' })).statusCode).toBe(403);
    expect((await student.request('PATCH', `/api/boards/${b.id}`, { settings: { allowStudentPages: true } })).statusCode).toBe(403);
    expect((await teacher.request('PATCH', `/api/boards/${b.id}`, { settings: { unknown: true } })).statusCode).toBe(400);
  });

  it('удаление: только владелец, удалённая доска исчезает', async () => {
    const b = await createBoard(teacher, { title: 'Удалить', classIds: [ids.cls] });
    expect((await student.request('DELETE', `/api/boards/${b.id}`)).statusCode).toBe(403);
    expect((await teacher.request('DELETE', `/api/boards/${b.id}`)).statusCode).toBe(204);
    expect((await teacher.request('GET', `/api/boards/${b.id}`)).statusCode).toBe(404);
    expect((await student.request('GET', '/api/boards')).json().total).toBe(0);
  });

  it('люди доски: только связанные и только тем, кто видит доску', async () => {
    const b = await createBoard(teacher, { title: 'Люди', classIds: [ids.cls] });
    const people = (await student.request('GET', `/api/boards/${b.id}/people`)).json().people;
    expect(people.map((p: { fullName: string }) => p.fullName).sort()).toEqual(['Ученик Класса', 'Учитель Один']);
    expect((await outsider.request('GET', `/api/boards/${b.id}/people`)).statusCode).toBe(404);
  });

  it('мои классы', async () => {
    const res = (await teacher.request('GET', '/api/boards/my-classes')).json();
    expect(res.classes).toEqual([{ id: ids.cls, name: '9А', academicYear: null, studentCount: 1 }]);
  });
});

describe('папки', () => {
  it('создание, вложенность, перенос досок, циклы, удаление', async () => {
    const f1 = (await teacher.request('POST', '/api/folders', { name: '9 класс' })).json().folder;
    expect((await teacher.request('POST', '/api/folders', { name: '9 КЛАСС' })).statusCode).toBe(409);
    const f2 = (await teacher.request('POST', '/api/folders', { name: 'Механика', parentId: f1.id })).json().folder;
    const b = await createBoard(teacher, { title: 'В папке', folderId: f2.id });
    expect(b.folderId).toBe(f2.id);
    const inFolder = (await teacher.request('GET', `/api/boards?folderId=${f2.id}`)).json();
    expect(inFolder.total).toBe(1);
    expect((await teacher.request('GET', '/api/boards?folderId=root')).json().total).toBe(0);

    // Цикл запрещён.
    expect((await teacher.request('PATCH', `/api/folders/${f1.id}`, { parentId: f2.id })).statusCode).toBe(400);
    // Чужая папка недоступна.
    expect((await teacher2.request('PATCH', `/api/folders/${f1.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await teacher2.request('POST', '/api/boards', { title: 'x', folderId: f1.id })).statusCode).toBe(400);

    const list = (await teacher.request('GET', '/api/folders')).json().folders;
    expect(list.find((f: { id: string }) => f.id === f2.id).boardCount).toBe(1);

    // Удаление папки: вложенные папки удаляются, доски переходят в корень.
    expect((await teacher.request('DELETE', `/api/folders/${f1.id}`)).statusCode).toBe(204);
    expect((await teacher.request('GET', '/api/folders')).json().folders).toEqual([]);
    expect((await teacher.request('GET', '/api/boards?folderId=root')).json().total).toBe(1);
  });

  it('ограничение глубины', async () => {
    let parent: string | null = null;
    for (let i = 0; i < 5; i++) {
      const res = await teacher.request('POST', '/api/folders', { name: `L${i}`, parentId: parent });
      expect(res.statusCode).toBe(201);
      parent = res.json().folder.id;
    }
    expect((await teacher.request('POST', '/api/folders', { name: 'L5', parentId: parent })).statusCode).toBe(400);
  });
});
