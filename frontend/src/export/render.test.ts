import { describe, expect, it } from 'vitest';
import { clampRatio, fileName, fitOnPage, pdfPage } from './render';

describe('экспорт', () => {
  it('имя файла: без запрещённых символов, с номером страницы', () => {
    expect(fileName('Урок 5: дроби/проценты?', 'стр. 2', 'png')).toBe('Урок 5 дроби проценты — стр. 2.png');
    expect(fileName('   ', '', 'pdf')).toBe('Доска.pdf');
  });

  it('разрешение ограничено наибольшей стороной растра', () => {
    expect(clampRatio({ x: 0, y: 0, width: 1000, height: 500 }, 3)).toBe(3);
    expect(clampRatio({ x: 0, y: 0, width: 6000, height: 500 }, 3)).toBeCloseTo(8000 / 6000, 12);
  });

  it('лист PDF: A4 по ориентации содержимого; по содержимому — 96 точек на дюйм', () => {
    expect(pdfPage({ x: 0, y: 0, width: 800, height: 400 }, 'a4')).toEqual({ w: 297, h: 210, landscape: true });
    expect(pdfPage({ x: 0, y: 0, width: 400, height: 800 }, 'a4')).toEqual({ w: 210, h: 297, landscape: false });
    const c = pdfPage({ x: 0, y: 0, width: 960, height: 480 }, 'content');
    expect(c.w).toBeCloseTo(254, 9);
    expect(c.h).toBeCloseTo(127, 9);
  });

  it('вписывание в лист с полями: по центру, пропорции сохраняются', () => {
    const b = fitOnPage({ x: 0, y: 0, width: 800, height: 400 }, { w: 297, h: 210 }, 10);
    expect(b.w).toBeCloseTo(277, 9);
    expect(b.h).toBeCloseTo(138.5, 9);
    expect(b.x).toBeCloseTo(10, 9);
    expect(b.y).toBeCloseTo((210 - 138.5) / 2, 9);
  });
});
