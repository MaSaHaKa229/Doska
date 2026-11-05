import { describe, expect, it } from 'vitest';
import { computeCapabilities, noWriteHint, resolveBoardRole, type BoardAccessFacts } from './capabilities.js';
import { DEFAULT_BOARD_SETTINGS } from '../board/settings.js';
import type { BoardKind, BoardMode, UserRole } from '../enums.js';

const TEACHER = 't0000000-0000-4000-8000-000000000001';
const STUDENT = 's0000000-0000-4000-8000-000000000002';

function facts(over: {
  userId?: string;
  role?: UserRole;
  kind?: BoardKind;
  mode?: BoardMode;
  ownerId?: string;
  memberRole?: BoardAccessFacts['memberRole'];
  studentViaClass?: boolean;
  hasChalk?: boolean;
  teachesOwner?: boolean;
  sharedWithTeachers?: boolean;
  assignment?: BoardAccessFacts['assignment'];
  templateVisible?: boolean;
  settings?: Partial<typeof DEFAULT_BOARD_SETTINGS>;
}): BoardAccessFacts {
  return {
    user: { id: over.userId ?? STUDENT, role: over.role ?? 'STUDENT' },
    board: {
      kind: over.kind ?? 'LESSON',
      mode: over.mode ?? 'LECTURE',
      ownerId: over.ownerId ?? TEACHER,
      settings: { ...DEFAULT_BOARD_SETTINGS, ...over.settings },
      sharedWithTeachers: over.sharedWithTeachers ?? false,
    },
    memberRole: over.memberRole ?? null,
    studentViaClass: over.studentViaClass ?? false,
    teachesOwner: over.teachesOwner ?? false,
    hasChalk: over.hasChalk ?? false,
    assignment: over.assignment,
    templateVisible: over.templateVisible,
  };
}

describe('роли на доске', () => {
  it('администратор — только просмотр любой доски', () => {
    const caps = computeCapabilities(facts({ userId: 'admin', role: 'ADMIN' }));
    expect(caps.role).toBe('viewer');
    expect(caps.view).toBe(true);
    expect(caps.write).toBe(false);
    expect(caps.manageLesson).toBe(false);
  });

  it('владелец-учитель имеет все права во всех режимах', () => {
    for (const mode of ['LECTURE', 'COLLABORATIVE', 'SELECTIVE'] as const) {
      const caps = computeCapabilities(facts({ userId: TEACHER, role: 'TEACHER', mode }));
      expect(caps).toMatchObject({ role: 'owner', write: true, moderate: true, manageLesson: true, leadFollow: true });
    }
  });

  it('посторонний ученик доступа не имеет', () => {
    expect(computeCapabilities(facts({})).view).toBe(false);
  });

  it('соведущий учитель', () => {
    const caps = computeCapabilities(facts({ userId: 'x', role: 'TEACHER', memberRole: 'CO_TEACHER' }));
    expect(caps.role).toBe('teacher');
    expect(caps.manageLesson).toBe(true);
  });

  it('ученик с ролью CO_TEACHER не становится учителем', () => {
    expect(resolveBoardRole(facts({ memberRole: 'CO_TEACHER' }))).toBe('none');
  });
});

describe('режимы доски урока для ученика', () => {
  const student = { studentViaClass: true } as const;

  it('Лекция — только просмотр с подсказкой', () => {
    const caps = computeCapabilities(facts({ ...student, mode: 'LECTURE' }));
    expect(caps.view).toBe(true);
    expect(caps.write).toBe(false);
    expect(caps.noWriteReason).toBe('lecture-mode');
    expect(noWriteHint(caps.noWriteReason)).toContain('Лекция');
    expect(caps.raiseHand).toBe(true);
    expect(caps.laser).toBe(false);
  });

  it('Совместная работа — пишут все', () => {
    const caps = computeCapabilities(facts({ ...student, mode: 'COLLABORATIVE' }));
    expect(caps.write).toBe(true);
    expect(caps.moderate).toBe(false);
    expect(caps.editOthers).toBe(false);
    expect(caps.laser).toBe(true);
  });

  it('Выборочно — только с мелом', () => {
    expect(computeCapabilities(facts({ ...student, mode: 'SELECTIVE' })).noWriteReason).toBe('no-chalk');
    expect(computeCapabilities(facts({ ...student, mode: 'SELECTIVE', hasChalk: true })).write).toBe(true);
  });

  it('настройки доски расширяют права ученика с правом записи', () => {
    const caps = computeCapabilities(
      facts({
        ...student,
        mode: 'COLLABORATIVE',
        settings: { allowStudentsEditOthers: true, allowStudentPages: true, allowStudentLaser: false },
      }),
    );
    expect(caps.editOthers).toBe(true);
    expect(caps.managePages).toBe(true);
    expect(caps.laser).toBe(false);
  });

  it('прямое членство STUDENT равноценно доступу через класс', () => {
    expect(computeCapabilities(facts({ memberRole: 'STUDENT', mode: 'COLLABORATIVE' })).write).toBe(true);
  });
});

describe('конспекты, задания, шаблоны', () => {
  it('конспект: владелец-ученик пишет, учитель видит только если открыт', () => {
    const own = computeCapabilities(facts({ kind: 'NOTEBOOK', ownerId: STUDENT }));
    expect(own).toMatchObject({ role: 'owner', write: true, leadFollow: false, manageLesson: false });

    const teacherClosed = computeCapabilities(
      facts({ kind: 'NOTEBOOK', ownerId: STUDENT, userId: TEACHER, role: 'TEACHER', teachesOwner: true }),
    );
    expect(teacherClosed.view).toBe(false);

    const teacherOpen = computeCapabilities(
      facts({
        kind: 'NOTEBOOK',
        ownerId: STUDENT,
        userId: TEACHER,
        role: 'TEACHER',
        teachesOwner: true,
        sharedWithTeachers: true,
      }),
    );
    expect(teacherOpen).toMatchObject({ role: 'viewer', view: true, write: false });

    const otherStudent = computeCapabilities(facts({ kind: 'NOTEBOOK', ownerId: 'someone-else' }));
    expect(otherStudent.view).toBe(false);
  });

  it('работа по заданию: ученик пишет, пока задание открыто', () => {
    const open = computeCapabilities(
      facts({ kind: 'ASSIGNMENT_WORK', assignment: { studentId: STUDENT, closed: false } }),
    );
    expect(open).toMatchObject({ role: 'student', write: true, editOthers: true, moderate: false });

    const closed = computeCapabilities(
      facts({ kind: 'ASSIGNMENT_WORK', assignment: { studentId: STUDENT, closed: true } }),
    );
    expect(closed).toMatchObject({ write: false, noWriteReason: 'assignment-closed' });

    const submitted = computeCapabilities(
      facts({ kind: 'ASSIGNMENT_WORK', assignment: { studentId: STUDENT, closed: false, submitted: true } }),
    );
    expect(submitted).toMatchObject({ write: false, managePages: false, noWriteReason: 'assignment-submitted', raiseHand: true });
    expect(noWriteHint('assignment-submitted')).toMatch(/сдана на проверку/);

    const stranger = computeCapabilities(
      facts({ kind: 'ASSIGNMENT_WORK', userId: 'other', assignment: { studentId: STUDENT, closed: false } }),
    );
    expect(stranger.view).toBe(false);

    const teacher = computeCapabilities(
      facts({ kind: 'ASSIGNMENT_WORK', userId: TEACHER, role: 'TEACHER', assignment: { studentId: STUDENT, closed: true } }),
    );
    expect(teacher).toMatchObject({ role: 'owner', write: true, moderate: true });
  });

  it('шаблон: другие учителя только смотрят, если шаблон им виден', () => {
    expect(computeCapabilities(facts({ kind: 'TEMPLATE', userId: 'x', role: 'TEACHER', templateVisible: true })).role).toBe(
      'viewer',
    );
    expect(computeCapabilities(facts({ kind: 'TEMPLATE', userId: 'x', role: 'TEACHER' })).role).toBe('none');
  });
});
