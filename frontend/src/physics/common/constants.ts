/**
 * Физические постоянные (этап 7.1b): обозначение для формул (имя в расчёте
 * ответа «Дано / Решение»), LaTeX для доски, значение в СИ и единица.
 * Значения — как в школьных задачниках (g = 9,8 м/с²).
 */

export interface PhysConst {
  key: string;
  /** Имя в формуле ответа: g, G, k, e, m_e, c, h, N_A, R, k_B, eps0, mu0, m_p. */
  sym: string;
  title: string;
  latex: string;
  value: number;
  /** Единица по-русски (переводится в math.js через formula/units). */
  unit: string;
  keywords: string[];
}

const sci = (m: string, e: number) => `${m}\\cdot 10^{${e}}`;

export const CONSTANTS: PhysConst[] = [
  { key: 'g', sym: 'g', title: 'Ускорение свободного падения', latex: 'g = 9{,}8\\ \\text{м/с}^2', value: 9.8, unit: 'м/с²', keywords: ['g', 'ускорение свободного падения', 'сила тяжести'] },
  { key: 'G', sym: 'G', title: 'Гравитационная постоянная', latex: `G = ${sci('6{,}67', -11)}\\ \\text{Н·м}^2\\text{/кг}^2`, value: 6.67e-11, unit: 'Н·м²/кг²', keywords: ['гравитационная постоянная', 'всемирное тяготение'] },
  { key: 'k', sym: 'k', title: 'Коэффициент в законе Кулона', latex: `k = ${sci('9', 9)}\\ \\text{Н·м}^2\\text{/Кл}^2`, value: 9e9, unit: 'Н·м²/Кл²', keywords: ['закон кулона', 'электростатическая постоянная', 'k'] },
  { key: 'e', sym: 'e', title: 'Элементарный заряд', latex: `e = ${sci('1{,}6', -19)}\\ \\text{Кл}`, value: 1.6e-19, unit: 'Кл', keywords: ['элементарный заряд', 'заряд электрона'] },
  { key: 'me', sym: 'm_e', title: 'Масса электрона', latex: `m_e = ${sci('9{,}1', -31)}\\ \\text{кг}`, value: 9.1e-31, unit: 'кг', keywords: ['масса электрона'] },
  { key: 'mp', sym: 'm_p', title: 'Масса протона', latex: `m_p = ${sci('1{,}67', -27)}\\ \\text{кг}`, value: 1.67e-27, unit: 'кг', keywords: ['масса протона'] },
  { key: 'c', sym: 'c', title: 'Скорость света в вакууме', latex: `c = ${sci('3', 8)}\\ \\text{м/с}`, value: 3e8, unit: 'м/с', keywords: ['скорость света'] },
  { key: 'h', sym: 'h', title: 'Постоянная Планка', latex: `h = ${sci('6{,}63', -34)}\\ \\text{Дж·с}`, value: 6.63e-34, unit: 'Дж·с', keywords: ['постоянная планка', 'квант'] },
  { key: 'NA', sym: 'N_A', title: 'Постоянная Авогадро', latex: `N_A = ${sci('6{,}02', 23)}\\ \\text{моль}^{-1}`, value: 6.02e23, unit: 'моль⁻¹', keywords: ['число авогадро', 'постоянная авогадро'] },
  { key: 'R', sym: 'R', title: 'Универсальная газовая постоянная', latex: 'R = 8{,}31\\ \\text{Дж/(моль·К)}', value: 8.31, unit: 'Дж/(моль·К)', keywords: ['газовая постоянная', 'менделеев клапейрон'] },
  { key: 'kB', sym: 'k_B', title: 'Постоянная Больцмана', latex: `k_B = ${sci('1{,}38', -23)}\\ \\text{Дж/К}`, value: 1.38e-23, unit: 'Дж/К', keywords: ['постоянная больцмана'] },
  { key: 'eps0', sym: 'eps0', title: 'Электрическая постоянная', latex: `\\varepsilon_0 = ${sci('8{,}85', -12)}\\ \\text{Ф/м}`, value: 8.85e-12, unit: 'Ф/м', keywords: ['электрическая постоянная', 'эпсилон ноль'] },
  { key: 'mu0', sym: 'mu0', title: 'Магнитная постоянная', latex: `\\mu_0 = 4\\pi\\cdot 10^{-7}\\ \\text{Гн/м}`, value: 4 * Math.PI * 1e-7, unit: 'Гн/м', keywords: ['магнитная постоянная', 'мю ноль'] },
];

/** Постоянная по имени в формуле; ε0 и μ0 тоже понимаются. */
export function constantBySym(sym: string): PhysConst | undefined {
  const s = sym === 'ε0' || sym === 'ε_0' || sym === 'eps_0' ? 'eps0' : sym === 'μ0' || sym === 'μ_0' || sym === 'mu_0' ? 'mu0' : sym;
  return CONSTANTS.find((c) => c.sym === s);
}
