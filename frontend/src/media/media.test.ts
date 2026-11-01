import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PDF_POINT_TO_WORLD, computeCapabilities, DEFAULT_BOARD_SETTINGS } from '@doska/shared';
import { applyCrop, clampCrop, type ImageProps } from '../objects/image';
import { imageDisplaySize } from './insert';
import { fitSize, isImageFile, isPdfFile } from './prepareImage';
import { BoardModel } from '../collab/model';
import { registry } from '../plugins/registry';

const T = '11111111-1111-4111-8111-111111111111';

describe('картинки', () => {
  const p: ImageProps = { assetId: '00000000-0000-4000-8000-000000000001', w: 400, h: 300, naturalW: 800, naturalH: 600, crop: null };

  it('обрезка сохраняет масштаб на доске и не выходит за картинку', () => {
    const cropped = applyCrop(p, { x: 100, y: 100, w: 400, h: 200 });
    expect(cropped).toEqual({ crop: { x: 100, y: 100, w: 400, h: 200 }, w: 200, h: 100 });
    // Повторная обрезка уже обрезанной: масштаб тот же (0,5 ед. на пиксель).
    expect(applyCrop({ ...p, ...cropped }, { x: 0, y: 0, w: 800, h: 600 })).toMatchObject({ w: 400, h: 300 });
    expect(applyCrop({ ...p, ...cropped }, null)).toEqual({ crop: null, w: 400, h: 300 });
    expect(clampCrop({ x: -50, y: 590, w: 2000, h: 100 }, 800, 600)).toEqual({ x: 0, y: 590, w: 800, h: 10 });
  });

  it('размер при вставке: натуральный на экране, но не больше доли окна', () => {
    expect(imageDisplaySize(400, 200, 1, 1000)).toEqual({ w: 400, h: 200 });
    expect(imageDisplaySize(400, 200, 2, 1000)).toEqual({ w: 200, h: 100 });
    expect(imageDisplaySize(4000, 2000, 1, 1000)).toEqual({ w: 1000, h: 500 });
    expect(fitSize(8000, 2000)).toEqual({ width: 4096, height: 1024 });
    expect(fitSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it('тип файла по типу и расширению', () => {
    expect(isImageFile({ type: '', name: 'Снимок.JPG' })).toBe(true);
    expect(isImageFile({ type: 'image/svg+xml', name: 'x' })).toBe(true);
    expect(isImageFile({ type: 'text/plain', name: 'a.txt' })).toBe(false);
    expect(isPdfFile({ type: '', name: 'задачи.pdf' })).toBe(true);
  });
});

describe('PDF как фон', () => {
  it('A4 в мировых единицах ≈ 210×297 мм при 4 ед. на мм', () => {
    expect(595 * PDF_POINT_TO_WORLD).toBeCloseTo(210 * 4, -1);
    expect(842 * PDF_POINT_TO_WORLD).toBeCloseTo(297 * 4, -1);
  });

  it('новая страница после PDF-страницы не копирует PDF, но сохраняет сетку', () => {
    const caps = computeCapabilities({
      user: { id: T, role: 'TEACHER' },
      board: { kind: 'LESSON', mode: 'LECTURE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
      memberRole: null,
      studentViaClass: false,
      teachesOwner: false,
      hasChalk: false,
    });
    const m = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: () => caps, ownerId: T });
    const first = m.addPage('PDF')!;
    m.setBackground(first, { kind: 'ruled', pdf: { assetId: '00000000-0000-4000-8000-000000000002', page: 1, width: 840, height: 1188 } });
    const next = m.addPage('Дальше', first)!;
    expect(m.page(next)!.background).toMatchObject({ kind: 'ruled', pdf: null });
    expect(m.page(first)!.background.pdf?.page).toBe(1);
    m.destroy();
  });
});

describe('несколько страниц одним шагом', () => {
  it('addPages: порядок после текущей, фон с PDF, одна отмена', () => {
    const caps = computeCapabilities({
      user: { id: T, role: 'TEACHER' },
      board: { kind: 'LESSON', mode: 'LECTURE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
      memberRole: null,
      studentViaClass: false,
      teachesOwner: false,
      hasChalk: false,
    });
    const doc = new Y.Doc();
    const m = new BoardModel(doc, { userId: T, registry, getCaps: () => caps, ownerId: T });
    const first = m.addPage('Первая')!;
    m.addPage('Последняя');
    m.undo.stopCapturing();
    const pdf = (page: number) => ({ assetId: '00000000-0000-4000-8000-000000000003', page, width: 840, height: 1188 });
    const ids = m.addPages([1, 2, 3].map((n) => ({ title: `с. ${n}`, background: { kind: 'blank' as const, pdf: pdf(n) }, backgroundLocked: true })), first);
    expect(m.pages().map((p) => p.title)).toEqual(['Первая', 'с. 1', 'с. 2', 'с. 3', 'Последняя']);
    expect(m.page(ids[2]!)!.background.pdf?.page).toBe(3);
    expect(m.page(ids[0]!)!.backgroundLocked).toBe(true);
    m.undo.undo();
    expect(m.pages().map((p) => p.title)).toEqual(['Первая', 'Последняя']);
    m.destroy();
  });
});
