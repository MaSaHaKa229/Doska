/**
 * Современная физика (этап 7.8a): теория относительности и кванты.
 * Чистые функции по школьным формулам, единицы СИ, если не сказано иное.
 */

export const C = 3e8;
export const H = 6.63e-34;
export const E_CHARGE = 1.6e-19;
/** hc в эВ·нм: E (эВ) = 1240 / λ (нм). */
export const HC_EV_NM = (H * C) / E_CHARGE / 1e-9;

// =====================================================================
//  Специальная теория относительности
// =====================================================================

/** Лоренц-фактор γ = 1/√(1 − v²/c²) для β = v/c ∈ [0, 1). */
export const gamma = (beta: number) => 1 / Math.sqrt(1 - beta * beta);

export interface Relativity {
  gamma: number;
  /** Время по часам Земли за собственное время t0: Δt = γΔt₀. */
  t: number;
  /** Длина движущегося тела: l = l₀/γ. */
  l: number;
  /** Энергия покоя, полная и кинетическая, Дж; импульс, кг·м/с. */
  E0: number;
  E: number;
  Ek: number;
  p: number;
  /** Ek по классической формуле mv²/2 — для сравнения. */
  EkClassic: number;
}

export function relativity(beta: number, t0: number, l0: number, m: number): Relativity {
  const g = gamma(beta);
  const E0 = m * C * C;
  const v = beta * C;
  return { gamma: g, t: g * t0, l: l0 / g, E0, E: g * E0, Ek: (g - 1) * E0, p: g * m * v, EkClassic: (m * v * v) / 2 };
}

/** Сложение скоростей (в долях c): u = (u′ + v)/(1 + u′v/c²) — никогда не больше c. */
export const addVelocities = (u1: number, v: number) => (u1 + v) / (1 + u1 * v);

// =====================================================================
//  Фотоэффект
// =====================================================================

/** Работы выхода, эВ — по школьному задачнику. */
export const METALS: Record<string, { title: string; A: number }> = {
  Cs: { title: 'Цезий', A: 1.9 },
  K: { title: 'Калий', A: 2.2 },
  Na: { title: 'Натрий', A: 2.3 },
  Li: { title: 'Литий', A: 2.4 },
  Zn: { title: 'Цинк', A: 4.2 },
  Ag: { title: 'Серебро', A: 4.3 },
  Cu: { title: 'Медь', A: 4.5 },
  W: { title: 'Вольфрам', A: 4.5 },
  Pt: { title: 'Платина', A: 5.3 },
};

export interface Photoeffect {
  /** Энергия фотона, эВ; частота, Гц. */
  Ephoton: number;
  nu: number;
  /** Наибольшая кинетическая энергия фотоэлектронов, эВ (0 — фотоэффекта нет). */
  Ek: number;
  /** Есть ли фотоэффект: hν > A. */
  happens: boolean;
  /** Задерживающее напряжение, В: eU₃ = Eₖ. */
  Ustop: number;
  /** Красная граница: ν_min = A/h, λ_max = hc/A (нм). */
  nuMin: number;
  lambdaMax: number;
  /** Наибольшая скорость электронов, м/с: Eₖ = mv²/2. */
  vMax: number;
}

/** Уравнение Эйнштейна hν = A + Eₖ. λ — нм, A — эВ. */
export function photoeffect(lambdaNm: number, A: number): Photoeffect {
  const Ephoton = HC_EV_NM / lambdaNm;
  const Ek = Math.max(0, Ephoton - A);
  return {
    Ephoton,
    nu: C / (lambdaNm * 1e-9),
    Ek,
    happens: Ephoton > A,
    Ustop: Ek,
    nuMin: (A * E_CHARGE) / H,
    lambdaMax: HC_EV_NM / A,
    vMax: Math.sqrt((2 * Ek * E_CHARGE) / 9.1e-31),
  };
}

/**
 * Вольт-амперная характеристика фотоэлемента (качественно): ток нулевой
 * при U ≤ −U₃, растёт и выходит на насыщение; ток насыщения пропорционален
 * интенсивности света (числу фотонов). Возвращает долю от наибольшего тока.
 */
export function photoCurrent(U: number, Ustop: number, intensity: number, happens: boolean): number {
  if (!happens) return 0;
  const f = Math.max(0, Math.min(1, (U + Ustop) / (Ustop + 1)));
  return intensity * Math.sqrt(f);
}

// =====================================================================
//  Фотон и шкала электромагнитных волн
// =====================================================================

export interface Photon {
  nu: number;
  /** Энергия, Дж и эВ; импульс; «масса» E/c². */
  E: number;
  eV: number;
  p: number;
  m: number;
}

/** λ — в метрах. */
export function photon(lambda: number): Photon {
  const nu = C / lambda;
  const E = H * nu;
  return { nu, E, eV: E / E_CHARGE, p: H / lambda, m: E / (C * C) };
}

/** Диапазоны шкалы (границы по λ, м) — от длинных волн к коротким. */
export const EM_BANDS: { title: string; from: number; to: number; color: string }[] = [
  { title: 'Радиоволны', from: 1e-3, to: 1e4, color: '#94a3b8' },
  { title: 'Инфракрасное', from: 7.6e-7, to: 1e-3, color: '#f87171' },
  { title: 'Видимый свет', from: 3.8e-7, to: 7.6e-7, color: '#facc15' },
  { title: 'Ультрафиолет', from: 1e-8, to: 3.8e-7, color: '#a78bfa' },
  { title: 'Рентгеновское', from: 1e-11, to: 1e-8, color: '#60a5fa' },
  { title: 'Гамма-излучение', from: 1e-14, to: 1e-11, color: '#34d399' },
];

export const bandOf = (lambda: number) => EM_BANDS.find((b) => lambda >= b.from && lambda < b.to)?.title ?? (lambda >= 1e4 ? 'Радиоволны' : 'Гамма-излучение');

/** Цвет видимого света по длине волны (нм); вне 380–760 нм — null. */
export function wavelengthColor(nm: number): string | null {
  if (nm < 380 || nm > 760) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 440) [r, b] = [(440 - nm) / 60, 1];
  else if (nm < 490) [g, b] = [(nm - 440) / 50, 1];
  else if (nm < 510) [g, b] = [1, (510 - nm) / 20];
  else if (nm < 580) [r, g] = [(nm - 510) / 70, 1];
  else if (nm < 645) [r, g] = [1, (645 - nm) / 65];
  else r = 1;
  // Яркость спадает к краям видимого диапазона.
  const k = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (760 - nm)) / 60 : 1;
  const c = (v: number) => Math.round(255 * Math.pow(v * k, 0.8));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

// =====================================================================
//  Волны де Бройля
// =====================================================================

export const PARTICLES: Record<string, { title: string; m: number; q: number }> = {
  electron: { title: 'Электрон', m: 9.1e-31, q: 1.6e-19 },
  proton: { title: 'Протон', m: 1.67e-27, q: 1.6e-19 },
  neutron: { title: 'Нейтрон', m: 1.675e-27, q: 0 },
  alpha: { title: 'Альфа-частица', m: 6.64e-27, q: 3.2e-19 },
  body: { title: 'Тело (масса задаётся)', m: 0.1, q: 0 },
};

export interface DeBroglie {
  v: number;
  p: number;
  lambda: number;
  /** Скорость сравнима со скоростью света — импульс считается как γmv. */
  relativistic: boolean;
}

/** λ = h/p. Скорость — заданная или после ускоряющего напряжения U: qU = mv²/2. */
export function deBroglie(m: number, v: number): DeBroglie {
  const beta = Math.min(v / C, 0.999999);
  const relativistic = beta > 0.1;
  const p = (relativistic ? gamma(beta) : 1) * m * v;
  return { v, p, lambda: H / p, relativistic };
}

/** Скорость после разгона напряжением U (с учётом теории относительности). */
export function speedAfter(m: number, q: number, U: number): number {
  const g = 1 + (q * U) / (m * C * C);
  return C * Math.sqrt(1 - 1 / (g * g));
}

/** Размеры для сравнения на логарифмической шкале, м. */
export const SIZES: { title: string; size: number }[] = [
  { title: 'ядро', size: 1e-15 },
  { title: 'атом', size: 1e-10 },
  { title: 'вирус', size: 1e-7 },
  { title: 'свет', size: 5e-7 },
  { title: 'клетка', size: 1e-5 },
];
