import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Перед всеми тестами применяет миграции к отдельной тестовой БД.
 * Адрес: TEST_DATABASE_URL (по умолчанию локальная doska_test).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://doska:doska@localhost:5432/doska_test?schema=public';

export default function setup(): void {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  execSync('npx prisma migrate deploy', {
    cwd,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
