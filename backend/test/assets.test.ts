import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { TEST_UPLOADS_DIR, TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { makePdf, makePng } from './files.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await testPrisma().$disconnect();
});

let teacher: TestClient;
let student: TestClient;
let outsider: TestClient;
let boardId: string;

beforeEach(async () => {
  await resetDb();
  const t = await createUser({ login: 'teacher', password: 'kot12345', role: 'TEACHER', fullName: 'Учитель' });
  const s = await createUser({ login: 'student', password: 'kot12345', role: 'STUDENT', fullName: 'Ученик' });
  await createUser({ login: 'outsider', password: 'kot12345', role: 'STUDENT', fullName: 'Посторонний' });
  const cls = await testPrisma().class.create({
    data: { name: '9А', members: { create: [{ userId: t.id, role: 'TEACHER' }, { userId: s.id, role: 'STUDENT' }] } },
  });
  teacher = new TestClient(app);
  student = new TestClient(app);
  outsider = new TestClient(app);
  await teacher.login('teacher', 'kot12345');
  await student.login('student', 'kot12345');
  await outsider.login('outsider', 'kot12345');
  boardId = (await teacher.request('POST', '/api/boards', { title: 'Файлы', classIds: [cls.id], mode: 'LECTURE' })).json().board.id;
});

const upload = (c: TestClient, body: Buffer, type = 'application/octet-stream', name = 'фото%20урока.png', board = boardId) =>
  c.request('POST', `/api/boards/${board}/assets`, body, { headers: { 'content-type': type, 'x-file-name': name } });

describe('загрузка файлов', () => {
  it('картинка: тип по содержимому, метаданные удалены, размеры, выдача с защитными заголовками', async () => {
    const res = await upload(teacher, makePng(40, 30));
    expect(res.statusCode).toBe(201);
    const asset = res.json().asset;
    expect(asset).toMatchObject({ kind: 'IMAGE', mime: 'image/png', width: 40, height: 30, originalName: 'фото урока.png' });
    const row = await testPrisma().asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(existsSync(join(TEST_UPLOADS_DIR, row.storageKey))).toBe(true);

    // Ученик доски читает файл; содержимое без метаданных.
    const file = await student.request('GET', asset.url);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(String(file.headers['content-security-policy'])).toContain('sandbox');
    expect(file.rawPayload.includes(Buffer.from('GPS'))).toBe(false);
    // Без входа — нельзя.
    expect((await new TestClient(app).request('GET', asset.url)).statusCode).toBe(401);
    expect((await student.request('GET', `/api/assets/${asset.id}/info`)).json().asset.width).toBe(40);
  });

  it('повторная загрузка того же файла на ту же доску возвращает ту же запись', async () => {
    const a = (await upload(teacher, makePng(4, 4))).json().asset;
    const b = (await upload(teacher, makePng(4, 4), 'image/png')).json().asset;
    expect(b.id).toBe(a.id);
    expect(await testPrisma().asset.count()).toBe(1);
  });

  it('PDF принимается, остальное отклоняется по содержимому', async () => {
    const pdf = await upload(teacher, makePdf(), 'application/pdf', 'задачи.pdf');
    expect(pdf.statusCode).toBe(201);
    expect(pdf.json().asset).toMatchObject({ kind: 'PDF', mime: 'application/pdf', width: null });

    const svg = await upload(teacher, Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/png', 'x.png');
    expect(svg.statusCode).toBe(415);
    expect(svg.json().error.code).toBe('FILE_REJECTED');
    const broken = makePng(4, 4).subarray(0, 40);
    expect((await upload(teacher, broken)).statusCode).toBe(422);
    expect((await upload(teacher, Buffer.from('%PDF-1.4\n1 0 obj'), 'application/pdf')).statusCode).toBe(422);
  });

  it('права: загружает только тот, кто пишет на доске', async () => {
    // Режим «Лекция»: ученик не пишет — и файлы не загружает.
    expect((await upload(student, makePng(4, 4))).statusCode).toBe(403);
    expect((await upload(outsider, makePng(4, 4))).statusCode).toBe(404);
    // CSRF обязателен и для загрузки.
    const noCsrf = await teacher.request('POST', `/api/boards/${boardId}/assets`, makePng(4, 4), {
      csrf: false,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('предельный размер файла', async () => {
    const small = await createTestApp({ UPLOAD_MAX_IMAGE_MB: '1' });
    try {
      const c = new TestClient(small);
      await c.login('teacher', 'kot12345');
      const big = Buffer.concat([makePng(4, 4).subarray(0, 8), Buffer.alloc(1024 * 1024 + 10)]);
      const res = await c.request('POST', `/api/boards/${boardId}/assets`, big, { headers: { 'content-type': 'application/octet-stream' } });
      expect(res.statusCode).toBe(413);
    } finally {
      await small.close();
    }
  });
});
