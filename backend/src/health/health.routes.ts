import type { FastifyInstance } from 'fastify';

/**
 * GET /api/health — проверка живости для Docker healthcheck и мониторинга.
 * 200 — процесс работает и БД отвечает; 503 — БД недоступна.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', uptime: Math.round(process.uptime()) };
    } catch (err) {
      request.log.error({ err }, 'Проверка здоровья: БД недоступна');
      return reply.status(503).send({ status: 'error', db: 'unavailable' });
    }
  });
}
