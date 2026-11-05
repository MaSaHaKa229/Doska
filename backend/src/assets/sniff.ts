/**
 * Проверка загружаемых файлов по содержимому (сигнатура и структура), а не
 * по имени или заголовку Content-Type. Картинки очищаются от метаданных
 * (EXIF с координатами съёмки, XMP, IPTC, комментарии) без перекодирования:
 * изображение не теряет качества, а структура файла при разборе
 * проверяется — повреждённый или подделанный файл отклоняется.
 */

export type AssetMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf';

export const EXT_BY_MIME: Record<AssetMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export class FileRejected extends Error {}

/** Предел размера картинки по сторонам и площади (защита от «бомб» распаковки). */
export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_PIXELS = 100_000_000;

export function detectMime(buf: Buffer): AssetMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export interface ImageInfo {
  width: number;
  height: number;
  /** Файл без метаданных. */
  data: Buffer;
}

function checkSize(width: number, height: number): void {
  if (!(width > 0 && height > 0)) throw new FileRejected('Не удалось определить размер изображения');
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new FileRejected(`Изображение слишком большое: ${width}×${height} (не больше ${MAX_IMAGE_SIDE} пикселей по стороне)`);
  }
}

const bad = (what: string) => new FileRejected(`Файл повреждён или не является изображением (${what})`);

// ---------------------------------------------------------------------
//  PNG
// ---------------------------------------------------------------------

/** Текстовые и служебные блоки PNG, которые не влияют на изображение. */
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function processPng(buf: Buffer): ImageInfo {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let pos = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  let first = true;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (len > 0x7fffffff || end > buf.length || !/^[A-Za-z]{4}$/.test(type)) throw bad('PNG: блок');
    if (first) {
      if (type !== 'IHDR' || len !== 13) throw bad('PNG: заголовок');
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      first = false;
    }
    if (!PNG_DROP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw bad('PNG: нет конца файла');
  checkSize(width, height);
  return { width, height, data: Buffer.concat(out) };
}

// ---------------------------------------------------------------------
//  JPEG
// ---------------------------------------------------------------------

/** Сегменты JPEG, которые сохраняются: JFIF (APP0), цветовой профиль ICC (APP2), Adobe (APP14). */
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

function processJpeg(buf: Buffer): ImageInfo {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  let width = 0;
  let height = 0;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw bad('JPEG: маркер');
    // Заполняющие байты 0xFF перед маркером допустимы.
    while (buf[pos + 1] === 0xff) pos++;
    const marker = buf[pos + 1];
    if (marker === undefined) throw bad('JPEG: конец файла');
    if (marker === 0xd9) {
      out.push(buf.subarray(pos, pos + 2));
      checkSize(width, height);
      return { width, height, data: Buffer.concat(out) };
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) throw bad('JPEG: сегмент');
    const len = buf.readUInt16BE(pos + 2);
    const end = pos + 2 + len;
    if (len < 2 || end > buf.length) throw bad('JPEG: длина сегмента');
    // SOF0–SOF15, кроме DHT (C4), JPG (C8) и DAC (CC): размеры кадра.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7) throw bad('JPEG: кадр');
      height = buf.readUInt16BE(pos + 5);
      width = buf.readUInt16BE(pos + 7);
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const drop = (isApp && !JPEG_KEEP_APP.has(marker)) || marker === 0xfe;
    if (!drop) out.push(buf.subarray(pos, end));
    if (marker === 0xda) {
      // Начало сжатых данных: дальше до EOI копируется как есть (внутри
      // данных 0xFF всегда экранирован 0x00 или является маркером RSTn).
      let p = end;
      while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1]! >= 0xd0 && buf[p + 1]! <= 0xd7))) p++;
      out.push(buf.subarray(end, p));
      pos = p;
      continue;
    }
    pos = end;
  }
  throw bad('JPEG: нет конца файла');
}

// ---------------------------------------------------------------------
//  GIF
// ---------------------------------------------------------------------

function skipSubBlocks(buf: Buffer, pos: number): number {
  while (true) {
    if (pos >= buf.length) throw bad('GIF: блок данных');
    const n = buf[pos]!;
    pos += 1 + n;
    if (n === 0) return pos;
  }
}

function processGif(buf: Buffer): ImageInfo {
  if (buf.length < 13) throw bad('GIF: заголовок');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10]!;
  let pos = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  const out: Buffer[] = [buf.subarray(0, pos)];
  while (pos < buf.length) {
    const b = buf[pos]!;
    if (b === 0x3b) {
      out.push(buf.subarray(pos, pos + 1));
      checkSize(width, height);
      return { width, height, data: Buffer.concat(out) };
    }
    if (b === 0x21) {
      const label = buf[pos + 1];
      const end = skipSubBlocks(buf, pos + 2);
      // Комментарии (0xFE) и расширения приложений, кроме повтора анимации (NETSCAPE2.0), убираются.
      const isLoop = label === 0xff && buf.toString('latin1', pos + 3, pos + 14) === 'NETSCAPE2.0';
      if (label !== 0xfe && (label !== 0xff || isLoop)) out.push(buf.subarray(pos, end));
      pos = end;
      continue;
    }
    if (b === 0x2c) {
      if (pos + 10 > buf.length) throw bad('GIF: кадр');
      const f = buf[pos + 9]!;
      let p = pos + 10 + (f & 0x80 ? 3 * 2 ** ((f & 7) + 1) : 0);
      p = skipSubBlocks(buf, p + 1); // минимальный размер кода LZW + данные
      out.push(buf.subarray(pos, p));
      pos = p;
      continue;
    }
    throw bad('GIF: неизвестный блок');
  }
  throw bad('GIF: нет конца файла');
}

// ---------------------------------------------------------------------
//  WebP
// ---------------------------------------------------------------------

function processWebp(buf: Buffer): ImageInfo {
  const riffEnd = 8 + buf.readUInt32LE(4);
  if (riffEnd > buf.length || riffEnd < 20) throw bad('WebP: размер');
  const chunks: Buffer[] = [];
  let pos = 12;
  let width = 0;
  let height = 0;
  let vp8x: Buffer | null = null;
  while (pos + 8 <= riffEnd) {
    const type = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + len + (len & 1);
    if (end > riffEnd + 1) throw bad('WebP: блок');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'VP8X' && len >= 10) {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && !width && len >= 10) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && !width && len >= 5) {
      if (data[0] !== 0x2f) throw bad('WebP: VP8L');
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
      if (type === 'VP8X') vp8x = chunk;
      chunks.push(chunk);
    }
    pos = end;
  }
  // Флаги «есть EXIF» и «есть XMP» в VP8X снимаются вместе с блоками.
  if (vp8x) vp8x[8] = vp8x[8]! & ~0x0c;
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  checkSize(width, height);
  return { width, height, data: Buffer.concat([header, body]) };
}

/** Проверить картинку, получить размеры и убрать метаданные. */
export function processImage(buf: Buffer, mime: Exclude<AssetMime, 'application/pdf'>): ImageInfo {
  try {
    switch (mime) {
      case 'image/png':
        return processPng(buf);
      case 'image/jpeg':
        return processJpeg(buf);
      case 'image/gif':
        return processGif(buf);
      case 'image/webp':
        return processWebp(buf);
    }
  } catch (err) {
    if (err instanceof FileRejected) throw err;
    throw bad('структура');
  }
}

/** Минимальная проверка PDF: заголовок и признак конца файла. Разбор страниц — в браузере (pdf.js). */
export function checkPdf(buf: Buffer): void {
  const tail = buf.toString('latin1', Math.max(0, buf.length - 1024));
  if (!tail.includes('%%EOF')) throw new FileRejected('Файл PDF повреждён (нет признака конца файла)');
}
