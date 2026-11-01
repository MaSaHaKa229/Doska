import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';

let app: FastifyInstance;
let admin: TestClient;
let adminId: string;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});
beforeEach(async () => {
  await resetDb();
  adminId = (await createUser({ login: 'admin', password: 'kot12345', role: 'ADMIN', fullName: 'Главный Админ' })).id;
  admin = new TestClient(app);
  expect((await admin.login('admin', 'kot12345')).statusCode).toBe(200);
});

async function createClass(name: string, academicYear?: string): Promise<string> {
  const res = await admin.request('POST', '/api/admin/classes', { name, ...(academicYear ? { academicYear } : {}) });
  expect(res.statusCode).toBe(201);
  return res.json().class.id;
}

async function createViaApi(body: Record<string, unknown>) {
  const res = await admin.request('POST', '/api/admin/users', body);
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('доступ к панели', () => {
  it('учитель и ученик не имеют доступа', async () => {
    await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER' });
    const t = new TestClient(app);
    await t.login('teacher', 'kot12345');
    for (const url of ['/api/admin/users', '/api/admin/classes', '/api/admin/audit', '/api/admin/stats']) {
      expect((await t.request('GET', url)).statusCode).toBe(403);
    }
    expect((await t.request('POST', '/api/admin/users', { fullName: 'Хакер', role: 'ADMIN' })).statusCode).toBe(403);
    expect((await new TestClient(app).request('GET', '/api/admin/users')).statusCode).toBe(401);
  });
});

describe('пользователи', () => {
  it('создание: логин из ФИО, временный пароль, обязательная смена при входе', async () => {
    const classId = await createClass('9А');
    const { user, credential } = await createViaApi({ fullName: 'Иванов Пётр Сергеевич', role: 'STUDENT', classIds: [classId] });
    expect(user).toMatchObject({ login: 'ivanov.ps', role: 'STUDENT', mustChangePassword: true });
    expect(user.classes).toEqual([{ id: classId, name: '9А', academicYear: null, role: 'STUDENT' }]);
    expect(credential).toMatchObject({ login: 'ivanov.ps', className: '9А' });
    expect(credential.tempPassword).toMatch(/^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{4}$/);

    // Тёзка получает следующий свободный логин.
    const second = await createViaApi({ fullName: 'Иванов Павел Семёнович', role: 'STUDENT' });
    expect(second.user.login).toBe('ivanov.ps2');

    const s = new TestClient(app);
    const login = await s.login('ivanov.ps', credential.tempPassword);
    expect(login.statusCode).toBe(200);
    expect(login.json().user.mustChangePassword).toBe(true);

    const audit = await testPrisma().auditLog.findFirstOrThrow({ where: { action: 'USER_CREATED' } });
    expect(audit.actorId).toBe(adminId);
    expect(JSON.stringify(audit.details)).not.toContain(credential.tempPassword);
  });

  it('занятый логин и ошибки валидации', async () => {
    await createViaApi({ fullName: 'Петров Пётр', login: 'petrov', role: 'TEACHER' });
    const dup = await admin.request('POST', '/api/admin/users', { fullName: 'Другой', login: 'Petrov', role: 'STUDENT' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.login).toBeDefined();
    const bad = await admin.request('POST', '/api/admin/users', { fullName: '', role: 'BOSS', login: 'а' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.details).sort()).toEqual(['fullName', 'login', 'role']);
    const adminInClass = await admin.request('POST', '/api/admin/users', {
      fullName: 'Второй Админ',
      role: 'ADMIN',
      classIds: [await createClass('5Б')],
    });
    expect(adminInClass.statusCode).toBe(400);
  });

  it('список: поиск, фильтры, сортировка, пагинация', async () => {
    const c9 = await createClass('9А');
    await createViaApi({ fullName: 'Алексеева Анна', role: 'STUDENT', classIds: [c9] });
    await createViaApi({ fullName: 'Борисов Борис', role: 'STUDENT', classIds: [c9] });
    await createViaApi({ fullName: 'Васильев Виктор', role: 'STUDENT' });
    await createViaApi({ fullName: 'Григорьева Галина', role: 'TEACHER', classIds: [c9] });

    const all = (await admin.request('GET', '/api/admin/users?pageSize=2&page=1')).json();
    expect(all.total).toBe(5);
    expect(all.items.map((u: { fullName: string }) => u.fullName)).toEqual(['Алексеева Анна', 'Борисов Борис']);
    const p3 = (await admin.request('GET', '/api/admin/users?pageSize=2&page=3')).json();
    expect(p3.items).toHaveLength(1);

    const search = (await admin.request('GET', `/api/admin/users?search=${encodeURIComponent('борис')}`)).json();
    expect(search.items.map((u: { login: string }) => u.login)).toEqual(['borisov.b']);
    const byLogin = (await admin.request('GET', '/api/admin/users?search=VASIL')).json();
    expect(byLogin.total).toBe(1);

    const students9 = (await admin.request('GET', `/api/admin/users?role=STUDENT&classId=${c9}`)).json();
    expect(students9.total).toBe(2);
    const noClass = (await admin.request('GET', '/api/admin/users?role=STUDENT&noClass=true')).json();
    expect(noClass.items.map((u: { fullName: string }) => u.fullName)).toEqual(['Васильев Виктор']);
    const pending = (await admin.request('GET', '/api/admin/users?status=pending')).json();
    expect(pending.total).toBe(4);
    const desc = (await admin.request('GET', '/api/admin/users?sort=fullName&order=desc&pageSize=1')).json();
    expect(desc.items[0].fullName).toBe('Григорьева Галина');
    expect((await admin.request('GET', '/api/admin/users?pageSize=1000')).statusCode).toBe(400);
  });

  it('редактирование: смена роли сохраняет классы с новой ролью участника', async () => {
    const c = await createClass('10А');
    const { user } = await createViaApi({ fullName: 'Смирнова Ольга', role: 'STUDENT', classIds: [c] });
    const res = await admin.request('PATCH', `/api/admin/users/${user.id}`, { role: 'TEACHER', fullName: 'Смирнова Ольга Ивановна', login: 'smirnova' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ role: 'TEACHER', login: 'smirnova', fullName: 'Смирнова Ольга Ивановна' });
    expect(res.json().user.classes[0].role).toBe('TEACHER');

    const toAdmin = await admin.request('PATCH', `/api/admin/users/${user.id}`, { role: 'ADMIN' });
    expect(toAdmin.json().user.classes).toEqual([]);

    const log = await testPrisma().auditLog.findFirstOrThrow({ where: { action: 'USER_UPDATED' }, orderBy: { id: 'asc' } });
    expect(log.details).toMatchObject({ changes: { role: { from: 'STUDENT', to: 'TEACHER' }, login: { from: 'smirnova.o', to: 'smirnova' } } });
    expect((await admin.request('PATCH', `/api/admin/users/${user.id}`, {})).statusCode).toBe(400);
  });

  it('защита от потери последнего администратора и действий над собой', async () => {
    expect((await admin.request('PATCH', `/api/admin/users/${adminId}`, { role: 'TEACHER' })).statusCode).toBe(409);
    expect((await admin.request('POST', `/api/admin/users/${adminId}/block`, {})).statusCode).toBe(409);
    expect((await admin.request('DELETE', `/api/admin/users/${adminId}`, { confirmLogin: 'admin' })).statusCode).toBe(409);
    // Своё ФИО менять можно.
    expect((await admin.request('PATCH', `/api/admin/users/${adminId}`, { fullName: 'Новое Имя' })).statusCode).toBe(200);
  });

  it('блокировка завершает сессию, разблокировка снимает и временную блокировку входа', async () => {
    const u = await createUser({ login: 'student1', password: 'kot12345' });
    const s = new TestClient(app);
    await s.login('student1', 'kot12345');
    const res = await admin.request('POST', `/api/admin/users/${u.id}/block`, { reason: 'Нарушение правил' });
    expect(res.json().user).toMatchObject({ isBlocked: true, blockedReason: 'Нарушение правил' });
    expect((await s.request('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await s.request('POST', '/api/auth/refresh')).statusCode).toBe(401);
    expect((await s.login('student1', 'kot12345')).json().error.code).toBe('ACCOUNT_BLOCKED');

    await testPrisma().user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 5 } });
    const blockedList = (await admin.request('GET', '/api/admin/users?status=blocked')).json();
    expect(blockedList.total).toBe(1);
    const un = await admin.request('POST', `/api/admin/users/${u.id}/unblock`);
    expect(un.json().user).toMatchObject({ isBlocked: false, lockedUntil: null });
    expect((await s.login('student1', 'kot12345')).statusCode).toBe(200);
  });

  it('сброс пароля', async () => {
    const u = await createUser({ login: 'forgetful', password: 'kot12345' });
    const s = new TestClient(app);
    await s.login('forgetful', 'kot12345');
    await new Promise((r) => setTimeout(r, 1100));
    const res = await admin.request('POST', `/api/admin/users/${u.id}/reset-password`);
    expect(res.statusCode).toBe(200);
    const { tempPassword } = res.json().credential;
    expect((await s.request('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await new TestClient(app).login('forgetful', 'kot12345')).statusCode).toBe(401);
    const fresh = await new TestClient(app).login('forgetful', tempPassword);
    expect(fresh.json().user.mustChangePassword).toBe(true);
    expect(await testPrisma().auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: u.id } })).toBe(1);
  });

  it('удаление с подтверждением освобождает логин', async () => {
    const { user } = await createViaApi({ fullName: 'Удаляемый Ученик', login: 'gone', role: 'STUDENT', classIds: [await createClass('7В')] });
    const wrong = await admin.request('DELETE', `/api/admin/users/${user.id}`, { confirmLogin: 'other' });
    expect(wrong.statusCode).toBe(400);
    expect((await admin.request('DELETE', `/api/admin/users/${user.id}`, { confirmLogin: 'GONE' })).statusCode).toBe(204);
    expect((await admin.request('GET', `/api/admin/users/${user.id}`)).statusCode).toBe(404);
    expect((await admin.request('GET', '/api/admin/users?search=gone')).json().total).toBe(0);
    const row = await testPrisma().user.findUniqueOrThrow({ where: { id: user.id }, include: { classMemberships: true } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.fullName).toBe('Удаляемый Ученик');
    expect(row.classMemberships).toHaveLength(0);
    // Логин снова свободен.
    await createViaApi({ fullName: 'Новый Ученик', login: 'gone', role: 'STUDENT' });
    const log = await testPrisma().auditLog.findFirstOrThrow({ where: { action: 'USER_DELETED' } });
    expect(log.details).toMatchObject({ login: 'gone', fullName: 'Удаляемый Ученик' });
  });

  it('предложение логина', async () => {
    await createViaApi({ fullName: 'Кузнецов Андрей', role: 'STUDENT' });
    const res = await admin.request('GET', `/api/admin/users/suggest-login?fullName=${encodeURIComponent('Кузнецов Алексей')}`);
    expect(res.json().login).toBe('kuznetsov.a2');
  });
});

describe('импорт CSV', () => {
  const csv = [
    'ФИО;Логин;Роль;Класс',
    'Абрамов Артём Олегович;;ученик;8А',
    '"Белова; Мария";belova.m;Ученик;8А',
    'Чернов Игорь;;учитель;8Б',
  ].join('\r\n');

  it('предпросмотр не создаёт пользователей и показывает ошибки', async () => {
    await createClass('8А');
    const res = await admin.request('POST', '/api/admin/users/import', { csv, dryRun: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows.map((r: { login: string }) => r.login)).toEqual(['abramov.ao', 'belova.m', 'chernov.i']);
    expect(body.rows[0]).toMatchObject({ loginGenerated: true, className: '8А', newClass: false });
    expect(body.errors).toEqual([{ line: 4, messages: [expect.stringContaining('Класс «8Б» не найден')] }]);
    expect(await testPrisma().user.count()).toBe(1);

    const withCreate = (await admin.request('POST', '/api/admin/users/import', { csv, dryRun: true, createMissingClasses: true })).json();
    expect(withCreate.errors).toEqual([]);
    expect(withCreate.createdClasses).toEqual(['8Б']);
  });

  it('импорт с ошибками атомарно отклоняется', async () => {
    const bad = 'Иванов Иван;ivanov;ученик\nПетров Пётр;ivanov;ученик\n;;\nСидоров;;директор';
    const res = await admin.request('POST', '/api/admin/users/import', { csv: bad });
    expect(res.statusCode).toBe(400);
    const errors = res.json().error.details.errors as { line: number; messages: string[] }[];
    expect(errors.map((e) => e.line)).toEqual([1, 2, 4]);
    expect(await testPrisma().user.count()).toBe(1);
  });

  it('реальный импорт: пользователи, классы, временные пароли', async () => {
    const extra = await createClass('Физтех-кружок');
    const res = await admin.request('POST', '/api/admin/users/import', {
      csv,
      createMissingClasses: true,
      academicYear: '2026/2027',
      classId: extra,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credentials).toHaveLength(3);
    expect(body.createdClasses.sort()).toEqual(['8Б', '8А'].sort());
    const chernov = await testPrisma().user.findUniqueOrThrow({
      where: { login: 'chernov.i' },
      include: { classMemberships: { include: { class: true } } },
    });
    expect(chernov.role).toBe('TEACHER');
    expect(chernov.classMemberships.map((m) => [m.class.name, m.role]).sort()).toEqual([
      ['8Б', 'TEACHER'],
      ['Физтех-кружок', 'TEACHER'],
    ]);
    const belova = body.credentials.find((c: { login: string }) => c.login === 'belova.m');
    expect(belova.fullName).toBe('Белова; Мария');
    expect((await new TestClient(app).login('belova.m', belova.tempPassword)).statusCode).toBe(200);
    const log = await testPrisma().auditLog.findFirstOrThrow({ where: { action: 'USER_IMPORTED' } });
    expect(log.details).toMatchObject({ count: 3 });
    expect(JSON.stringify(log.details)).not.toContain(belova.tempPassword);
  });

  it('файл без заголовка, роль по умолчанию', async () => {
    const res = await admin.request('POST', '/api/admin/users/import', { csv: 'Дмитриев Дмитрий\nЕгорова Елена', defaultRole: 'TEACHER' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { role: string }) => r.role)).toEqual(['TEACHER', 'TEACHER']);
  });
});

describe('классы', () => {
  it('создание, дубли, состав, учителя, архив, удаление', async () => {
    const id = await createClass('11А', '2026/2027');
    expect((await admin.request('POST', '/api/admin/classes', { name: '11а', academicYear: '2026/2027' })).statusCode).toBe(409);
    expect((await admin.request('POST', '/api/admin/classes', { name: '11А', academicYear: '2027/2028' })).statusCode).toBe(201);
    await createClass('Кружок');
    expect((await admin.request('POST', '/api/admin/classes', { name: 'кружок' })).statusCode).toBe(409);

    const s1 = await createUser({ login: 's1', password: 'kot12345', fullName: 'Яковлев Ян' });
    const s2 = await createUser({ login: 's2', password: 'kot12345', fullName: 'Абрамова Ася' });
    const t1 = await createUser({ login: 't1', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель Физики' });

    const added = await admin.request('POST', `/api/admin/classes/${id}/members`, { userIds: [s1.id, s2.id, t1.id] });
    expect(added.statusCode).toBe(200);
    const cls = added.json().class;
    expect(cls.students.map((s: { fullName: string }) => s.fullName)).toEqual(['Абрамова Ася', 'Яковлев Ян']);
    expect(cls.teachers).toEqual([{ id: t1.id, fullName: 'Учитель Физики' }]);
    expect(cls.studentCount).toBe(2);
    // Повторное добавление не дублирует.
    expect((await admin.request('POST', `/api/admin/classes/${id}/members`, { userIds: [s1.id] })).json().class.studentCount).toBe(2);
    expect((await admin.request('POST', `/api/admin/classes/${id}/members`, { userIds: [adminId] })).statusCode).toBe(400);

    const removed = await admin.request('DELETE', `/api/admin/classes/${id}/members/${s1.id}`);
    expect(removed.json().class.studentCount).toBe(1);

    const list = (await admin.request('GET', '/api/admin/classes?academicYear=2026/2027')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: '11А', studentCount: 1 });

    const archived = await admin.request('PATCH', `/api/admin/classes/${id}`, { archived: true });
    expect(archived.json().class.archived).toBe(true);
    expect((await admin.request('GET', '/api/admin/classes?academicYear=2026/2027')).json().total).toBe(0);
    expect((await admin.request('GET', '/api/admin/classes?academicYear=2026/2027&includeArchived=true')).json().total).toBe(1);
    expect((await admin.request('POST', `/api/admin/classes/${id}/members`, { userIds: [s1.id] })).statusCode).toBe(409);

    expect((await admin.request('DELETE', `/api/admin/classes/${id}`, { confirmName: 'не то' })).statusCode).toBe(400);
    expect((await admin.request('DELETE', `/api/admin/classes/${id}`, { confirmName: '11а' })).statusCode).toBe(204);
    expect(await testPrisma().user.count({ where: { id: s2.id } })).toBe(1);
  });

  it('массовый сброс паролей ученикам класса', async () => {
    const id = await createClass('6А');
    const a = await createUser({ login: 'aaa1', password: 'kot12345', fullName: 'Аа Аа' });
    const b = await createUser({ login: 'bbb1', password: 'kot12345', fullName: 'Бб Бб', mustChangePassword: true });
    const t = await createUser({ login: 'ttt9', password: 'kot12345', role: 'TEACHER' });
    await admin.request('POST', `/api/admin/classes/${id}/members`, { userIds: [a.id, b.id, t.id] });

    const pending = (await admin.request('POST', `/api/admin/classes/${id}/reset-passwords`, { onlyPending: true })).json();
    expect(pending.credentials.map((c: { login: string }) => c.login)).toEqual(['bbb1']);
    const all = (await admin.request('POST', `/api/admin/classes/${id}/reset-passwords`, {})).json();
    expect(all.credentials.map((c: { login: string }) => c.login)).toEqual(['aaa1', 'bbb1']);
    expect(all.credentials[0].className).toBe('6А');
    // Учитель класса не затронут.
    expect((await new TestClient(app).login('ttt9', 'kot12345')).statusCode).toBe(200);
  });
});

describe('журнал и сводка', () => {
  it('журнал: фильтры, поиск, подписи целей', async () => {
    const { user } = await createViaApi({ fullName: 'Журналов Иван', login: 'zhurnal', role: 'STUDENT' });
    await new TestClient(app).login('zhurnal', 'wrong-pass1');

    const all = (await admin.request('GET', '/api/admin/audit')).json();
    expect(all.items[0].action).toBe('LOGIN_FAILED');
    const created = (await admin.request('GET', '/api/admin/audit?actions=USER_CREATED')).json();
    expect(created.items).toHaveLength(1);
    expect(created.items[0]).toMatchObject({
      actor: { id: adminId, login: 'admin', fullName: 'Главный Админ' },
      targetId: user.id,
      targetLabel: 'Журналов Иван',
    });
    const logins = (await admin.request('GET', '/api/admin/audit?actions=LOGIN_SUCCESS,LOGIN_FAILED&search=zhurnal')).json();
    expect(logins.total).toBe(1);
    const future = (await admin.request('GET', '/api/admin/audit?from=2100-01-01')).json();
    expect(future.total).toBe(0);
    expect((await admin.request('GET', '/api/admin/audit?actions=HACK')).statusCode).toBe(400);
  });

  it('сводка', async () => {
    await createViaApi({ fullName: 'Ученик Один', role: 'STUDENT' });
    await createViaApi({ fullName: 'Учитель Один', role: 'TEACHER' });
    await createClass('5А');
    const stats = (await admin.request('GET', '/api/admin/stats')).json();
    expect(stats).toMatchObject({
      users: { total: 3, admins: 1, teachers: 1, students: 1, blocked: 0, pendingPassword: 2 },
      classes: 1,
      loginsToday: 1,
    });
  });
});
