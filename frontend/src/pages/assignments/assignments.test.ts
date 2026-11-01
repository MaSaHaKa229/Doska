import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { fromLocalInput, toLocalInput } from './CreateAssignmentDialog';
import { countsLine } from './common';

const T = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

function workCaps(userId: string, submitted = false) {
  return computeCapabilities({
    user: { id: userId, role: userId === T ? 'TEACHER' : 'STUDENT' },
    board: { kind: 'ASSIGNMENT_WORK', mode: 'COLLABORATIVE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
    memberRole: null,
    studentViaClass: false,
    teachesOwner: false,
    hasChalk: false,
    assignment: { studentId: S, closed: false, submitted },
  });
}

const rect = { kind: 'rect' as const, w: 100, h: 50, stroke: 'ink', fill: 'none', strokeWidth: 2, dash: 'solid' as const };

describe('работа по заданию на клиенте', () => {
  afterEach(() => useBoard.getState().reset());

  it('учитель пишет пометки в слой review, ученик — в content и не трогает пометки', () => {
    const doc = new Y.Doc();
    const teacher = new BoardModel(doc, { userId: T, registry, getCaps: () => workCaps(T), ownerId: T, defaultLayer: () => 'review' });
    const pageId = teacher.addPage('Страница 1')!;
    const mark = teacher.createObject('core.shape', { pageId, x: 0, y: 0, props: rect })!;
    expect(teacher.getObject(mark)!.layer).toBe('review');

    const student = new BoardModel(doc, { userId: S, registry, getCaps: () => workCaps(S), ownerId: T, defaultLayer: () => 'content' });
    const own = student.createObject('core.shape', { pageId, x: 0, y: 0, props: rect })!;
    expect(student.getObject(own)!.layer).toBe('content');
    expect(student.canModify(mark)).toBe(false);
    expect(student.canDelete(mark)).toBe(false);
    // После сдачи ученик ничего не меняет.
    const submitted = new BoardModel(doc, { userId: S, registry, getCaps: () => workCaps(S, true), ownerId: T });
    expect(submitted.canModify(own)).toBe(false);
    expect(submitted.createObject('core.shape', { pageId, x: 0, y: 0, props: rect })).toBeNull();
    [teacher, student, submitted].forEach((m) => m.destroy());
  });

  it('цвет пометок задаётся только для этой доски и не сохраняется в настройках', () => {
    localStorage.removeItem('doska.toolOptions');
    useBoard.getState().reset();
    const before = useBoard.getState().toolOptions.stroke;
    useBoard.getState().setToolOptions({ stroke: 'accent-1' }, false);
    expect(useBoard.getState().toolOptions.stroke).toBe('accent-1');
    useBoard.getState().reset();
    expect(useBoard.getState().toolOptions.stroke).toBe(before);
  });

  it('срок сдачи: поле datetime-local ⇄ ISO', () => {
    const iso = new Date(2030, 4, 1, 9, 30).toISOString();
    expect(toLocalInput(iso)).toBe('2030-05-01T09:30');
    expect(fromLocalInput('2030-05-01T09:30')).toBe(iso);
    expect(fromLocalInput('')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('строка счётчиков задания', () => {
    expect(countsLine(25, { NOT_STARTED: 10, IN_PROGRESS: 8, SUBMITTED: 4, REVIEWED: 3 })).toBe('Сдано 7 из 25 · проверено 3 · в работе 8');
  });
});
