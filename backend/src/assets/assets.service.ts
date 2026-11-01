import { createHash } from 'node:crypto';
import type { PrismaClient, UserRole } from '@prisma/client';
import { assetUrl, type AssetView } from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';
import { loadBoardAccess } from '../boards/access.js';
import type { AppConfig } from '../config/env.js';
import { EXT_BY_MIME, FileRejected, checkPdf, detectMime, processImage, type AssetMime } from './sniff.js';
import { newStorageKey, type ObjectStorage } from './storage.js';

type AssetRow = {
  id: string;
  kind: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
};

export function toAssetView(a: AssetRow): AssetView {
  return {
    id: a.id,
    kind: a.kind === 'PDF' ? 'PDF' : 'IMAGE',
    mime: a.mime as AssetView['mime'],
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    originalName: a.originalName,
    url: assetUrl(a.id),
  };
}

/** Имя файла для журнала и интерфейса: без путей и управляющих символов. */
export function cleanFileName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? name.slice(0, 255) : null;
}

/**
 * Загрузка и выдача файлов. Загружать может тот, кто пишет на доске;
 * файл привязывается к доске, но читать его может любой вошедший
 * пользователь, знающий id (случайный UUID): id есть только в документах
 * досок, которые пользователь видит, а копии заданий и шаблонов
 * ссылаются на те же файлы.
 */
export class AssetsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly limits: AppConfig['uploads'],
  ) {}

  async upload(user: { id: string; role: UserRole }, boardId: string, body: Buffer, fileName: string | null): Promise<AssetView> {
    const access = await loadBoardAccess(this.prisma, user, boardId);
    if (!access || !access.caps.view) throw Errors.notFound('Доска не найдена');
    if (!access.caps.write) throw Errors.forbidden('Нет права добавлять файлы на эту доску');
    if (!body.length) throw new AppError(400, 'FILE_REJECTED', 'Пустой файл');

    const mime = detectMime(body);
    if (!mime) {
      throw new AppError(415, 'FILE_REJECTED', 'Можно загрузить картинку (PNG, JPEG, GIF, WebP) или PDF. Тип определяется по содержимому файла');
    }
    const isPdf = mime === 'application/pdf';
    const limit = isPdf ? this.limits.maxPdfBytes : this.limits.maxImageBytes;
    if (body.length > limit) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Файл слишком большой: не больше ${Math.round(limit / 1024 / 1024)} МБ для ${isPdf ? 'PDF' : 'картинки'}`);
    }
    let data = body;
    let width: number | null = null;
    let height: number | null = null;
    try {
      if (isPdf) checkPdf(body);
      else {
        const info = processImage(body, mime as Exclude<AssetMime, 'application/pdf'>);
        data = info.data;
        width = info.width;
        height = info.height;
      }
    } catch (err) {
      if (err instanceof FileRejected) throw new AppError(422, 'FILE_REJECTED', err.message);
      throw err;
    }

    const sha256 = createHash('sha256').update(data).digest('hex');
    // Тот же файл на той же доске (вставили второй раз) — существующая запись.
    const same = await this.prisma.asset.findFirst({ where: { boardId, sha256, mime } });
    if (same) return toAssetView(same);

    const storageKey = newStorageKey(EXT_BY_MIME[mime]);
    await this.storage.put(storageKey, data, mime);
    const asset = await this.prisma.asset.create({
      data: {
        kind: isPdf ? 'PDF' : 'IMAGE',
        ownerId: user.id,
        boardId,
        storageKey,
        mime,
        sizeBytes: data.length,
        sha256,
        width,
        height,
        originalName: cleanFileName(fileName),
      },
    });
    return toAssetView(asset);
  }

  async read(id: string): Promise<{ data: Buffer; mime: string; name: string | null }> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw Errors.notFound('Файл не найден');
    return { data: await this.storage.get(asset.storageKey), mime: asset.mime, name: asset.originalName };
  }

  async info(id: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw Errors.notFound('Файл не найден');
    return toAssetView(asset);
  }
}
