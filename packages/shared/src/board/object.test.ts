import { describe, expect, it } from 'vitest';
import { boardObjectSchema, createObjectBase, objectFieldSchemas } from './object.js';
import { isJsonValue } from './json.js';
import { parseBoardSettings, DEFAULT_BOARD_SETTINGS } from './settings.js';
import { pageSchema, DEFAULT_BACKGROUND } from './doc-layout.js';

const USER = '11111111-1111-4111-8111-111111111111';

describe('модель объекта', () => {
  it('createObjectBase + props проходит схему', () => {
    const obj = {
      ...createObjectBase({ id: 'abcdefgh12', type: 'core.stroke', pageId: 'page000001', z: 'a0', userId: USER, now: 1 }),
      props: { points: [0, 0, 0.5, 10, 10, 0.5], color: 'ink', width: 2 },
    };
    expect(boardObjectSchema.safeParse(obj).success).toBe(true);
  });

  it('лишние поля и неверные значения отклоняются', () => {
    const base = createObjectBase({ id: 'abcdefgh12', type: 'core.stroke', pageId: 'page000001', z: 'a0', userId: USER, now: 1 });
    expect(boardObjectSchema.safeParse({ ...base, props: {}, evil: 1 }).success).toBe(false);
    expect(objectFieldSchemas.type.safeParse('Core.Stroke').success).toBe(false);
    expect(objectFieldSchemas.type.safeParse('stroke').success).toBe(false);
    expect(objectFieldSchemas.x.safeParse(Number.NaN).success).toBe(false);
    expect(objectFieldSchemas.x.safeParse(1e12).success).toBe(false);
    expect(objectFieldSchemas.scaleX.safeParse(0).success).toBe(false);
    expect(objectFieldSchemas.z.safeParse('a10').success).toBe(false);
  });

  it('isJsonValue отсекает не-JSON', () => {
    expect(isJsonValue({ a: [1, 'x', null, { b: true }] })).toBe(true);
    expect(isJsonValue({ a: Infinity })).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(new Uint8Array(2))).toBe(false);
    let deep: unknown = 1;
    for (let i = 0; i < 30; i++) deep = [deep];
    expect(isJsonValue(deep)).toBe(false);
  });

  it('настройки доски: битый JSON → значения по умолчанию', () => {
    expect(parseBoardSettings(null)).toEqual(DEFAULT_BOARD_SETTINGS);
    expect(parseBoardSettings({ allowStudentLaser: false, junk: 1, allowStudentPages: 'yes' })).toEqual({
      ...DEFAULT_BOARD_SETTINGS,
      allowStudentLaser: false,
    });
  });

  it('схема страницы', () => {
    const page = {
      id: 'page000001',
      title: 'Страница 1',
      order: 'a0',
      background: DEFAULT_BACKGROUND,
      backgroundLocked: false,
      createdBy: USER,
      createdAt: 0,
    };
    expect(pageSchema.safeParse(page).success).toBe(true);
    expect(pageSchema.safeParse({ ...page, background: { ...DEFAULT_BACKGROUND, kind: 'hex' } }).success).toBe(false);
  });
});
