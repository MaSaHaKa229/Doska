import type { FastifyInstance } from 'fastify';
import { Errors } from '../common/errors.js';
import { FormulaOcrService, OCR_MAX_BYTES } from './ocr.service.js';

/**
 * Распознавание рукописных формул:
 *   GET  /api/formula-ocr   { enabled } — включено ли (FORMULA_OCR_URL задан)
 *   POST /api/formula-ocr   тело — PNG с рукописью; ответ { latex }
 */
export async function formulaOcrRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const config = app.config.formulaOcr;
  const service = config ? new FormulaOcrService(config, app.log) : null;
  app.addContentTypeParser(['image/png', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: OCR_MAX_BYTES + 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/formula-ocr', async (_req, reply) => reply.header('cache-control', 'no-store').send({ enabled: !!service }));

  app.post(
    '/formula-ocr',
    {
      bodyLimit: OCR_MAX_BYTES + 1024,
      // Распознавание тяжёлое: ограничение на пользователя, а не только на адрес.
      config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (req) => req.auth?.userId ?? req.ip } },
    },
    async (req, reply) => {
      if (!req.auth) throw Errors.unauthenticated();
      if (!service) throw Errors.notFound('Распознавание формул не настроено на этом сервере');
      if (!Buffer.isBuffer(req.body)) throw Errors.validation({ image: ['Ожидалась картинка PNG'] }, 'Ожидалась картинка PNG');
      const latex = await service.recognize(req.body);
      return reply.header('cache-control', 'no-store').send({ latex });
    },
  );
}
