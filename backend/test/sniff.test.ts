import { describe, expect, it } from 'vitest';
import { FileRejected, checkPdf, detectMime, processImage } from '../src/assets/sniff.js';
import { makePng } from './files.js';

const seg = (marker: number, data: Buffer) => {
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([h, data]);
};
function makeJpeg(w: number, h: number): Buffer {
  const sof = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  sof.writeUInt16BE(h, 1);
  sof.writeUInt16BE(w, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=55.75', 'latin1')),
    seg(0xfe, Buffer.from('камера', 'utf8')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('распознавание файлов по содержимому', () => {
  it('сигнатуры; имя и заявленный тип не важны', () => {
    expect(detectMime(makePng(2, 2))).toBe('image/png');
    expect(detectMime(makeJpeg(2, 2))).toBe('image/jpeg');
    expect(detectMime(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(detectMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectMime(Buffer.from('MZ\x90\0'))).toBeNull();
  });

  it('PNG: размеры, текстовые метаданные удаляются, структура проверяется', () => {
    const src = makePng(7, 5);
    const r = processImage(src, 'image/png');
    expect([r.width, r.height]).toEqual([7, 5]);
    expect(r.data.includes(Buffer.from('GPS'))).toBe(false);
    expect(r.data.length).toBeLessThan(src.length);
    expect(() => processImage(src.subarray(0, src.length - 20), 'image/png')).toThrow(FileRejected);
  });

  it('JPEG: EXIF и комментарии удаляются, JFIF и сжатые данные сохраняются', () => {
    const r = processImage(makeJpeg(640, 480), 'image/jpeg');
    expect([r.width, r.height]).toEqual([640, 480]);
    expect(r.data.includes(Buffer.from('Exif'))).toBe(false);
    expect(r.data.includes(Buffer.from('камера'))).toBe(false);
    expect(r.data.includes(Buffer.from('JFIF'))).toBe(true);
    expect(r.data.includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(true);
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('GIF: комментарий удаляется', () => {
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'latin1'),
      Buffer.from([3, 0, 2, 0, 0x80, 0, 0]), // 3×2, глобальная палитра из 2 цветов
      Buffer.from([0, 0, 0, 255, 255, 255]),
      Buffer.from([0x21, 0xfe, 5, ...Buffer.from('hello'), 0]),
      Buffer.from([0x2c, 0, 0, 0, 0, 3, 0, 2, 0, 0, 2, 2, 0x44, 0x01, 0]),
      Buffer.from([0x3b]),
    ]);
    const r = processImage(gif, 'image/gif');
    expect([r.width, r.height]).toEqual([3, 2]);
    expect(r.data.includes(Buffer.from('hello'))).toBe(false);
  });

  it('WebP: блок EXIF и флаг в VP8X убираются', () => {
    const chunk = (t: string, d: Buffer) => {
      const h = Buffer.alloc(8);
      h.write(t, 0, 'latin1');
      h.writeUInt32LE(d.length, 4);
      return Buffer.concat([h, d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08;
    vp8x.writeUIntLE(99, 4, 3);
    vp8x.writeUIntLE(49, 7, 3);
    const vp8l = Buffer.from([0x2f, 0, 0, 0, 0, 0]);
    const body = Buffer.concat([chunk('VP8X', vp8x), chunk('EXIF', Buffer.from('GPS secret')), chunk('VP8L', vp8l)]);
    const head = Buffer.alloc(12);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(body.length + 4, 4);
    head.write('WEBP', 8, 'latin1');
    const r = processImage(Buffer.concat([head, body]), 'image/webp');
    expect([r.width, r.height]).toEqual([100, 50]);
    expect(r.data.includes(Buffer.from('GPS'))).toBe(false);
    expect(r.data[20]! & 0x08).toBe(0);
    expect(r.data.readUInt32LE(4)).toBe(r.data.length - 8);
  });

  it('слишком большие изображения и битый PDF отклоняются', () => {
    const big = makePng(1, 1, false);
    big.writeUInt32BE(20000, 16); // ширина в IHDR
    expect(() => processImage(big, 'image/png')).toThrow(/слишком большое/);
    expect(() => checkPdf(Buffer.from('%PDF-1.4\n1 0 obj'))).toThrow(FileRejected);
    expect(() => checkPdf(Buffer.from('%PDF-1.4\ntrailer\n%%EOF\n'))).not.toThrow();
  });
});
