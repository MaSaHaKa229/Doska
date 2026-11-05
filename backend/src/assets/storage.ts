import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client as MinioClient } from 'minio';
import type { AppConfig } from '../config/env.js';

/**
 * Хранилище содержимого файлов. Ключи вида assets/<yyyy>/<mm>/<uuid>.<ext>
 * генерирует сервер, поэтому выйти за пределы хранилища ключом нельзя (это
 * дополнительно проверяется у хранилища на диске).
 */
export interface ObjectStorage {
  readonly driver: 's3' | 'fs';
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Проверка доступности при запуске (создаёт бакет/каталог). */
  init(): Promise<void>;
}

const KEY_RE = /^assets\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`Недопустимый ключ хранилища: ${key}`);
}

/** Новый ключ хранилища для файла с расширением ext. */
export function newStorageKey(ext: string, now = new Date()): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `assets/${now.getUTCFullYear()}/${mm}/${randomUUID()}.${ext}`;
}

/** Файлы в каталоге на диске; запись атомарна (временный файл + rename). */
export class FsStorage implements ObjectStorage {
  readonly driver = 'fs' as const;
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    assertKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Ключ вне каталога хранилища');
    return p;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = join(dirname(p), `.${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, p);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** S3-совместимое хранилище (MinIO). */
export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: MinioClient;

  constructor(
    cfg: { endpoint: string; region: string; accessKey: string; secretKey: string },
    private readonly bucket: string,
  ) {
    const url = new URL(cfg.endpoint);
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      region: cfg.region,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      pathStyle: true,
    });
  }

  async init(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket);
  }

  async put(key: string, data: Buffer, mime: string): Promise<void> {
    assertKey(key);
    await this.client.putObject(this.bucket, key, data, data.length, { 'Content-Type': mime });
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.removeObject(this.bucket, key);
  }
}

export function createStorage(config: AppConfig['storage']): ObjectStorage {
  return config.driver === 's3' ? new S3Storage(config, config.bucket) : new FsStorage(config.dir);
}
