import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { AUTH_COOKIES, createObjectBase } from '@doska/shared';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { YClient, sleep, waitFor } from './ws-client.js';

let app: FastifyInstance;
let base: string;

beforeAll(async () => {
  app = await createTestApp({}, undefined, {
    unloadDelayMs: 150,
    helloTimeoutMs: 1500,
    persistence: { flushIntervalMs: 30, compactIntervalMs: 60_000, compactEveryUpdates: 500, versionIntervalMs: 3_600_000, keepAutoVersions: 50 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws/boards/`;
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});

let teacher: TestClient;
let teacher2: TestClient;
let s1: TestClient;
let s2: TestClient;
let ids: { teacher: string; s1: string; s2: string; s3: string; cls: string; board: string };

beforeEach(async () => {
  await resetDb();
  const t = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Один' });
  await createUser({ login: 'teacher2', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Два' });
  const a = await createUser({ login: 'anna', password: 'kot12345', role: 'STUDENT', fullName: 'Аннина Анна' });
  const b = await createUser({ login: 'boris', password: 'kot12345', role: 'STUDENT', fullName: 'Борисов Борис' });
  const c = await createUser({ login: 'vera', password: 'kot12345', role: 'STUDENT', fullName: 'Верина Вера' });
  const cls = await testPrisma().class.create({
    data: { name: '9А', members: { create: [{ userId: t.id, role: 'TEACHER' }, { userId: a.id, role: 'STUDENT' }, { userId: b.id, role: 'STUDENT' }] } },
  });
  teacher = new TestClient(app);
  teacher2 = new TestClient(app);
  s1 = new TestClient(app);
  s2 = new TestClient(app);
  await teacher.login('teacher', 'kot12345');
  await teacher2.login('teacher2', 'kot12345');
  await s1.login('anna', 'kot12345');
  await s2.login('boris', 'kot12345');
  const res = await teacher.request('POST', '/api/boards', { title: 'Шаблон задачи' });
  ids = { teacher: t.id, s1: a.id, s2: b.id, s3: c.id, cls: cls.id, board: res.json().board.id };
});

const cookie = (c: TestClient) => `${AUTH_COOKIES.access}=${c.cookies.get(AUTH_COOKIES.access)}`;

async function join(c: TestClient, boardId: string, lite = false): Promise<YClient> {
  const y = await YClient.connect(base + boardId + (lite ? '?lite=1' : ''), cookie(c));
  await waitFor(() => y.controls.some((m) => m.t === 'session.init') && y.doc.getMap('pages').size > 0, 4000, 'синхронизация');
  return y;
}

function addObject(y: YClient, userId: string, id: string, over: Record<string, unknown> = {}) {
  const obj = {
    ...createObjectBase({ id, type: 'core.stroke', pageId: y.pageId(), z: 'a0', userId, now: Date.now() }),
    props: { points: [0, 0, 0.5, 10, 10, 0.5], color: 'ink', width: 2 },
    ...over,
  };
  y.objects().set(id, new Y.Map(Object.entries(obj)));
}

async function createAssignment(body: Record<string, unknown> = {}) {
  const res = await teacher.request('POST', '/api/assignments', { title: 'Домашняя', templateBoardId: ids.board, classId: ids.cls, ...body });
  expect(res.statusCode).toBe(201);
  return res.json().assignment;
}

describe('задания', () => {
  it('раздача: каждый ученик получает копию текущего документа доски', async () => {
    // Учитель рисует на исходной доске — копии должны это содержать (из комнаты, ещё не записанное).
    const t = await join(teacher, ids.board);
    addObject(t, ids.teacher, 'templObj1', { locked: true });
    await sleep(100);

    const a = await createAssignment({ studentIds: [ids.s3], dueAt: '2030-05-01T10:00:00.000Z', instructions: 'Решите задачу' });
    expect(a.total).toBe(3);
    expect(a.counts).toMatchObject({ NOT_STARTED: 3, IN_PROGRESS: 0 });
    expect(a.works.map((w: { student: { fullName: string } }) => w.student.fullName)).toEqual(['Аннина Анна', 'Борисов Борис', 'Верина Вера']);
    const work = a.works[0];
    const board = await testPrisma().board.findUniqueOrThrow({ where: { id: work.boardId } });
    expect(board).toMatchObject({ kind: 'ASSIGNMENT_WORK', ownerId: ids.teacher, title: 'Домашняя — Аннина Анна', objectCount: 1 });
    expect(await testPrisma().auditLog.count({ where: { action: 'ASSIGNMENT_CREATED' } })).toBe(1);

    // Ученик видит задание и открывает свою работу, чужую — нет.
    const mine = (await s1.request('GET', '/api/assignments/mine')).json().assignments;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Домашняя', instructions: 'Решите задачу', teacher: { fullName: 'Учитель Один' }, work: { status: 'NOT_STARTED' } });
    const details = (await s1.request('GET', `/api/boards/${work.boardId}`)).json().board;
    expect(details.work).toMatchObject({ assignmentTitle: 'Домашняя', student: { id: ids.s1 }, status: 'NOT_STARTED', closed: false });
    expect((await s2.request('GET', `/api/boards/${work.boardId}`)).statusCode).toBe(404);
    // Список заданий учителя доступен только ему.
    expect((await s1.request('GET', '/api/assignments')).statusCode).toBe(403);
    expect((await teacher2.request('GET', `/api/assignments/${a.id}`)).statusCode).toBe(404);
    t.close();
  });

  it('проверки при создании: своя доска, свой класс, только ученики', async () => {
    const other = await teacher2.request('POST', '/api/assignments', { title: 'Чужая', templateBoardId: ids.board, studentIds: [ids.s1] });
    expect(other.statusCode).toBe(400);
    const notMyClass = await teacher2.request('POST', '/api/boards', { title: 'Своя' });
    const res = await teacher2.request('POST', '/api/assignments', { title: 'X', templateBoardId: notMyClass.json().board.id, classId: ids.cls });
    expect(res.statusCode).toBe(400);
    const teacherAsStudent = await teacher.request('POST', '/api/assignments', { title: 'X', templateBoardId: ids.board, studentIds: [ids.teacher] });
    expect(teacherAsStudent.statusCode).toBe(400);
    const nobody = await teacher.request('POST', '/api/assignments', { title: 'X', templateBoardId: ids.board });
    expect(nobody.statusCode).toBe(400);
  });

  it('статусы: начало работы, сдача, отмена, проверка с отметкой, возврат — с пересчётом прав на лету', async () => {
    const a = await createAssignment();
    const work = a.works.find((w: { student: { id: string } }) => w.student.id === ids.s1);
    const sy = await join(s1, work.boardId);
    const ty = await join(teacher, work.boardId);
    expect(sy.control('session.init')[0]!.capabilities).toMatchObject({ role: 'student', write: true });

    addObject(sy, ids.s1, 'answerObj1');
    await waitFor(() => ty.objects().has('answerObj1'), 3000, 'ответ у учителя');
    await waitFor(() => ty.control('work.changed').some((m) => m.status === 'IN_PROGRESS'), 3000, 'в работе');

    expect((await s2.request('POST', `/api/works/${work.id}/submit`)).statusCode).toBe(404);
    expect((await s1.request('POST', `/api/works/${work.id}/submit`)).statusCode).toBe(204);
    await waitFor(() => sy.control('capabilities').some((m) => m.capabilities.noWriteReason === 'assignment-submitted'), 3000, 'права после сдачи');
    await waitFor(() => ty.control('work.changed').at(-1)?.status === 'SUBMITTED', 3000, 'учитель видит сдачу');
    // После сдачи изменения ученика отменяются.
    addObject(sy, ids.s1, 'lateObject1');
    await waitFor(() => !sy.objects().has('lateObject1'), 3000, 'компенсация после сдачи');
    expect((await s1.request('POST', `/api/works/${work.id}/submit`)).statusCode).toBe(409);

    expect((await s1.request('POST', `/api/works/${work.id}/unsubmit`)).statusCode).toBe(204);
    await waitFor(() => sy.control('capabilities').at(-1)!.capabilities.write === true, 3000, 'снова можно писать');
    await s1.request('POST', `/api/works/${work.id}/submit`);

    // Учитель пишет пометку в слое review — ученик её видит, но удалить не может.
    addObject(ty, ids.teacher, 'reviewMark', { layer: 'review' });
    await waitFor(() => sy.objects().has('reviewMark'), 3000, 'пометка у ученика');

    expect((await s1.request('POST', `/api/works/${work.id}/review`, { grade: '5' })).statusCode).toBe(403);
    expect((await teacher.request('POST', `/api/works/${work.id}/review`, { grade: '5' })).statusCode).toBe(204);
    await waitFor(() => sy.control('work.changed').some((m) => m.status === 'REVIEWED' && m.grade === '5'), 3000, 'проверено');
    expect((await s1.request('POST', `/api/works/${work.id}/unsubmit`)).statusCode).toBe(409);

    expect((await teacher.request('POST', `/api/works/${work.id}/return`)).statusCode).toBe(204);
    await waitFor(() => sy.control('capabilities').at(-1)!.capabilities.write === true, 3000, 'возврат на доработку');
    sy.objects().delete('reviewMark');
    await waitFor(() => sy.objects().has('reviewMark'), 3000, 'пометку нельзя удалить');

    const details = (await teacher.request('GET', `/api/assignments/${a.id}`)).json().assignment;
    expect(details.counts).toMatchObject({ NOT_STARTED: 1, IN_PROGRESS: 1 });
    sy.close();
    ty.close();
  });

  it('закрытие задания запрещает изменения, удаление убирает работы', async () => {
    const a = await createAssignment();
    const work = a.works[0];
    const sy = await join(s1, work.boardId);
    const res = await teacher.request('PATCH', `/api/assignments/${a.id}`, { closed: true });
    expect(res.json().assignment.closedAt).not.toBeNull();
    await waitFor(() => sy.control('work.changed').some((m) => m.closed), 3000, 'закрыто');
    await waitFor(() => sy.control('capabilities').some((m) => m.capabilities.noWriteReason === 'assignment-closed'), 3000, 'права');
    expect((await s1.request('POST', `/api/works/${work.id}/submit`)).statusCode).toBe(409);

    expect((await teacher.request('DELETE', `/api/assignments/${a.id}`)).statusCode).toBe(204);
    await waitFor(() => sy.closed !== null, 3000, 'отключение');
    expect((await s1.request('GET', '/api/assignments/mine')).json().assignments).toHaveLength(0);
    expect(await testPrisma().board.count({ where: { kind: 'ASSIGNMENT_WORK', deletedAt: null } })).toBe(0);
  });

  it('новые ученики класса получают задание по кнопке', async () => {
    const a = await createAssignment();
    await testPrisma().classMember.create({ data: { classId: ids.cls, userId: ids.s3, role: 'STUDENT' } });
    const before = (await teacher.request('GET', `/api/assignments/${a.id}`)).json().assignment;
    expect(before.missingClassStudents).toBe(1);
    const after = (await teacher.request('POST', `/api/assignments/${a.id}/students`, { fromClass: true })).json().assignment;
    expect(after.total).toBe(3);
    expect(after.missingClassStudents).toBe(0);
  });
});

describe('облегчённые подписки и снимок доски', () => {
  it('?lite=1: документ приходит и обновляется, присутствие и изменения не участвуют', async () => {
    const a = await createAssignment();
    const work = a.works[0];
    const lite = await join(teacher, work.boardId, true);
    const sy = await join(s1, work.boardId);
    sy.awareness.setLocalState({ cursor: { pageId: sy.pageId(), x: 1, y: 1 }, selection: [], tool: null, editing: null, viewport: null, laser: null, drawing: null });
    addObject(sy, ids.s1, 'liveObject1');
    await waitFor(() => lite.objects().has('liveObject1'), 3000, 'обновление в облегчённой подписке');
    await sleep(100);
    expect(lite.awareness.getStates().size).toBe(0);

    // Изменения из облегчённой подписки сервер не принимает.
    addObject(lite, ids.teacher, 'fromLite');
    await sleep(200);
    expect(sy.objects().has('fromLite')).toBe(false);
    lite.close();
    sy.close();
  });

  it('снимок для миниатюры — только тем, кто видит доску', async () => {
    const t = await join(teacher, ids.board);
    addObject(t, ids.teacher, 'snapObj1');
    await sleep(80);
    const res = await teacher.request('GET', `/api/boards/${ids.board}/snapshot`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(res.rawPayload));
    expect(doc.getMap('objects').has('snapObj1')).toBe(true);
    expect((await s1.request('GET', `/api/boards/${ids.board}/snapshot`)).statusCode).toBe(404);
    t.close();
  });
});
