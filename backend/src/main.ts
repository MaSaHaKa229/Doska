import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await buildApp({ config });

  // Корректное завершение: дождаться текущих запросов, закрыть соединения с БД.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'Остановка сервера…');
    const timer = setTimeout(() => {
      app.log.error('Сервер не остановился за 20 с — принудительное завершение');
      process.exit(1);
    }, 20_000);
    timer.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Ошибка при остановке');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
