/**
 * Семантические цвета объектов. Объекты хранят токен ('ink', 'accent-3')
 * или #RRGGBB; токен переводится в цвет текущей темы, поэтому чертёж
 * читается и на белом, и на тёмном, и на «меловом» фоне.
 */
export type CanvasTheme = 'light' | 'dark' | 'chalk';

const TOKENS: Record<string, Record<CanvasTheme, string>> = {
  ink: { light: '#1b2420', dark: '#eef2ef', chalk: '#f4f6f2' },
  muted: { light: '#75817b', dark: '#9aa5a0', chalk: '#c9d6cf' },
  'accent-1': { light: '#d92d2d', dark: '#ff6b6b', chalk: '#ff8a80' },
  'accent-2': { light: '#2563eb', dark: '#6ea2ff', chalk: '#8ab4ff' },
  'accent-3': { light: '#16a34a', dark: '#4ade80', chalk: '#a5f3a1' },
  'accent-4': { light: '#ea580c', dark: '#fb923c', chalk: '#ffb36b' },
  'accent-5': { light: '#7c3aed', dark: '#b18cff', chalk: '#d0b8ff' },
  'accent-6': { light: '#0891b2', dark: '#38c6e8', chalk: '#7fe3f5' },
  'accent-7': { light: '#ca8a04', dark: '#facc15', chalk: '#fff176' },
  'accent-8': { light: '#db2777', dark: '#f472b6', chalk: '#ffa8d4' },
};

export const COLOR_TOKENS = Object.keys(TOKENS);

export const PALETTE: { value: string; label: string }[] = [
  { value: 'ink', label: 'Основной' },
  { value: 'accent-1', label: 'Красный' },
  { value: 'accent-2', label: 'Синий' },
  { value: 'accent-3', label: 'Зелёный' },
  { value: 'accent-4', label: 'Оранжевый' },
  { value: 'accent-5', label: 'Фиолетовый' },
  { value: 'accent-6', label: 'Бирюзовый' },
  { value: 'accent-7', label: 'Жёлтый' },
  { value: 'accent-8', label: 'Розовый' },
  { value: 'muted', label: 'Серый' },
];

export function resolveColor(color: string | null | undefined, theme: CanvasTheme): string {
  if (!color || color === 'none') return 'transparent';
  const t = TOKENS[color];
  if (t) return t[theme];
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : TOKENS.ink![theme];
}

/** Цвета холста (фон страницы и сетка) по теме. */
export const SURFACE_COLORS: Record<CanvasTheme, { paper: string; grid: string; gridStrong: string }> = {
  light: { paper: '#ffffff', grid: '#e3e8e4', gridStrong: '#c8d1cb' },
  dark: { paper: '#171c1a', grid: '#262d2a', gridStrong: '#36403b' },
  chalk: { paper: '#1f3b30', grid: '#2c4d40', gridStrong: '#3d6353' },
};
