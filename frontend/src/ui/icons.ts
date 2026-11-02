import {
  Calculator,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  ListOrdered,
  ImagePlus,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Sigma,
  Square,
  Triangle,
  Type,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Иконки инструментов по имени (ToolModule.icon). Явный словарь вместо
 * импорта всего набора lucide-react — так в сборку попадают только нужные
 * иконки. Плагины добавляют свои иконки через registerIcons.
 */
const ICONS: Record<string, LucideIcon> = {
  Calculator,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  ListOrdered,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Sigma,
  Square,
  Triangle,
  Type,
  Zap,
};

export function registerIcons(icons: Record<string, LucideIcon>): void {
  Object.assign(ICONS, icons);
}

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
