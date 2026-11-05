import type { PrismaClient, UserRole } from '@prisma/client';
import {
  MAX_IMPORT_ROWS,
  detectImportColumns,
  fullNameSchema,
  loginFieldSchema,
  parseCsvRows,
  parseRoleCell,
  type ImportRowError,
  type ImportRowPreview,
  type ImportUsersRequest,
  type ImportUsersResponse,
} from '@doska/shared';
import { AppError, Errors } from '../common/errors.js';
import type { AuditService } from '../common/audit.js';
import { auditBase, type Actor } from '../common/actor.js';
import { randomUserColor, type UsersService } from './users.service.js';

interface ParsedRow {
  line: number;
  fullName: string;
  login: string | null;
  role: UserRole;
  className: string | null;
}

/**
 * Импорт пользователей из CSV.
 *
 * Работает в два шага: клиент сначала вызывает импорт с dryRun = true и
 * показывает предпросмотр (сгенерированные логины, новые классы, ошибки
 * по строкам), затем — без dryRun. Реальный импорт атомарен: при любой
 * ошибке в файле не создаётся ни один пользователь.
 */
export class UsersImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async import(input: ImportUsersRequest, actor: Actor): Promise<ImportUsersResponse> {
    const table = parseCsvRows(input.csv);
    if (table.length === 0) throw Errors.validation({ csv: ['Файл пуст'] });
    const { header, columns } = detectImportColumns(table[0]!.cells);
    const dataRows = header ? table.slice(1) : table;
    if (dataRows.length === 0) throw Errors.validation({ csv: ['В файле нет строк с пользователями'] });
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw Errors.validation({ csv: [`Слишком много строк: ${dataRows.length} (максимум ${MAX_IMPORT_ROWS})`] });
    }

    const errors = new Map<number, string[]>();
    const addError = (line: number, msg: string) => {
      const list = errors.get(line) ?? [];
      list.push(msg);
      errors.set(line, list);
    };

    // 1. Разбор строк.
    const rows: ParsedRow[] = [];
    dataRows.forEach(({ line, cells }) => {
      const cell = (col: string) => {
        const idx = columns.indexOf(col as never);
        return idx >= 0 ? (cells[idx] ?? '').trim() : '';
      };
      const fn = fullNameSchema.safeParse(cell('fullName'));
      if (!fn.success) addError(line, fn.error.issues[0]?.message ?? 'Неверное ФИО');

      let login: string | null = null;
      const rawLogin = cell('login');
      if (rawLogin) {
        const lp = loginFieldSchema.safeParse(rawLogin);
        if (lp.success) login = lp.data;
        else addError(line, `Логин «${rawLogin}»: ${lp.error.issues[0]?.message ?? 'неверный'}`);
      }

      let role: UserRole = input.defaultRole;
      const parsedRole = parseRoleCell(cell('role'));
      if (parsedRole === null) addError(line, `Неизвестная роль «${cell('role')}» (ученик или учитель)`);
      else if (parsedRole === 'ADMIN') addError(line, 'Администраторов нельзя создавать импортом');
      else if (parsedRole) role = parsedRole;

      const className = cell('className') || null;
      if (className && className.length > 100) addError(line, 'Слишком длинное название класса');

      rows.push({ line, fullName: fn.success ? fn.data : cell('fullName'), login, role, className });
    });

    // 2. Явные логины: дубли внутри файла и занятые в системе.
    const byLogin = new Map<string, number[]>();
    for (const r of rows) if (r.login) byLogin.set(r.login, [...(byLogin.get(r.login) ?? []), r.line]);
    for (const [login, lines] of byLogin) {
      if (lines.length > 1) for (const l of lines) addError(l, `Логин «${login}» повторяется в строках ${lines.join(', ')}`);
    }
    if (byLogin.size) {
      const taken = await this.prisma.user.findMany({ where: { login: { in: [...byLogin.keys()] } }, select: { login: true } });
      for (const t of taken) for (const l of byLogin.get(t.login) ?? []) addError(l, `Логин «${t.login}» уже занят`);
    }

    // 3. Классы.
    let fixedClass: { id: string; name: string } | null = null;
    if (input.classId) {
      const c = await this.prisma.class.findUnique({ where: { id: input.classId } });
      if (!c) throw Errors.validation({ classId: ['Класс не найден'] });
      if (c.archivedAt) throw Errors.validation({ classId: [`Класс «${c.name}» в архиве`] });
      fixedClass = { id: c.id, name: c.name };
    }
    const classNames = [...new Set(rows.map((r) => r.className).filter((n): n is string => !!n))];
    const classByName = new Map<string, { id: string } | 'new'>();
    if (classNames.length) {
      const existing = await this.prisma.class.findMany({
        where: {
          archivedAt: null,
          OR: classNames.map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })),
          ...(input.academicYear ? { academicYear: input.academicYear } : {}),
        },
        select: { id: true, name: true },
      });
      for (const name of classNames) {
        const matches = existing.filter((c) => c.name.toLowerCase() === name.toLowerCase());
        if (matches.length === 1) classByName.set(name, { id: matches[0]!.id });
        else if (matches.length > 1) {
          for (const r of rows.filter((x) => x.className === name)) {
            addError(r.line, `Несколько классов «${name}» — укажите учебный год`);
          }
        } else if (input.createMissingClasses) classByName.set(name, 'new');
        else {
          for (const r of rows.filter((x) => x.className === name)) {
            addError(r.line, `Класс «${name}» не найден (включите «создавать отсутствующие классы»)`);
          }
        }
      }
    }

    // 4. Логины для строк без логина.
    const explicit = rows.filter((r) => r.login).map((r) => r.login!);
    const needLogin = rows.filter((r) => !r.login);
    const generated = await this.users.generateLogins(needLogin.map((r) => r.fullName), explicit);
    const loginOf = new Map<number, string>();
    needLogin.forEach((r, i) => loginOf.set(r.line, generated[i]!));

    const preview: ImportRowPreview[] = rows.map((r) => ({
      line: r.line,
      fullName: r.fullName,
      login: r.login ?? loginOf.get(r.line)!,
      loginGenerated: !r.login,
      role: r.role,
      className: r.className ?? fixedClass?.name ?? null,
      newClass: !!r.className && classByName.get(r.className) === 'new',
    }));
    const errorList: ImportRowError[] = [...errors.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, messages]) => ({ line, messages }));
    const newClassNames = [...classByName.entries()].filter(([, v]) => v === 'new').map(([k]) => k);

    if (input.dryRun) {
      return { dryRun: true, rows: preview, errors: errorList, credentials: [], createdClasses: newClassNames };
    }
    if (errorList.length) {
      throw new AppError(400, 'VALIDATION_ERROR', `Ошибки в файле: ${errorList.length} строк(и). Ничего не создано`, {
        errors: errorList,
      });
    }

    // 5. Создание (хеши паролей — до транзакции).
    const prepared = await this.users.prepareCredentials(preview);
    const createdClasses = await this.prisma.$transaction(
      async (tx) => {
        const classIdByName = new Map<string, string>();
        for (const name of newClassNames) {
          const c = await tx.class.create({ data: { name, academicYear: input.academicYear ?? null } });
          classIdByName.set(name, c.id);
          await this.audit.record(
            { action: 'CLASS_CREATED', ...auditBase(actor), targetType: 'class', targetId: c.id, details: { name, source: 'import' } },
            tx,
          );
        }
        for (const [name, v] of classByName) if (v !== 'new') classIdByName.set(name, v.id);

        await tx.user.createMany({
          data: prepared.map((p) => ({
            id: p.id,
            login: p.login,
            fullName: p.fullName,
            role: p.role,
            passwordHash: p.hash,
            mustChangePassword: true,
            color: randomUserColor(),
            createdById: actor.id,
          })),
        });
        const memberships: { classId: string; userId: string; role: 'STUDENT' | 'TEACHER' }[] = [];
        prepared.forEach((p, i) => {
          const role = p.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';
          const own = rows[i]!.className;
          const ids = new Set<string>();
          if (own) ids.add(classIdByName.get(own)!);
          if (fixedClass) ids.add(fixedClass.id);
          for (const classId of ids) memberships.push({ classId, userId: p.id, role });
        });
        if (memberships.length) await tx.classMember.createMany({ data: memberships });

        await this.audit.record(
          {
            action: 'USER_IMPORTED',
            ...auditBase(actor),
            targetType: 'user',
            details: {
              count: prepared.length,
              logins: prepared.map((p) => p.login).slice(0, 1000),
              createdClasses: newClassNames,
            },
          },
          tx,
        );
        return newClassNames;
      },
      { timeout: 60_000 },
    );

    return {
      dryRun: false,
      rows: preview,
      errors: [],
      credentials: prepared.map((p) => ({ fullName: p.fullName, login: p.login, tempPassword: p.tempPassword, className: p.className })),
      createdClasses,
    };
  }
}
