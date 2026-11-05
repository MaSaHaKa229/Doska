import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { AUTH_COOKIES, createObjectBase } from '@doska/shared';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { YClient, waitFor } from './ws-client.js';
import { restoreFromState } from '../src/realtime/restore.js';

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
let student: TestClient;
let ids: { teacher: string; board: string };
beforeEach(async () => {
  await resetDb(testPrisma(), app);
  const t = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Один' });
  const s = await createUser({ login: 'anna', password: 'kot12345', role: 'STUDENT', fullName: 'Аннина Анна' });
  const cls = await testPrisma().class.create({ data: { name: '9А', members: { create: [{ userId: t.id, role: 'TEACHER' }, { userId: s.id, role: 'STUDENT' }] } } });
  teacher = new TestClient(app);
  student = new TestClient(app);
  await teacher.login('teacher', 'kot12345');
  await student.login('anna', 'kot12345');
  const res = await teacher.request('POST', '/api/boards', { title: 'История', classIds: [cls.id] });
  ids = { teacher: t.id, board: res.json().board.id };
});

const cookie = (c: TestClient) => `${AUTH_COOKIES.access}=${c.cookies.get(AUTH_COOKIES.access)}`;
async function join(c: TestClient): Promise<YClient> {
  const y = await YClient.connect(base + ids.board, cookie(c));
  await waitFor(() => y.controls.some((m) => m.t === 'session.init') && y.doc.getMap('pages').size > 0, 4000, 'синхронизация');
  return y;
}
function addStroke(y: YClient, id: string, color = 'ink') {
  const obj = { ...createObjectBase({ id, type: 'core.stroke', pageId: y.pageId(), z: 'a0', userId: ids.teacher, now: Date.now() }), props: { points: [0, 0, 0.5, 10, 10, 0.5], color, width: 2 } };
  y.objects().set(id, new Y.Map(Object.entries(obj)));
}

describe('семантическое восстановление', () => {
  it('удаляет лишнее, создаёт недостающее, меняет только различающиеся поля', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      objects.set('a', new Y.Map(Object.entries({ id: 'a', x: 1, props: { c: 'ink' } })));
      objects.set('b', new Y.Map(Object.entries({ id: 'b', x: 2 })));
    });
    const target = new Y.Doc();
    Y.applyUpdate(target, Y.encodeStateAsUpdate(doc));
    target.transact(() => {
      target.getMap<Y.Map<unknown>>('objects').get('a')!.set('x', 5);
      target.getMap('objects').delete('b');
      target.getMap('objects').set('c', new Y.Map(Object.entries({ id: 'c', x: 3 })));
    });
    // Текущий документ меняют дальше: восстановление должно вернуть его к target.
    objects.get('a')!.set('props', { c: 'accent-1' });
    const res = restoreFromState(doc, Y.encodeStateAsUpdate(target));
    expect(res.objects).toBe(3);
    expect(objects.toJSON()).toEqual({ a: { id: 'a', x: 5, props: { c: 'ink' } }, c: { id: 'c', x: 3 } });
    // Повторное восстановление ничего не меняет.
    expect(restoreFromState(doc, Y.encodeStateAsUpdate(target)).objects).toBe(0);
  });
});

describe('история версий', () => {
  it('ручная версия, восстановление у всех участников, версия перед восстановлением, журнал', async () => {
    const t = await join(teacher);
    const s = await join(student);
    addStroke(t, 'objFirst1');
    await waitFor(() => s.objects().has('objFirst1'), 3000, 'первый штрих у ученика');

    const saved = await teacher.request('POST', `/api/boards/${ids.board}/versions`, { label: 'Начало урока' });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().version).toMatchObject({ reason: 'MANUAL', label: 'Начало урока', objectCount: 1, createdBy: { fullName: 'Учитель Один' } });

    // Дальше урок продолжается: первый штрих удалён, появился второй.
    t.doc.transact(() => t.objects().delete('objFirst1'));
    addStroke(t, 'objSecond1', 'accent-2');
    await waitFor(() => s.objects().has('objSecond1') && !s.objects().has('objFirst1'), 3000, 'изменения у ученика');

    const versionId = saved.json().version.id;
    const snap = await teacher.request('GET', `/api/boards/${ids.board}/versions/${versionId}/snapshot`);
    expect(snap.statusCode).toBe(200);
    const vdoc = new Y.Doc();
    Y.applyUpdate(vdoc, new Uint8Array(snap.rawPayload));
    expect([...vdoc.getMap('objects').keys()]).toEqual(['objFirst1']);

    const restored = await teacher.request('POST', `/api/boards/${ids.board}/versions/${versionId}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().restored.objects).toBe(2);
    // У обоих участников — состояние версии, без переподключения.
    await waitFor(() => s.objects().has('objFirst1') && !s.objects().has('objSecond1'), 3000, 'восстановление у ученика');
    await waitFor(() => t.objects().has('objFirst1') && !t.objects().has('objSecond1'), 3000, 'восстановление у учителя');
    await waitFor(() => s.control('notice').some((n) => n.code === 'VERSION_RESTORED'), 3000, 'уведомление ученику');

    const list = (await teacher.request('GET', `/api/boards/${ids.board}/versions`)).json().versions;
    expect(list.map((v: { reason: string }) => v.reason)).toEqual(['BEFORE_RESTORE', 'MANUAL']);
    expect(list[0].label).toBe('Перед восстановлением: «Начало урока»');
    expect(await testPrisma().auditLog.count({ where: { action: 'BOARD_VERSION_RESTORED', targetId: ids.board } })).toBe(1);

    // Отменить восстановление — восстановить версию «перед восстановлением».
    await teacher.request('POST', `/api/boards/${ids.board}/versions/${list[0].id}/restore`);
    await waitFor(() => s.objects().has('objSecond1') && !s.objects().has('objFirst1'), 3000, 'отмена восстановления у ученика');
    t.close();
    s.close();
  });

  it('права: ученик не видит историю урока; чужая версия — 404; подпись обязательна', async () => {
    expect((await student.request('GET', `/api/boards/${ids.board}/versions`)).statusCode).toBe(403);
    expect((await teacher.request('POST', `/api/boards/${ids.board}/versions`, { label: ' ' })).statusCode).toBe(400);
    const other = await teacher.request('POST', '/api/boards', { title: 'Другая' });
    const v = (await teacher.request('POST', `/api/boards/${other.json().board.id}/versions`, { label: 'Чужая' })).json().version;
    expect((await teacher.request('POST', `/api/boards/${ids.board}/versions/${v.id}/restore`)).statusCode).toBe(404);
  });

  it('восстановление без открытой доски: комната загружается, изменения сохраняются', async () => {
    const t = await join(teacher);
    addStroke(t, 'objKept1');
    await new Promise((r) => setTimeout(r, 200));
    expect((await teacher.request('POST', `/api/boards/${ids.board}/versions`, { label: 'Со штрихом' })).statusCode).toBe(201);
    t.doc.transact(() => t.objects().delete('objKept1'));
    await new Promise((r) => setTimeout(r, 200));
    t.close();
    // Ждём выгрузки комнаты (unloadDelayMs = 150).
    await new Promise((r) => setTimeout(r, 600));
    const list = (await teacher.request('GET', `/api/boards/${ids.board}/versions`)).json().versions;
    const res = await teacher.request('POST', `/api/boards/${ids.board}/versions/${list.find((x: { label: string }) => x.label === 'Со штрихом').id}/restore`);
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    const snap = await teacher.request('GET', `/api/boards/${ids.board}/snapshot`);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snap.rawPayload));
    expect(doc.getMap('objects').has('objKept1')).toBe(true);
  });
});
