import {
  Circle,
  Eraser,
  Hand,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Square,
  Triangle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Иконки инструментов по имени (ToolModule.icon). Явный словарь вместо
 * импорта всего набора lucide-react — так в сборку попадают только нужные
 * иконки. Плагины добавляют свои иконки через registerIcons.
 */
const ICONS: Record<string, LucideIcon> = {
  Circle,
  Eraser,
  Hand,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Square,
  Triangle,
  Zap,
};

export function registerIcons(icons: Record<string, LucideIcon>): void {
  Object.assign(ICONS, icons);
}

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
