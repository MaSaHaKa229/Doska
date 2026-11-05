import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { TestClient, createTestApp, createUser, resetDb, testPrisma } from './helpers.js';
import { makePdf, makePng } from './files.js';
import { cleanLatex } from '../src/formula/ocr.service.js';

/** Подставной сервис распознавания: отвечает тем, что задал тест. */
let reply: { status: number; body: string } = { status: 200, body: '{"latex":"x^2"}' };
let lastRequest: { type?: string; auth?: string; size: number } | null = null;
let ocr: Server;
let ocrUrl: string;

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

let enabled: FastifyInstance;
let disabled: FastifyInstance;

beforeAll(async () => {
  ocr = createServer(async (req, res) => {
    const body = await readBody(req);
    lastRequest = { type: req.headers['content-type'], auth: req.headers.authorization, size: body.length };
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body);
  });
  await new Promise<void>((r) => ocr.listen(0, '127.0.0.1', r));
  ocrUrl = `http://127.0.0.1:${(ocr.address() as AddressInfo).port}/predict`;
  enabled = await createTestApp({ FORMULA_OCR_URL: ocrUrl, FORMULA_OCR_API_KEY: 'test-key' });
  disabled = await createTestApp();
});
afterAll(async () => {
  await enabled.close();
  await disabled.close();
  await new Promise((r) => ocr.close(r));
  await testPrisma().$disconnect();
});

let user: TestClient;
let off: TestClient;
beforeEach(async () => {
  await resetDb();
  await createUser({ login: 'student', password: 'kot12345', role: 'STUDENT' });
  user = new TestClient(enabled);
  off = new TestClient(disabled);
  await user.login('student', 'kot12345');
  await off.login('student', 'kot12345');
  reply = { status: 200, body: '{"latex":"x^2"}' };
  lastRequest = null;
});

const send = (c: TestClient, body: Buffer) => c.request('POST', '/api/formula-ocr', body, { headers: { 'content-type': 'image/png' } });

describe('распознавание формул', () => {
  it('сообщает, включено ли распознавание', async () => {
    expect((await user.request('GET', '/api/formula-ocr')).json()).toEqual({ enabled: true });
    expect((await off.request('GET', '/api/formula-ocr')).json()).toEqual({ enabled: false });
    const res = await send(off, makePng(20, 10));
    expect(res.statusCode).toBe(404);
  });

  it('пересылает PNG сервису и возвращает LaTeX', async () => {
    const png = makePng(40, 20);
    const res = await send(user, png);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ latex: 'x^2' });
    expect(lastRequest).toEqual({ type: 'image/png', auth: 'Bearer test-key', size: png.length });
  });

  it('понимает ответ pix2tex (строка JSON) и снимает обрамление $…$', async () => {
    reply = { status: 200, body: JSON.stringify('$$\\frac{a}{b}$$') };
    expect((await send(user, makePng(20, 10))).json()).toEqual({ latex: '\\frac{a}{b}' });
    expect(cleanLatex('\\[x+1\\]\u0007')).toBe('x+1');
    expect(cleanLatex('a'.repeat(3000))).toHaveLength(2000);
  });

  it('ошибка или неверный ответ сервиса — 503 без подробностей', async () => {
    reply = { status: 500, body: 'Internal error at /srv/model' };
    let res = await send(user, makePng(20, 10));
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body).not.toContain('127.0.0.1');
    reply = { status: 200, body: '{"text":"x"}' };
    res = await send(user, makePng(20, 10));
    expect(res.statusCode).toBe(503);
  });

  it('принимает только PNG и только от вошедших', async () => {
    const res = await send(user, makePdf());
    expect(res.statusCode).toBe(422);
    expect(lastRequest).toBeNull();
    const anon = new TestClient(enabled);
    expect((await anon.request('GET', '/api/formula-ocr')).statusCode).toBe(401);
    // Без входа запрос отклоняется (CSRF или вход) и до сервиса не доходит.
    expect((await send(anon, makePng(20, 10))).statusCode).toBeGreaterThanOrEqual(401);
    expect(lastRequest).toBeNull();
  });
});
