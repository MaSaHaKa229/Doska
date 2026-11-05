import { availableParallelism } from 'node:os';

/**
 * map с ограничением параллелизма. Нужен для массового хеширования паролей
 * argon2 (каждый хеш занимает 64 МБ памяти и ~0,1 с CPU): без ограничения
 * импорт 1000 учеников съел бы гигабайты памяти.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Разумный параллелизм хеширования: не больше ядер и не больше 4 (пул потоков libuv). */
export const HASH_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism()));
