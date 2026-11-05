import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_WORK_STATUSES,
  BOARD_KINDS,
  BOARD_MEMBER_ROLES,
  BOARD_MODES,
  EDUCATION_LEVELS,
  USER_ROLES,
} from './enums.js';
import { AUDIT_ACTIONS } from './api/admin.js';

const schemaPath = fileURLToPath(new URL('../../../backend/prisma/schema.prisma', import.meta.url));
const schema = readFileSync(schemaPath, 'utf8');

function prismaEnum(name: string): string[] {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (!m) throw new Error(`enum ${name} не найден в schema.prisma`);
  return (m[1] as string)
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

describe('enum-ы совпадают с Prisma', () => {
  it.each([
    ['UserRole', USER_ROLES],
    ['BoardKind', BOARD_KINDS],
    ['BoardMode', BOARD_MODES],
    ['BoardMemberRole', BOARD_MEMBER_ROLES],
    ['AssignmentWorkStatus', ASSIGNMENT_WORK_STATUSES],
    ['EducationLevel', EDUCATION_LEVELS],
    ['AuditAction', AUDIT_ACTIONS],
  ])('%s', (name, values) => {
    expect(prismaEnum(name)).toEqual([...values]);
  });
});
