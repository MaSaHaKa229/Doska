import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { AUTH_COOKIES, CloseCode, createObjectBase } from '@doska/shared';
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

interface World {
  teacher: TestClient;
  student: TestClient;
  other: TestClient;
  teacherId: string;
  studentId: string;
  boardId: string;
}

async function world(): Promise<World> {
  await resetDb();
  const t = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Физики' });
  const s = await createUser({ login: 'student', password: 'kot12345', role: 'STUDENT', fullName: 'Иванов Иван' });
  await createUser({ login: 'outsider', password: 'kot12345', role: 'STUDENT', fullName: 'Посторонний' });
  const cls = await testPrisma().class.create({
    data: { name: '9А', members: { create: [{ userId: t.id, role: 'TEACHER' }, { userId: s.id, role: 'STUDENT' }] } },
  });
  const teacher = new TestClient(app);
  await teacher.login('teacher', 'kot12345');
  const student = new TestClient(app);
  await student.login('student', 'kot12345');
  const other = new TestClient(app);
  await other.login('outsider', 'kot12345');
  const res = await teacher.request('POST', '/api/boards', { title: 'Урок', classIds: [cls.id], mode: 'COLLABORATIVE' });
  expect(res.statusCode).toBe(201);
  return { teacher, student, other, teacherId: t.id, studentId: s.id, boardId: res.json().board.id };
}

const cookie = (c: TestClient) => `${AUTH_COOKIES.access}=${c.cookies.get(AUTH_COOKIES.access)}`;

async function join(c: TestClient, boardId: string): Promise<YClient> {
  const y = await YClient.connect(base + boardId, cookie(c));
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

async function setMode(boardId: string, mode: 'LECTURE' | 'COLLABORATIVE' | 'SELECTIVE') {
  await testPrisma().board.update({ where: { id: boardId }, data: { mode } });
  app.events.emit('board.updated', { boardId });
}

/** Ожидание асинхронного условия (запросы к БД) без фиксированных пауз. */
async function waitForAsync(check: () => Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Не дождались: ${what}`);
    await sleep(25);
  }
}

let w: World;
beforeEach(async () => {
  w = await world();
});

describe('подключение и синхронизация', () => {
  it('учитель и ученик получают документ и права; изменения доходят друг до друга', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    expect(t.control('session.init')[0]).toMatchObject({ board: { title: 'Урок', mode: 'COLLABORATIVE' }, capabilities: { role: 'owner' } });
    expect(s.control('session.init')[0]!.capabilities).toMatchObject({ role: 'student', write: true, moderate: false });
    expect(s.doc.getMap('pages').size).toBe(1);

    addObject(t, w.teacherId, 'teacherobj1');
    await waitFor(() => s.objects().has('teacherobj1'), 3000, 'объект учителя у ученика');
    addObject(s, w.studentId, 'studentobj1');
    await waitFor(() => t.objects().has('studentobj1'), 3000, 'объект ученика у учителя');
    t.close();
    s.close();
  });

  it('ping → pong; команду урока без права сервер отклоняет', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    t.sendControl({ t: 'ping', ts: 123 });
    await waitFor(() => t.control('pong').length === 1);
    expect(t.control('pong')[0]!.ts).toBe(123);
    s.sendControl({ t: 'mode.set', mode: 'LECTURE' });
    await waitFor(() => s.control('error').length === 1);
    expect(s.control('error')[0]!.code).toBe('FORBIDDEN');
    expect((await testPrisma().board.findUniqueOrThrow({ where: { id: w.boardId } })).mode).toBe('COLLABORATIVE');
    t.close();
    s.close();
  });
});

describe('проверка прав на сервере', () => {
  it('режим «Лекция»: штрих ученика отменяется у него и не появляется у учителя', async () => {
    await setMode(w.boardId, 'LECTURE');
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    expect(s.control('session.init')[0]!.capabilities).toMatchObject({ write: false, noWriteReason: 'lecture-mode' });
    const seenByTeacher: string[] = [];
    t.objects().observe((e) => e.changes.keys.forEach((_v, k) => seenByTeacher.push(k)));

    addObject(s, w.studentId, 'forbidden01');
    await waitFor(() => s.control('notice').length > 0, 3000, 'уведомление');
    await waitFor(() => !s.objects().has('forbidden01'), 3000, 'компенсация у ученика');
    expect(s.control('notice')[0]).toMatchObject({ code: 'CHANGE_REVERTED', reason: 'NO_WRITE', objectIds: ['forbidden01'] });

    // Следующие правки ученика (после переключения режима) принимаются: нет «дыр».
    await setMode(w.boardId, 'COLLABORATIVE');
    await waitFor(() => s.control('capabilities').some((c) => c.capabilities.write), 3000, 'новые права');
    addObject(s, w.studentId, 'allowed0001');
    await waitFor(() => t.objects().has('allowed0001'), 3000, 'разрешённый объект');
    expect(seenByTeacher).not.toContain('forbidden01');
    t.close();
    s.close();
  });

  it('заблокированный объект учителя нельзя сдвинуть и стереть', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    addObject(t, w.teacherId, 'condition01', { locked: true, x: 100 });
    await waitFor(() => s.objects().has('condition01'));

    s.objects().get('condition01')!.set('x', 999);
    await waitFor(() => s.control('notice').length === 1);
    await waitFor(() => s.objects().get('condition01')?.get('x') === 100, 3000, 'откат перемещения');

    s.objects().delete('condition01');
    await waitFor(() => s.control('notice').length === 2);
    await waitFor(() => s.objects().get('condition01')?.get('x') === 100, 3000, 'восстановление');
    await sleep(100);
    expect(t.objects().get('condition01')?.toJSON()).toMatchObject({ x: 100, locked: true });
    t.close();
    s.close();
  });

  it('подделка автора и изменение блокировки отклоняются', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    addObject(s, w.studentId, 'fakeauthor1', { createdBy: w.teacherId, updatedBy: w.teacherId });
    await waitFor(() => s.control('notice').some((n) => n.reason === 'AUTHOR_MISMATCH'));
    await waitFor(() => !s.objects().has('fakeauthor1'));

    addObject(s, w.studentId, 'ownobject01');
    await waitFor(() => t.objects().has('ownobject01'));
    s.objects().get('ownobject01')!.set('locked', true);
    await waitFor(() => s.control('notice').some((n) => n.reason === 'TEACHER_ONLY'));
    await waitFor(() => s.objects().get('ownobject01')?.get('locked') === false);
    expect(t.objects().get('ownobject01')?.get('locked')).toBe(false);
    t.close();
    s.close();
  });

  it('недопустимая структура обновления закрывает соединение', async () => {
    const s = await join(w.student, w.boardId);
    const evil = new Y.Doc();
    evil.getMap('hack').set('x', 1);
    s.sendRawUpdate(Y.encodeStateAsUpdate(evil));
    await waitFor(() => s.closed !== null);
    expect(s.closed!.code).toBe(CloseCode.ProtocolViolation);
  });
});

describe('присутствие', () => {
  it('имя и цвет подставляет сервер, лазер без права обнуляется', async () => {
    await setMode(w.boardId, 'LECTURE');
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    s.awareness.setLocalState({
      user: { id: w.teacherId, fullName: 'Я учитель', role: 'TEACHER', color: '#000000' },
      cursor: { pageId: s.pageId(), x: 1, y: 2 },
      selection: [],
      tool: 'core.laser',
      editing: null,
      viewport: null,
      laser: { pageId: s.pageId(), points: [0, 0, 0] },
      drawing: null,
    });
    await waitFor(() => [...t.awareness.getStates().values()].some((st) => (st as { cursor?: unknown }).cursor), 3000, 'курсор');
    const state = [...t.awareness.getStates().values()].find((st) => (st as { cursor?: unknown }).cursor) as Record<string, unknown>;
    expect(state.user).toMatchObject({ id: w.studentId, fullName: 'Иванов Иван', role: 'STUDENT' });
    expect(state.laser).toBeNull();
    expect(state.cursor).toEqual({ pageId: s.pageId(), x: 1, y: 2 });

    s.close();
    await waitFor(() => t.awareness.getStates().size === 0, 3000, 'удаление присутствия после отключения');
    t.close();
  });
});

describe('авторизация и доступ', () => {
  it('без входа, посторонний, несуществующая доска, чужой Origin', async () => {
    const anon = await YClient.connect(base + w.boardId, null);
    await waitFor(() => anon.closed !== null);
    expect(anon.closed!.code).toBe(CloseCode.Unauthenticated);

    const outsider = await YClient.connect(base + w.boardId, cookie(w.other));
    await waitFor(() => outsider.closed !== null);
    expect(outsider.closed!.code).toBe(CloseCode.Forbidden);

    const missing = await YClient.connect(base + '00000000-0000-4000-8000-000000000000', cookie(w.teacher));
    await waitFor(() => missing.closed !== null);
    expect(missing.closed!.code).toBe(CloseCode.NotFound);

    const evil = await YClient.connect(base + w.boardId, cookie(w.teacher), 'https://evil.example');
    await waitFor(() => evil.closed !== null);
    expect(evil.httpStatus).toBe(403);
  });

  it('временный пароль не пускает на доску', async () => {
    await testPrisma().user.update({ where: { id: w.studentId }, data: { mustChangePassword: true } });
    app.events.emit('user.updated', { userId: w.studentId });
    const s = await YClient.connect(base + w.boardId, cookie(w.student));
    await waitFor(() => s.closed !== null);
    expect(s.closed!.code).toBe(CloseCode.PasswordChangeRequired);
  });

  it('блокировка ученика и отзыв доступа разрывают соединение', async () => {
    const s = await join(w.student, w.boardId);
    const res = await w.teacher.request('PUT', `/api/boards/${w.boardId}/access`, { classIds: [], members: [] });
    expect(res.statusCode).toBe(200);
    await waitFor(() => s.closed !== null, 3000, 'отключение после отзыва доступа');
    expect(s.closed!.code).toBe(CloseCode.Forbidden);

    const t = await join(w.teacher, w.boardId);
    await testPrisma().user.update({ where: { id: w.teacherId }, data: { isBlocked: true } });
    app.events.emit('user.sessionsRevoked', { userId: w.teacherId, reason: 'blocked' });
    await waitFor(() => t.closed !== null);
    expect(t.closed!.code).toBe(CloseCode.AccountDisabled);
  });

  it('без hello соединение закрывается', async () => {
    const c = await YClient.connect(base + w.boardId, cookie(w.teacher), 'https://doska.test', false);
    await waitFor(() => c.closed !== null, 4000, 'закрытие без hello');
    expect(c.closed!.code).toBe(CloseCode.ProtocolViolation);
  });
});

describe('сохранение', () => {
  it('изменения сохраняются в БД и восстанавливаются после выгрузки доски', async () => {
    const t = await join(w.teacher, w.boardId);
    for (let i = 0; i < 5; i++) addObject(t, w.teacherId, `persisted${i}x`, { x: i * 10 });
    t.objects().get('persisted2x')!.set('x', 777);
    await waitForAsync(async () => (await testPrisma().boardUpdate.count({ where: { boardId: w.boardId } })) > 0, 'запись журнала');
    t.close();

    // Комната выгружается через unloadDelayMs, при выгрузке — компактация.
    await waitForAsync(
      async () =>
        (await testPrisma().boardUpdate.count({ where: { boardId: w.boardId } })) === 0 &&
        (await testPrisma().board.findUniqueOrThrow({ where: { id: w.boardId } })).objectCount === 5,
      'компактация при выгрузке',
    );
    const stored = await testPrisma().boardDocument.findUniqueOrThrow({ where: { boardId: w.boardId } });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored.state);
    expect(doc.getMap('objects').size).toBe(5);
    const board = await testPrisma().board.findUniqueOrThrow({ where: { id: w.boardId } });
    expect(board.objectCount).toBe(5);

    const again = await join(w.teacher, w.boardId);
    await waitFor(() => again.objects().size === 5, 3000, 'восстановление после перезагрузки');
    expect(again.objects().get('persisted2x')!.get('x')).toBe(777);
    again.close();
  });
});

describe('управление уроком', () => {
  const caps = (y: YClient) => {
    const list = y.control('capabilities');
    return list.length ? list[list.length - 1]!.capabilities : y.control('session.init')[0]!.capabilities;
  };

  it('режим одной командой: БД, журнал, рассылка и пересчёт прав', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    t.sendControl({ t: 'mode.set', mode: 'LECTURE' });
    await waitFor(() => s.control('mode.changed').length === 1, 3000, 'mode.changed');
    expect(s.control('mode.changed')[0]).toMatchObject({ mode: 'LECTURE', by: w.teacherId });
    await waitFor(() => caps(s).write === false, 3000, 'новые права ученика');
    expect(caps(s).noWriteReason).toBe('lecture-mode');
    expect((await testPrisma().board.findUniqueOrThrow({ where: { id: w.boardId } })).mode).toBe('LECTURE');
    const audit = await testPrisma().auditLog.findFirst({ where: { action: 'BOARD_MODE_CHANGED', targetId: w.boardId } });
    expect(audit?.details).toMatchObject({ from: 'COLLABORATIVE', to: 'LECTURE' });
    // Учителю права не меняются — capabilities ему не присылаются.
    expect(t.control('capabilities')).toHaveLength(0);

    // Штрих ученика после смены режима отменяется.
    addObject(s, w.studentId, 'lateStroke1');
    await waitFor(() => !s.objects().has('lateStroke1'), 3000, 'компенсация');
    t.close();
    s.close();
  });

  it('смена режима через REST тоже доходит до подключённых', async () => {
    const s = await join(w.student, w.boardId);
    const res = await w.teacher.request('PATCH', `/api/boards/${w.boardId}`, { mode: 'SELECTIVE' });
    expect(res.statusCode).toBe(200);
    await waitFor(() => s.control('mode.changed').length === 1, 3000, 'mode.changed');
    expect(s.control('mode.changed')[0]).toMatchObject({ mode: 'SELECTIVE', by: w.teacherId });
    await waitFor(() => caps(s).noWriteReason === 'no-chalk', 3000, 'права');
    const denied = await w.student.request('PATCH', `/api/boards/${w.boardId}`, { mode: 'COLLABORATIVE' });
    expect(denied.statusCode).toBe(403);
    s.close();
  });

  it('мел: выдача опускает руку, даёт право записи; забрать у всех', async () => {
    await setMode(w.boardId, 'SELECTIVE');
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    expect(caps(s).write).toBe(false);

    s.sendControl({ t: 'hand.raise' });
    await waitFor(() => t.control('hands').some((m) => m.hands.length === 1), 3000, 'рука у учителя');
    expect(t.control('hands').at(-1)!.hands[0]).toMatchObject({ userId: w.studentId, fullName: 'Иванов Иван' });

    t.sendControl({ t: 'chalk.set', userId: w.studentId, granted: true });
    await waitFor(() => caps(s).write === true, 3000, 'мел');
    await waitFor(() => t.control('hands').at(-1)!.hands.length === 0, 3000, 'рука опущена');
    expect(s.control('chalk.changed').at(-1)!.holders).toEqual([w.studentId]);
    expect(await testPrisma().chalkGrant.count({ where: { boardId: w.boardId } })).toBe(1);

    addObject(s, w.studentId, 'chalkStroke1');
    await waitFor(() => t.objects().has('chalkStroke1'), 3000, 'штрих с мелом');

    // Новое подключение получает владельцев мела в session.init.
    const s2 = await join(w.student, w.boardId);
    expect(s2.control('session.init')[0]!.chalkHolders).toEqual([w.studentId]);
    expect(s2.control('session.init')[0]!.capabilities.write).toBe(true);

    t.sendControl({ t: 'chalk.revokeAll' });
    await waitFor(() => caps(s).write === false, 3000, 'мел забран');
    expect(await testPrisma().chalkGrant.count({ where: { boardId: w.boardId } })).toBe(0);

    // Мел можно дать только допущенному ученику.
    const outsider = await testPrisma().user.findFirstOrThrow({ where: { login: 'outsider' } });
    t.sendControl({ t: 'chalk.set', userId: outsider.id, granted: true });
    await waitFor(() => t.control('error').length === 1, 3000, 'ошибка');
    expect(t.control('error')[0]!.code).toBe('BAD_REQUEST');
    t.close();
    s.close();
    s2.close();
  });

  it('руки: ученик поднимает и опускает, учитель снимает, при уходе рука опускается', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    s.sendControl({ t: 'hand.raise' });
    s.sendControl({ t: 'hand.raise' });
    await waitFor(() => t.control('hands').length >= 1, 3000, 'рука');
    await sleep(50);
    expect(t.control('hands')).toHaveLength(1);
    s.sendControl({ t: 'hand.lower' });
    await waitFor(() => t.control('hands').at(-1)!.hands.length === 0, 3000, 'опущена');

    s.sendControl({ t: 'hand.raise' });
    await waitFor(() => t.control('hands').at(-1)!.hands.length === 1, 3000, 'снова');
    t.sendControl({ t: 'hand.dismiss', userId: w.studentId });
    await waitFor(() => s.control('notice').some((n) => n.code === 'HAND_DISMISSED'), 3000, 'уведомление ученику');

    // Учитель руку не поднимает.
    t.sendControl({ t: 'hand.raise' });
    await waitFor(() => t.control('error').length === 1, 3000, 'отказ');

    s.sendControl({ t: 'hand.raise' });
    await waitFor(() => t.control('hands').at(-1)!.hands.length === 1, 3000, 'рука перед уходом');
    s.close();
    await waitFor(() => t.control('hands').at(-1)!.hands.length === 0, 3000, 'рука ушедшего опущена');
    t.close();
  });

  it('«Следуйте за мной»: состояние, ограничение частоты, конец при уходе ведущего', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    const pageId = t.pageId();
    const vp = (x: number) => ({ pageId, centerX: x, centerY: 0, zoom: 1, w: 1000, h: 600 });

    s.sendControl({ t: 'follow.start', viewport: vp(0), strict: true });
    await waitFor(() => s.control('error').length === 1, 3000, 'ученик не ведёт');

    t.sendControl({ t: 'follow.start', viewport: vp(0), strict: true });
    await waitFor(() => s.control('follow.state').length === 1, 3000, 'начало показа');
    expect(s.control('follow.state')[0]!.state).toMatchObject({ leaderId: w.teacherId, strict: true, viewport: { w: 1000 } });

    for (let i = 1; i <= 12; i++) t.sendControl({ t: 'follow.update', viewport: vp(i), scenes: [] });
    await waitFor(() => s.control('follow.state').at(-1)!.state?.viewport.centerX === 12, 3000, 'последний вид');
    // 12 обновлений подряд не уходят все: не чаще 15 в секунду.
    expect(s.control('follow.state').length).toBeLessThan(6);

    const late = await join(w.student, w.boardId);
    expect(late.control('session.init')[0]!.follow).toMatchObject({ leaderId: w.teacherId, viewport: { centerX: 12 } });

    t.close();
    await waitFor(() => s.control('follow.state').at(-1)!.state === null, 3000, 'показ окончен');
    s.close();
    late.close();
  });

  it('очистка записей учеников: снимок BEFORE_CLEAR, учительское остаётся, группы в порядке', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    addObject(t, w.teacherId, 'teacherKeep1');
    addObject(s, w.studentId, 'studentDel1');
    addObject(s, w.studentId, 'studentDel2');
    // Группа ученика с его же объектом — исчезает вместе с ним.
    addObject(s, w.studentId, 'studentGrp1', { type: 'core.group', props: {} });
    addObject(s, w.studentId, 'studentDel3', { groupId: 'studentGrp1' });
    await waitFor(() => t.objects().size === 5, 3000, 'объекты у учителя');

    s.sendControl({ t: 'objects.clearByAuthors', authors: 'students', pageId: null });
    await waitFor(() => s.control('error').length === 1, 3000, 'ученику нельзя');

    t.sendControl({ t: 'objects.clearByAuthors', authors: [w.studentId], pageId: t.pageId() });
    await waitFor(() => t.objects().size === 1 && s.objects().size === 1, 3000, 'очистка');
    expect(t.objects().has('teacherKeep1')).toBe(true);
    await waitFor(() => s.control('notice').some((n) => n.code === 'BOARD_CLEARED'), 3000, 'уведомление');
    expect(s.control('notice').find((n) => n.code === 'BOARD_CLEARED')!.message).toContain('Иванов Иван');

    const version = await testPrisma().boardVersion.findFirstOrThrow({ where: { boardId: w.boardId, reason: 'BEFORE_CLEAR' } });
    const snap = new Y.Doc();
    Y.applyUpdate(snap, version.state);
    expect(snap.getMap('objects').size).toBe(5);
    expect(await testPrisma().auditLog.count({ where: { action: 'BOARD_CLEARED', targetId: w.boardId } })).toBe(1);

    // Повторная очистка — нечего удалять, снимок не создаётся.
    t.sendControl({ t: 'objects.clearByAuthors', authors: 'students', pageId: null });
    await waitFor(() => t.control('notice').filter((n) => n.code === 'BOARD_CLEARED').length === 2, 3000, 'нечего');
    expect(await testPrisma().boardVersion.count({ where: { boardId: w.boardId, reason: 'BEFORE_CLEAR' } })).toBe(1);
    t.close();
    s.close();
  });

  it('настройки: settings.set сохраняет, пересчитывает права; курсоры учеников скрываются от учеников', async () => {
    const t = await join(w.teacher, w.boardId);
    const s = await join(w.student, w.boardId);
    const peerUser = await createUser({ login: 'peer', password: 'kot12345', role: 'STUDENT', fullName: 'Петров Пётр' });
    const cls = await testPrisma().class.findFirstOrThrow({ where: { name: '9А' } });
    await testPrisma().classMember.create({ data: { classId: cls.id, userId: peerUser.id, role: 'STUDENT' } });
    const peerClient = new TestClient(app);
    await peerClient.login('peer', 'kot12345');
    const p = await join(peerClient, w.boardId);

    t.sendControl({ t: 'settings.set', settings: { showStudentCursors: false, allowStudentLaser: false } });
    await waitFor(() => s.control('settings.changed').length === 1, 3000, 'settings.changed');
    expect(caps(s).laser).toBe(false);
    const stored = await testPrisma().board.findUniqueOrThrow({ where: { id: w.boardId } });
    expect(stored.settings).toMatchObject({ showStudentCursors: false, allowStudentLaser: false });

    s.awareness.setLocalState({ cursor: { pageId: s.pageId(), x: 5, y: 6 }, selection: [], tool: null, editing: null, viewport: null, laser: null, drawing: null });
    const stateOf = (y: YClient) =>
      [...y.awareness.getStates().values()].find((st) => (st as { user?: { id: string } }).user?.id === w.studentId) as
        | { cursor: unknown }
        | undefined;
    await waitFor(() => !!stateOf(t)?.cursor, 3000, 'учитель видит курсор');
    await waitFor(() => !!stateOf(p), 3000, 'ученик видит присутствие');
    expect(stateOf(p)!.cursor).toBeNull();
    t.close();
    s.close();
    p.close();
  });
});
