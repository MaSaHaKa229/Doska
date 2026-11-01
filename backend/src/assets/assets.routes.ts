import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseInput } from '../common/errors.js';
import { AssetsService } from './assets.service.js';

const idParams = z.object({ id: z.string().uuid('Неверный идентификатор') });

/**
 * Файлы:
 *   POST /api/boards/:id/assets   загрузить картинку или PDF (тело — файл целиком,
 *                                 имя — заголовок X-File-Name в кодировке URI)
 *   GET  /api/assets/:id          содержимое файла
 *   GET  /api/assets/:id/info     сведения о файле
 */
export async function assetsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const service = new AssetsService(app.prisma, app.storage, app.config.uploads);
  const bodyLimit = Math.max(app.config.uploads.maxImageBytes, app.config.uploads.maxPdfBytes) + 1024;
  // Тело — файл как есть (без multipart): тип всё равно определяется по содержимому.
  const asBuffer = (_req: unknown, body: Buffer | string, done: (err: Error | null, body?: unknown) => void) => done(null, body);
  app.addContentTypeParser(['application/octet-stream', 'application/pdf'], { parseAs: 'buffer', bodyLimit }, asBuffer);
  app.addContentTypeParser(/^image\/[\w.+-]+$/, { parseAs: 'buffer', bodyLimit }, asBuffer);
  const user = (req: { auth: { userId: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' } | null }) => {
    if (!req.auth) throw Errors.unauthenticated();
    return { id: req.auth.userId, role: req.auth.role };
  };

  app.post('/boards/:id/assets', { bodyLimit, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw Errors.validation({ file: ['Ожидалось содержимое файла'] }, 'Ожидалось содержимое файла');
    const name = req.headers['x-file-name'];
    const asset = await service.upload(user(req), parseInput(idParams, req.params).id, req.body, typeof name === 'string' ? name : null);
    return reply.status(201).header('cache-control', 'no-store').send({ asset });
  });

  app.get('/assets/:id/info', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.header('cache-control', 'no-store').send({ asset: await service.info(parseInput(idParams, req.params).id) }),
  );

  app.get('/assets/:id', { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await service.read(parseInput(idParams, req.params).id);
    return (
      reply
        .type(file.mime)
        // Содержимое по id не меняется — кэшировать можно надолго, но только браузеру пользователя.
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        // Даже если браузер откроет файл отдельно, скрипты в нём не выполнятся.
        .header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header('content-disposition', `inline${file.name ? `; filename*=UTF-8''${encodeURIComponent(file.name)}` : ''}`)
        .send(file.data)
    );
  });
}
