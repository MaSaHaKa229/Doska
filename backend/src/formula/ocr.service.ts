import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../common/errors.js';
import { detectMime } from '../assets/sniff.js';

/** Предельный размер картинки рукописи (браузер присылает PNG небольшого размера). */
export const OCR_MAX_BYTES = 2 * 1024 * 1024;
/** Предельная длина распознанной записи (как у формулы на доске). */
export const OCR_MAX_LATEX = 2000;

export interface OcrConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

const unavailable = () => new AppError(503, 'SERVICE_UNAVAILABLE', 'Распознавание формул сейчас недоступно. Попробуйте позже');

/**
 * Распознавание рукописной формулы: картинка (PNG) пересылается сервису
 * FORMULA_OCR_URL. Протокол сервиса: POST, тело — PNG (Content-Type:
 * image/png), необязательный заголовок Authorization: Bearer <ключ>; ответ —
 * JSON { "latex": "…" } или просто строка JSON (так отвечает pix2tex).
 * Внутренний адрес сервиса пользователю не показывается.
 */
export class FormulaOcrService {
  constructor(
    private readonly config: OcrConfig,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async recognize(image: Buffer): Promise<string> {
    if (image.length > OCR_MAX_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Слишком большая область для распознавания');
    if (detectMime(image) !== 'image/png') throw new AppError(422, 'FILE_REJECTED', 'Ожидалась картинка PNG');
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          accept: 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'сервис распознавания формул не ответил');
      throw unavailable();
    }
    if (!res.ok) {
      this.log.warn({ status: res.status }, 'сервис распознавания формул вернул ошибку');
      throw unavailable();
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      this.log.warn('сервис распознавания формул вернул не JSON');
      throw unavailable();
    }
    const raw = typeof body === 'string' ? body : body && typeof body === 'object' && typeof (body as { latex?: unknown }).latex === 'string' ? (body as { latex: string }).latex : null;
    if (raw === null) {
      this.log.warn('ответ сервиса распознавания формул без поля latex');
      throw unavailable();
    }
    return cleanLatex(raw);
  }
}

/** Убрать обрамление $…$ / \[…\], управляющие символы и лишнюю длину. */
export function cleanLatex(raw: string): string {
  let s = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  s = s.replace(/^\$\$?([\s\S]*?)\$\$?$/, '$1').replace(/^\\\[([\s\S]*)\\\]$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1');
  return s.trim().slice(0, OCR_MAX_LATEX);
}
