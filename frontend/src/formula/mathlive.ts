import type { MathfieldElement } from 'mathlive';

type MathLiveModule = typeof import('mathlive');
let loading: Promise<MathLiveModule> | null = null;

/**
 * Редактор формул MathLive загружается отдельным чанком при первом
 * открытии. Шрифты — из /mathlive-fonts (плагин в vite.config.ts), звуки
 * клавиатуры выключены.
 */
export function loadMathLive(): Promise<MathLiveModule> {
  loading ??= import('mathlive').then((m) => {
    m.MathfieldElement.fontsDirectory = '/mathlive-fonts';
    m.MathfieldElement.soundsDirectory = null;
    return m;
  });
  return loading;
}

/** Дополнительные сочетания быстрого ввода (вдобавок к встроенным sqrt, alpha, int, sum…). */
export const EXTRA_SHORTCUTS: Record<string, string> = {
  '->': '\\to',
  '=>': '\\Rightarrow',
  '<=>': '\\Leftrightarrow',
  '!=': '\\ne',
  '+-': '\\pm',
  '~~': '\\approx',
  tg: '\\tan',
  ctg: '\\cot',
  arctg: '\\arctan',
  lg: '\\lg',
  deg: '^{\\circ}',
  vec: '\\vec{#?}',
  RR: '\\mathbb{R}',
  NN: '\\mathbb{N}',
  ZZ: '\\mathbb{Z}',
  QQ: '\\mathbb{Q}',
};

/**
 * Новое поле формулы. MathLive не позволяет настраивать поле до вставки в
 * документ: начальная формула и флаги задаются атрибутами, остальное —
 * после события mount (configure ниже вызывает onMounted).
 */
export async function createMathfield(latex: string, onMounted: (mf: MathfieldElement) => void): Promise<MathfieldElement> {
  const m = await loadMathLive();
  const mf = new m.MathfieldElement();
  mf.setAttribute('smart-fence', 'on');
  mf.setAttribute('math-virtual-keyboard-policy', 'manual');
  mf.textContent = latex;
  mf.addEventListener(
    'mount',
    () => {
      mf.inlineShortcuts = { ...mf.inlineShortcuts, ...EXTRA_SHORTCUTS };
      onMounted(mf);
    },
    { once: true },
  );
  return mf;
}
