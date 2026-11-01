import { noWriteHint, type BoardCapabilities, type ToolModule } from '@doska/shared';

const CAPABILITY_HINTS: Record<NonNullable<ToolModule['requiresCapability']>, string> = {
  laser: 'Лазерная указка сейчас недоступна: учитель выключил её для учеников или у вас нет права писать на доске.',
  moderate: 'Инструмент доступен только учителю доски.',
  leadFollow: 'Инструмент доступен только учителю доски.',
};

/**
 * Почему инструмент сейчас недоступен (текст подсказки) или null.
 * Используется панелью инструментов, горячими клавишами, палитрой Ctrl+K
 * и холстом — правило одно.
 */
export function toolUnavailable(tool: Pick<ToolModule, 'requiresWrite' | 'requiresCapability'>, caps: BoardCapabilities | null): string | null {
  if (tool.requiresWrite && !caps?.write) return noWriteHint(caps?.noWriteReason ?? 'read-only') ?? 'Нет права записи';
  if (tool.requiresCapability && !caps?.[tool.requiresCapability]) return CAPABILITY_HINTS[tool.requiresCapability];
  return null;
}
