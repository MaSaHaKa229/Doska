import { z } from 'zod';

/**
 * Настройки доски (Board.settings в БД). Меняет владелец/соведущий через REST
 * или управляющее сообщение; сервер рассылает всем участникам board.settings.
 */
export const boardSettingsSchema = z
  .object({
    /** Ученики могут менять и стирать чужие (не учительские) объекты. */
    allowStudentsEditOthers: z.boolean().default(false),
    /** Ученики с правом записи могут пользоваться лазерной указкой. */
    allowStudentLaser: z.boolean().default(true),
    /** Ученики с правом записи могут добавлять/переименовывать страницы. */
    allowStudentPages: z.boolean().default(false),
    /** Показывать автора объекта при наведении всем (иначе только учителю). */
    showAuthorsToStudents: z.boolean().default(true),
    /** Показывать курсоры учеников друг другу (учитель видит всегда). */
    showStudentCursors: z.boolean().default(true),
  })
  .strict();

export type BoardSettings = z.infer<typeof boardSettingsSchema>;

export const DEFAULT_BOARD_SETTINGS: BoardSettings = boardSettingsSchema.parse({});

/** Безопасное чтение настроек из JSON БД (неизвестные/битые поля → по умолчанию). */
export function parseBoardSettings(raw: unknown): BoardSettings {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_BOARD_SETTINGS)) {
    if (typeof base[key] === 'boolean') result[key] = base[key];
  }
  return boardSettingsSchema.parse(result);
}
