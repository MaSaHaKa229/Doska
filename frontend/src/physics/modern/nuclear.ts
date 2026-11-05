/**
 * Атом и ядро (этап 7.8b): модель Бора, опыт Резерфорда, энергия связи,
 * радиоактивный распад, ядерные реакции. Чистые функции.
 */

import { HC_EV_NM } from './quantum';

// =====================================================================
//  Атом водорода по Бору
// =====================================================================

/** Энергия уровня, эВ: Eₙ = −13,6/n². */
export const level = (n: number) => -13.6 / (n * n);

export const SERIES: Record<number, { title: string; range: string }> = {
  1: { title: 'Лаймана', range: 'ультрафиолет' },
  2: { title: 'Бальмера', range: 'видимый свет' },
  3: { title: 'Пашена', range: 'инфракрасное' },
  4: { title: 'Брэкета', range: 'инфракрасное' },
  5: { title: 'Пфунда', range: 'инфракрасное' },
  6: { title: 'Хамфри', range: 'инфракрасное' },
};

export interface Transition {
  /** Энергия фотона, эВ; длина волны, нм; частота, Гц. */
  E: number;
  lambda: number;
  nu: number;
  series: string;
}

/** Переход между уровнями n > k: hν = Eₙ − Eₖ. */
export function transition(n: number, k: number): Transition {
  const E = level(n) - level(k);
  const lambda = HC_EV_NM / E;
  return { E, lambda, nu: 3e8 / (lambda * 1e-9), series: SERIES[k]?.title ?? '' };
}

/** Радиус орбиты: rₙ = r₁n², r₁ = 0,053 нм. */
export const orbit = (n: number) => 0.053 * n * n;

// =====================================================================
//  Опыт Резерфорда
// =====================================================================

/**
 * Расстояние наибольшего сближения при лобовом ударе, м:
 * d = k·2Ze²/E (α-частица с энергией E, МэВ, и ядро с зарядом Ze).
 */
export const closest = (Z: number, EMeV: number) => (9e9 * 2 * Z * 1.6e-19) / (EMeV * 1e6);

/** Угол рассеяния: tg(θ/2) = d/(2b). */
export const scatterAngle = (b: number, d: number) => 2 * Math.atan(d / (2 * Math.abs(b)));

/**
 * Траектория в отталкивающем кулоновском поле (в единицах рисунка): старт
 * слева на расстоянии x0 с прицельным параметром b, скорость 1; ускорение
 * (d/2)/r² по радиусу (энергия частицы — E = U(d)). Шаг подстраивается у ядра.
 */
export function trajectory(b: number, d: number, x0 = 400, steps = 4000): { x: number; y: number; t: number }[] {
  let x = -x0;
  let y = b;
  let vx = 1;
  let vy = 0;
  let t = 0;
  const pts = [{ x, y, t }];
  const tEnd = 2 * x0;
  for (let i = 0; i < steps && t < tEnd; i++) {
    const r = Math.hypot(x, y);
    const dt = Math.min(2, Math.max(0.02, r / 40));
    const acc = (rx: number, ry: number) => {
      const rr = Math.hypot(rx, ry);
      const a = d / 2 / (rr * rr * rr);
      return [a * rx, a * ry] as const;
    };
    // Скоростной Верле.
    const [ax, ay] = acc(x, y);
    x += vx * dt + (ax * dt * dt) / 2;
    y += vy * dt + (ay * dt * dt) / 2;
    const [bx, by] = acc(x, y);
    vx += ((ax + bx) * dt) / 2;
    vy += ((ay + by) * dt) / 2;
    t += dt;
    pts.push({ x, y, t });
    if (Math.hypot(x, y) > x0 * 1.2 && t > x0) break;
  }
  return pts;
}

// =====================================================================
//  Нуклиды: массы и энергия связи
// =====================================================================

const SYMBOLS = 'n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U'.split(' ');

/** Символ элемента по Z (0 — нейтрон). */
export const symbolOf = (Z: number) => SYMBOLS[Z] ?? `Z${Z}`;
/** Z по символу элемента (без учёта регистра; «n» — азот N, а не нейтрон: нейтрон — частица). */
export const zOf = (symbol: string) => {
  const i = SYMBOLS.findIndex((s, z) => z > 0 && s === symbol);
  return i > 0 ? i : SYMBOLS.findIndex((s, z) => z > 0 && s.toLowerCase() === symbol.toLowerCase());
};

export const ELEMENT_TITLE: Record<string, string> = {
  H: 'Водород', He: 'Гелий', Li: 'Литий', Be: 'Бериллий', C: 'Углерод', N: 'Азот', O: 'Кислород', Al: 'Алюминий', P: 'Фосфор', Fe: 'Железо', Co: 'Кобальт',
  Cu: 'Медь', Kr: 'Криптон', Sr: 'Стронций', I: 'Иод', Cs: 'Цезий', Ba: 'Барий', Pb: 'Свинец', Bi: 'Висмут', Po: 'Полоний', Rn: 'Радон', Ra: 'Радий', Th: 'Торий', Pa: 'Протактиний', U: 'Уран', Xe: 'Ксенон', Y: 'Иттрий', Ni: 'Никель',
};

/** Массы нейтральных атомов, а. е. м. (масса нейтрона — для n). */
export const MASSES: Record<string, number> = {
  'n-1': 1.008665,
  'H-1': 1.007825,
  'H-2': 2.014102,
  'H-3': 3.016049,
  'He-3': 3.016029,
  'He-4': 4.002603,
  'Li-6': 6.015123,
  'Li-7': 7.016003,
  'Be-9': 9.012183,
  'C-12': 12,
  'C-14': 14.003242,
  'N-14': 14.003074,
  'O-16': 15.994915,
  'O-17': 16.999132,
  'Al-27': 26.981538,
  'P-30': 29.978314,
  'Fe-56': 55.934936,
  'Co-60': 59.933817,
  'Ni-60': 59.930786,
  'Cu-63': 62.929598,
  'Kr-92': 91.926156,
  'Sr-90': 89.907738,
  'Y-90': 89.907144,
  'I-131': 130.906125,
  'Xe-131': 130.905082,
  'Ba-141': 140.914411,
  'Cs-137': 136.907089,
  'Ba-137': 136.905827,
  'Pb-206': 205.974465,
  'Pb-208': 207.976652,
  'Po-210': 209.982874,
  'Po-218': 218.008973,
  'Rn-222': 222.017578,
  'Ra-226': 226.025410,
  'Th-234': 234.043601,
  'U-235': 235.04393,
  'U-238': 238.050788,
};

/** 1 а. е. м. · c² = 931,5 МэВ. */
export const U_MEV = 931.5;
export const M_H = 1.007825;
export const M_N = 1.008665;

export interface Binding {
  Z: number;
  N: number;
  A: number;
  /** Дефект масс, а. е. м.; энергия связи, МэВ; на нуклон, МэВ. */
  dm: number;
  E: number;
  perNucleon: number;
}

/** Δm = Z·m(¹H) + N·mₙ − M(атома) — массы электронов сокращаются. */
export function binding(Z: number, A: number, M: number): Binding {
  const N = A - Z;
  const dm = Z * M_H + N * M_N - M;
  const E = dm * U_MEV;
  return { Z, N, A, dm, E, perNucleon: E / A };
}

export const massOf = (Z: number, A: number) => MASSES[`${symbolOf(Z)}-${A}`];

// =====================================================================
//  Радиоактивный распад
// =====================================================================

export type DecayKind = 'alpha' | 'beta';

export interface Radioactive {
  Z: number;
  A: number;
  kind: DecayKind;
  /** Период полураспада и его запись. */
  T: number;
  Ttext: string;
}

export const RADIOACTIVE: Record<string, Radioactive> = {
  'U-238': { Z: 92, A: 238, kind: 'alpha', T: 4.5e9 * 3.156e7, Ttext: '4,5 млрд лет' },
  'Ra-226': { Z: 88, A: 226, kind: 'alpha', T: 1600 * 3.156e7, Ttext: '1600 лет' },
  'Rn-222': { Z: 86, A: 222, kind: 'alpha', T: 3.8 * 86400, Ttext: '3,8 сут' },
  'Po-210': { Z: 84, A: 210, kind: 'alpha', T: 138 * 86400, Ttext: '138 сут' },
  'C-14': { Z: 6, A: 14, kind: 'beta', T: 5730 * 3.156e7, Ttext: '5730 лет' },
  'I-131': { Z: 53, A: 131, kind: 'beta', T: 8 * 86400, Ttext: '8 сут' },
  'Co-60': { Z: 27, A: 60, kind: 'beta', T: 5.3 * 3.156e7, Ttext: '5,3 года' },
  'Sr-90': { Z: 38, A: 90, kind: 'beta', T: 29 * 3.156e7, Ttext: '29 лет' },
  'Cs-137': { Z: 55, A: 137, kind: 'beta', T: 30 * 3.156e7, Ttext: '30 лет' },
};

/** Закон радиоактивного распада: N = N₀·2^(−t/T). */
export const remaining = (N0: number, t: number, T: number) => N0 * 2 ** (-t / T);

/** Продукт распада: α — (Z − 2, A − 4), β⁻ — (Z + 1, A). */
export const daughter = (Z: number, A: number, kind: DecayKind) => (kind === 'alpha' ? { Z: Z - 2, A: A - 4 } : { Z: Z + 1, A });

/**
 * Время жизни j-го ядра в долях периода полураспада: τ = −T·log₂(u),
 * u — псевдослучайное от номера. Все участники видят одну и ту же картину.
 */
export function lifetime(u: number): number {
  return -Math.log2(Math.max(1e-12, u));
}

// =====================================================================
//  Ядерные реакции
// =====================================================================

export interface Nuclide {
  Z: number;
  A: number;
  /** Обозначение: символ элемента или частицы. */
  sym: string;
  /** Вклад в массу при подсчёте по массам атомов, а. е. м.; null — неизвестна. */
  mass: number | null;
  count: number;
}

const PARTICLE: Record<string, { Z: number; A: number; sym: string; mass: number }> = {
  p: { Z: 1, A: 1, sym: 'p', mass: M_H },
  n: { Z: 0, A: 1, sym: 'n', mass: M_N },
  d: { Z: 1, A: 2, sym: 'd', mass: 2.014102 },
  t: { Z: 1, A: 3, sym: 't', mass: 3.016049 },
  a: { Z: 2, A: 4, sym: 'α', mass: 4.002603 },
  'α': { Z: 2, A: 4, sym: 'α', mass: 4.002603 },
  // По массам атомов: электрон β⁻-распада уже учтён в массе атома-продукта, у β⁺ — две массы электрона.
  e: { Z: -1, A: 0, sym: 'e', mass: 0 },
  'e-': { Z: -1, A: 0, sym: 'e', mass: 0 },
  'e+': { Z: 1, A: 0, sym: 'e', mass: 2 * 0.000549 },
  'γ': { Z: 0, A: 0, sym: 'γ', mass: 0 },
  g: { Z: 0, A: 0, sym: 'γ', mass: 0 },
};

/** Разбор одного слагаемого: «2 He4», «U-235», «p», «X» (неизвестное). */
function parseTerm(raw: string): Nuclide | 'X' | { error: string } {
  const m = /^(\d+)\s*(.+)$/.exec(raw.trim());
  const count = m ? Number(m[1]) : 1;
  const body = (m ? m[2]! : raw).trim();
  if (/^[xх]$/i.test(body)) return 'X';
  const part = PARTICLE[body.toLowerCase()] ?? PARTICLE[body];
  if (part) return { ...part, count };
  const iso = /^([A-Za-z]{1,2})-?(\d{1,3})$/.exec(body);
  if (!iso) return { error: `не понял «${raw.trim()}»: пишите, например, U235, He-4, p, n, a, e` };
  const Z = zOf(iso[1]!);
  if (Z <= 0) return { error: `нет элемента «${iso[1]}»` };
  const A = Number(iso[2]);
  if (A < Z) return { error: `у ${symbolOf(Z)} массовое число не может быть меньше ${Z}` };
  return { Z, A, sym: symbolOf(Z), mass: massOf(Z, A) ?? null, count };
}

export interface Reaction {
  left: Nuclide[];
  right: Nuclide[];
  /** Суммы зарядовых и массовых чисел. */
  zl: number;
  zr: number;
  al: number;
  ar: number;
  /** Найденное неизвестное X, если было. */
  unknown: Nuclide | null;
  /** Энергетический выход, МэВ (> 0 — выделяется); null — нет масс. */
  Q: number | null;
}

const side = (s: string) => s.split('+').map((x) => x.trim()).filter(Boolean);

/** «Li7 + p -> 2 He4»: проверка законов сохранения, неизвестное X, выход энергии. */
export function parseReaction(text: string): Reaction | { error: string } {
  const parts = text.replace(/→|=>|=/g, '->').split('->');
  if (parts.length !== 2) return { error: 'нужна стрелка: «->» или «→»' };
  const L: (Nuclide | 'X')[] = [];
  const Rr: (Nuclide | 'X')[] = [];
  for (const [src, dst] of [[parts[0]!, L], [parts[1]!, Rr]] as const) {
    const terms = side(src);
    if (!terms.length) return { error: 'пустая часть реакции' };
    for (const t of terms) {
      const r = parseTerm(t);
      if (typeof r === 'object' && 'error' in r) return r;
      dst.push(r);
    }
  }
  const xs = [...L, ...Rr].filter((x) => x === 'X').length;
  if (xs > 1) return { error: 'неизвестное X может быть только одно' };
  const sum = (arr: (Nuclide | 'X')[], f: (n: Nuclide) => number) => arr.reduce((s, x) => s + (x === 'X' ? 0 : f(x) * x.count), 0);
  let zl = sum(L, (n) => n.Z);
  let zr = sum(Rr, (n) => n.Z);
  let al = sum(L, (n) => n.A);
  let ar = sum(Rr, (n) => n.A);
  let unknown: Nuclide | null = null;
  if (xs) {
    const inLeft = L.includes('X');
    const Z = inLeft ? zr - zl : zl - zr;
    const A = inLeft ? ar - al : al - ar;
    if (A < 0 || (A === 0 && Z === 0)) return { error: 'неизвестное не находится: проверьте запись' };
    const known = Object.values(PARTICLE).find((p) => p.Z === Z && p.A === A && p.sym !== 'α' && p.sym !== 'd' && p.sym !== 't');
    unknown = Z === 0 && A > 1 ? { ...PARTICLE.n!, count: A } : known && A <= 1 ? { ...known, count: 1 } : Z >= 1 && A >= Z ? { Z, A, sym: symbolOf(Z), mass: massOf(Z, A) ?? null, count: 1 } : { Z, A, sym: Z === 2 && A === 4 ? 'α' : '?', mass: null, count: 1 };
    const fill = (arr: (Nuclide | 'X')[]) => arr.map((x) => (x === 'X' ? unknown! : x));
    L.splice(0, L.length, ...fill(L));
    Rr.splice(0, Rr.length, ...fill(Rr));
    zl = sum(L, (n) => n.Z);
    zr = sum(Rr, (n) => n.Z);
    al = sum(L, (n) => n.A);
    ar = sum(Rr, (n) => n.A);
  }
  const left = L as Nuclide[];
  const right = Rr as Nuclide[];
  const mass = (arr: Nuclide[]) => (arr.every((n) => n.mass !== null) ? arr.reduce((s, n) => s + n.mass! * n.count, 0) : null);
  const ml = mass(left);
  const mr = mass(right);
  const Q = ml !== null && mr !== null && zl === zr && al === ar ? (ml - mr) * U_MEV : null;
  return { left, right, zl, zr, al, ar, unknown, Q };
}
