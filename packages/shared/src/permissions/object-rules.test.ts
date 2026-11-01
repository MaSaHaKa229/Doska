import { describe, expect, it } from 'vitest';
import { computeCapabilities, type BoardAccessFacts } from './capabilities.js';
import {
  canCreateObject,
  canCreatePage,
  canDeleteObject,
  canEditPage,
  canUpdateObjectField,
  type ObjectGuardInfo,
} from './object-rules.js';
import { DEFAULT_BOARD_SETTINGS } from '../board/settings.js';
import type { BoardMode } from '../enums.js';

const T = 't0000000-0000-4000-8000-000000000001';
const S1 = 's0000000-0000-4000-8000-000000000001';
const S2 = 's0000000-0000-4000-8000-000000000002';

function caps(userId: string, mode: BoardMode = 'COLLABORATIVE', editOthers = false) {
  const f: BoardAccessFacts = {
    user: { id: userId, role: userId === T ? 'TEACHER' : 'STUDENT' },
    board: {
      kind: 'LESSON',
      mode,
      ownerId: T,
      settings: { ...DEFAULT_BOARD_SETTINGS, allowStudentsEditOthers: editOthers },
      sharedWithTeachers: false,
    },
    memberRole: null,
    studentViaClass: userId !== T,
    teachesOwner: false,
    hasChalk: false,
  };
  return computeCapabilities(f);
}

const page = { backgroundLocked: true };
const obj = (over: Partial<ObjectGuardInfo> = {}): ObjectGuardInfo => ({
  createdBy: S1,
  locked: false,
  layer: 'content',
  pageId: 'p1',
  authorIsModerator: false,
  ...over,
});

describe('создание объектов', () => {
  it('ученик создаёт свой объект в режиме совместной работы', () => {
    expect(canCreateObject(caps(S1), S1, obj(), page)).toEqual({ ok: true });
  });
  it('в режиме лекции — нет', () => {
    expect(canCreateObject(caps(S1, 'LECTURE'), S1, obj(), page)).toEqual({ ok: false, reason: 'NO_WRITE' });
  });
  it('нельзя подписаться чужим именем', () => {
    expect(canCreateObject(caps(S1), S1, obj({ createdBy: S2 }), page)).toEqual({ ok: false, reason: 'AUTHOR_MISMATCH' });
  });
  it('ученик не создаёт заблокированные, фоновые и review-объекты', () => {
    expect(canCreateObject(caps(S1), S1, obj({ locked: true }), page).ok).toBe(false);
    expect(canCreateObject(caps(S1), S1, obj({ layer: 'background' }), page).ok).toBe(false);
    expect(canCreateObject(caps(S1), S1, obj({ layer: 'review' }), page).ok).toBe(false);
  });
  it('учитель может всё', () => {
    expect(canCreateObject(caps(T), T, obj({ createdBy: T, locked: true, layer: 'background' }), page).ok).toBe(true);
  });
  it('страница должна существовать', () => {
    expect(canCreateObject(caps(S1), S1, obj(), undefined)).toEqual({ ok: false, reason: 'PAGE_NOT_FOUND' });
  });
});

describe('изменение и удаление', () => {
  it('свои объекты — можно, чужие — нет (по умолчанию)', () => {
    expect(canUpdateObjectField(caps(S1), S1, obj(), 'x', page).ok).toBe(true);
    expect(canUpdateObjectField(caps(S2), S2, obj(), 'x', page)).toEqual({ ok: false, reason: 'NOT_OWNER' });
    expect(canDeleteObject(caps(S2), S2, obj(), page)).toEqual({ ok: false, reason: 'NOT_OWNER' });
  });
  it('настройка allowStudentsEditOthers разрешает чужие объекты', () => {
    expect(canDeleteObject(caps(S2, 'COLLABORATIVE', true), S2, obj(), page).ok).toBe(true);
  });
  it('учительские объекты ученик не трогает, даже если разрешены чужие', () => {
    const teacherObj = obj({ createdBy: T, authorIsModerator: true });
    expect(canDeleteObject(caps(S2, 'COLLABORATIVE', true), S2, teacherObj, page)).toEqual({
      ok: false,
      reason: 'TEACHER_ONLY',
    });
    expect(canDeleteObject(caps(S2, 'COLLABORATIVE', true), S2, { ...teacherObj, locked: true }, page)).toEqual({
      ok: false,
      reason: 'LOCKED',
    });
  });
  it('заблокированный объект нельзя менять даже автору', () => {
    expect(canUpdateObjectField(caps(S1), S1, obj({ locked: true }), 'x', page)).toEqual({ ok: false, reason: 'LOCKED' });
    expect(canDeleteObject(caps(S1), S1, obj({ locked: true }), page).ok).toBe(false);
  });
  it('учитель меняет заблокированные объекты и снимает блокировку', () => {
    expect(canUpdateObjectField(caps(T), T, obj({ locked: true }), 'locked', page).ok).toBe(true);
  });
  it('блокировку и слой меняет только учитель', () => {
    expect(canUpdateObjectField(caps(S1), S1, obj(), 'locked', page)).toEqual({ ok: false, reason: 'TEACHER_ONLY' });
    expect(canUpdateObjectField(caps(S1), S1, obj(), 'layer', page)).toEqual({ ok: false, reason: 'TEACHER_ONLY' });
  });
  it('неизменяемые и неизвестные поля', () => {
    expect(canUpdateObjectField(caps(T), T, obj(), 'createdBy', page)).toEqual({ ok: false, reason: 'IMMUTABLE_FIELD' });
    expect(canUpdateObjectField(caps(T), T, obj(), 'type', page)).toEqual({ ok: false, reason: 'IMMUTABLE_FIELD' });
    expect(canUpdateObjectField(caps(T), T, obj(), '__proto__', page)).toEqual({ ok: false, reason: 'UNKNOWN_FIELD' });
  });
  it('пометки учителя (review) ученик не меняет', () => {
    expect(canDeleteObject(caps(S1), S1, obj({ layer: 'review' }), page)).toEqual({ ok: false, reason: 'REVIEW_LAYER' });
  });
  it('фон страницы защищён, если заблокирован', () => {
    expect(canDeleteObject(caps(S1, 'COLLABORATIVE', true), S1, obj({ layer: 'background' }), page)).toEqual({
      ok: false,
      reason: 'BACKGROUND_LOCKED',
    });
  });
});

describe('страницы', () => {
  it('ученик без права managePages не управляет страницами', () => {
    expect(canEditPage(caps(S1), 'title')).toEqual({ ok: false, reason: 'NO_PAGE_RIGHTS' });
    expect(canCreatePage(caps(S1), S1, { createdBy: S1, backgroundLocked: false }).ok).toBe(false);
  });
  it('учитель управляет страницами и фоном', () => {
    expect(canEditPage(caps(T), 'background').ok).toBe(true);
    expect(canEditPage(caps(T), 'createdAt').ok).toBe(false);
    expect(canCreatePage(caps(T), T, { createdBy: T, backgroundLocked: true }).ok).toBe(true);
  });
});
