/**
 * Молекулярная физика и термодинамика (этап 7.6): чистые функции по
 * школьным формулам. Единицы СИ, если не сказано иное.
 */

export { sci, seeded } from '../common/quantities';

/** Универсальная газовая постоянная, Дж/(моль·К); постоянная Больцмана, Дж/К. */
export const R = 8.31;
export const K_B = 1.38e-23;

// =====================================================================
//  Идеальный газ
// =====================================================================

export interface GasKind {
  title: string;
  /** Молярная масса, кг/моль. */
  M: number;
  /** Число степеней свободы: 3 — одноатомный, 5 — двухатомный. */
  i: number;
}

export const GASES: Record<string, GasKind> = {
  He: { title: 'Гелий', M: 0.004, i: 3 },
  Ne: { title: 'Неон', M: 0.02, i: 3 },
  Ar: { title: 'Аргон', M: 0.04, i: 3 },
  H2: { title: 'Водород', M: 0.002, i: 5 },
  N2: { title: 'Азот', M: 0.028, i: 5 },
  O2: { title: 'Кислород', M: 0.032, i: 5 },
  air: { title: 'Воздух', M: 0.029, i: 5 },
};

export interface GasState {
  /** Давление, Па. */
  p: number;
  /** Средняя квадратичная скорость, м/с. */
  vrms: number;
  /** Средняя кинетическая энергия поступательного движения молекулы, Дж. */
  ek: number;
  /** Внутренняя энергия, Дж: U = (i/2)νRT. */
  U: number;
  /** Число молекул N = νN_A и концентрация n = N/V. */
  N: number;
  n: number;
  /** Масса газа, кг; плотность, кг/м³. */
  m: number;
  rho: number;
}

/** Уравнение Менделеева — Клапейрона pV = νRT и следствия. V — м³, T — К. */
export function gasState(gas: GasKind, nu: number, V: number, T: number): GasState {
  const p = (nu * R * T) / V;
  const N = nu * 6.02e23;
  const m = nu * gas.M;
  return { p, vrms: Math.sqrt((3 * R * T) / gas.M), ek: 1.5 * K_B * T, U: (gas.i / 2) * nu * R * T, N, n: N / V, m, rho: m / V };
}

// =====================================================================
//  Изопроцессы
// =====================================================================

/** T — изотермический, p — изобарный, V — изохорный, Q — адиабатный. */
export type ProcessKind = 'T' | 'p' | 'V' | 'Q';

export const PROCESS_TITLE: Record<ProcessKind, string> = { T: 'Изотермический', p: 'Изобарный', V: 'Изохорный', Q: 'Адиабатный' };

/** Показатель адиабаты одноатомного газа. */
export const GAMMA = 5 / 3;

export interface PV {
  p: number;
  V: number;
}

export interface ProcessInfo {
  /** Состояние в доле процесса s ∈ [0, 1]. */
  at(s: number): PV;
  /** Работа газа, изменение внутренней энергии, полученное количество теплоты. */
  A: number;
  dU: number;
  Q: number;
  /** Строки решения: закон процесса и первый закон термодинамики. */
  law: string;
}

/**
 * Процесс одноатомного газа из состояния (p1, V1): ratio — V₂/V₁, а для
 * изохорного — T₂/T₁. Работа — по точным формулам, ΔU = (3/2)(p₂V₂ − p₁V₁).
 */
export function processInfo(kind: ProcessKind, p1: number, V1: number, ratio: number): ProcessInfo {
  const lerp = (s: number) => V1 * (1 + (ratio - 1) * s);
  const at: (s: number) => PV =
    kind === 'T' ? (s) => ({ V: lerp(s), p: (p1 * V1) / lerp(s) })
    : kind === 'p' ? (s) => ({ V: lerp(s), p: p1 })
    : kind === 'V' ? (s) => ({ V: V1, p: p1 * (1 + (ratio - 1) * s) })
    : (s) => ({ V: lerp(s), p: p1 * (V1 / lerp(s)) ** GAMMA });
  const end = at(1);
  const dU = 1.5 * (end.p * end.V - p1 * V1);
  const A = kind === 'T' ? p1 * V1 * Math.log(ratio) : kind === 'p' ? p1 * (end.V - V1) : kind === 'V' ? 0 : (p1 * V1 - end.p * end.V) / (GAMMA - 1);
  const Q = kind === 'Q' ? 0 : dU + A;
  const law =
    kind === 'T' ? 'pV = const;  ΔU = 0,  Q = A = νRT·ln(V₂/V₁)'
    : kind === 'p' ? 'V/T = const;  A = pΔV,  ΔU = (3/2)pΔV,  Q = (5/2)pΔV'
    : kind === 'V' ? 'p/T = const;  A = 0,  Q = ΔU = (3/2)νRΔT'
    : 'pV^γ = const, γ = 5/3;  Q = 0,  A = −ΔU';
  return { at, A, dU, Q: kind === 'T' ? A : Q, law };
}

// =====================================================================
//  Циклы
// =====================================================================

export interface Segment {
  name: string;
  at(s: number): PV;
}

export interface CycleInfo {
  /** Полезная работа за цикл (площадь цикла), полученная и отданная теплота. */
  A: number;
  Qin: number;
  Qout: number;
  eta: number;
  /** Наибольшая и наименьшая температуры как pV/(νR) — для сравнения с Карно. */
  pvMax: number;
  pvMin: number;
  /** Теплота на каждом участке (знак — получено/отдано). */
  perSegment: number[];
}

/**
 * Теплота и работа одноатомного газа по участкам: dQ = (3/2)d(pV) + p dV.
 * Положительные части dQ складываются в Qin — так учитываются участки, на
 * которых газ сначала получает, а потом отдаёт тепло.
 */
export function cycleInfo(segments: Segment[], steps = 2000): CycleInfo {
  let A = 0;
  let Qin = 0;
  let Qout = 0;
  let pvMax = -Infinity;
  let pvMin = Infinity;
  const perSegment = segments.map((seg) => {
    let q = 0;
    let prev = seg.at(0);
    for (let k = 1; k <= steps; k++) {
      const cur = seg.at(k / steps);
      const pm = (prev.p + cur.p) / 2;
      const dA = pm * (cur.V - prev.V);
      const dQ = 1.5 * (cur.p * cur.V - prev.p * prev.V) + dA;
      A += dA;
      if (dQ > 0) Qin += dQ;
      else Qout -= dQ;
      q += dQ;
      pvMax = Math.max(pvMax, cur.p * cur.V);
      pvMin = Math.min(pvMin, cur.p * cur.V);
      prev = cur;
    }
    return q;
  });
  return { A, Qin, Qout, eta: Qin > 0 ? A / Qin : 0, pvMax, pvMin, perSegment };
}

const line = (a: PV, b: PV) => (s: number): PV => ({ p: a.p + (b.p - a.p) * s, V: a.V + (b.V - a.V) * s });

/** Прямоугольный цикл: изохора 1→2, изобара 2→3, изохора 3→4, изобара 4→1. */
export function rectCycle(p1: number, p2: number, V1: number, V2: number): Segment[] {
  const s1 = { p: p1, V: V1 };
  const s2 = { p: p2, V: V1 };
  const s3 = { p: p2, V: V2 };
  const s4 = { p: p1, V: V2 };
  return [
    { name: '1→2 изохорное нагревание', at: line(s1, s2) },
    { name: '2→3 изобарное расширение', at: line(s2, s3) },
    { name: '3→4 изохорное охлаждение', at: line(s3, s4) },
    { name: '4→1 изобарное сжатие', at: line(s4, s1) },
  ];
}

/** Треугольный цикл: изохора 1→2, прямая 2→3 к (V₂, p₁), изобара 3→1. */
export function triangleCycle(p1: number, p2: number, V1: number, V2: number): Segment[] {
  const s1 = { p: p1, V: V1 };
  const s2 = { p: p2, V: V1 };
  const s3 = { p: p1, V: V2 };
  return [
    { name: '1→2 изохорное нагревание', at: line(s1, s2) },
    { name: '2→3 расширение по прямой', at: line(s2, s3) },
    { name: '3→1 изобарное сжатие', at: line(s3, s1) },
  ];
}

/**
 * Цикл Карно одноатомного газа: изотерма T₁ (V₁→V₂), адиабата до T₂,
 * изотерма T₂, адиабата обратно. pvHot = νRT₁, pvCold = νRT₂.
 */
export function carnotCycle(pvHot: number, pvCold: number, V1: number, V2: number): Segment[] {
  const k = (pvHot / pvCold) ** (1 / (GAMMA - 1));
  const V3 = V2 * k;
  const V4 = V1 * k;
  const iso = (pv: number, a: number, b: number) => (s: number): PV => {
    const V = a + (b - a) * s;
    return { V, p: pv / V };
  };
  const adi = (pv0: number, a: number, b: number) => (s: number): PV => {
    const V = a + (b - a) * s;
    const p0 = pv0 / a;
    return { V, p: p0 * (a / V) ** GAMMA };
  };
  return [
    { name: '1→2 изотермическое расширение (T₁)', at: iso(pvHot, V1, V2) },
    { name: '2→3 адиабатное расширение', at: adi(pvHot, V2, V3) },
    { name: '3→4 изотермическое сжатие (T₂)', at: iso(pvCold, V3, V4) },
    { name: '4→1 адиабатное сжатие', at: adi(pvCold, V4, V1) },
  ];
}

// =====================================================================
//  Тепловой баланс
// =====================================================================

/** Удельные теплоёмкости, Дж/(кг·°C), — по школьному задачнику. */
export const HEAT_CAPACITY: Record<string, { title: string; c: number; liquid: boolean }> = {
  water: { title: 'Вода', c: 4200, liquid: true },
  alcohol: { title: 'Спирт', c: 2500, liquid: true },
  kerosene: { title: 'Керосин', c: 2100, liquid: true },
  oil: { title: 'Масло подсолнечное', c: 1700, liquid: true },
  aluminium: { title: 'Алюминий', c: 920, liquid: false },
  steel: { title: 'Сталь', c: 500, liquid: false },
  iron: { title: 'Железо', c: 460, liquid: false },
  copper: { title: 'Медь', c: 400, liquid: false },
  brass: { title: 'Латунь', c: 380, liquid: false },
  lead: { title: 'Свинец', c: 140, liquid: false },
};

export interface Balance {
  /** Установившаяся температура θ, °C. */
  theta: number;
  /** Q₁ = c₁m₁(θ − t₁), Q₂ = c₂m₂(θ − t₂): Q₁ + Q₂ = 0. */
  Q1: number;
  Q2: number;
}

/** Уравнение теплового баланса без потерь и без смены агрегатного состояния. */
export function balance(c1: number, m1: number, t1: number, c2: number, m2: number, t2: number): Balance {
  const theta = (c1 * m1 * t1 + c2 * m2 * t2) / (c1 * m1 + c2 * m2);
  return { theta, Q1: c1 * m1 * (theta - t1), Q2: c2 * m2 * (theta - t2) };
}

/** Температуры при выравнивании: разность убывает как e^(−τ/τ₀), θ не меняется. */
export function relax(t: number, theta: number, tau: number, tau0: number): number {
  return theta + (t - theta) * Math.exp(-tau / tau0);
}

// =====================================================================
//  Нагревание, плавление, кипение
// =====================================================================

export interface Substance {
  title: string;
  /** Температура плавления, °C; удельная теплота плавления, Дж/кг. */
  tm: number;
  lambda: number;
  /** Температура кипения, °C, и удельная теплота парообразования, Дж/кг; null — кипение не рассматривается. */
  tb: number | null;
  L: number;
  /** Теплоёмкости твёрдого тела, жидкости и пара. */
  cs: number;
  cl: number;
  cg: number;
  /** Наибольшая температура на графике. */
  tMax: number;
}

export const SUBSTANCES: Record<string, Substance> = {
  water: { title: 'Вода (лёд)', tm: 0, lambda: 3.4e5, tb: 100, L: 2.3e6, cs: 2100, cl: 4200, cg: 2000, tMax: 200 },
  alcohol: { title: 'Спирт', tm: -114, lambda: 1.1e5, tb: 78, L: 0.9e6, cs: 2500, cl: 2500, cg: 1500, tMax: 150 },
  mercury: { title: 'Ртуть', tm: -39, lambda: 0.12e5, tb: 357, L: 0.3e6, cs: 140, cl: 140, cg: 100, tMax: 450 },
  lead: { title: 'Свинец', tm: 327, lambda: 0.25e5, tb: null, L: 0, cs: 140, cl: 140, cg: 140, tMax: 1000 },
  tin: { title: 'Олово', tm: 232, lambda: 0.59e5, tb: null, L: 0, cs: 230, cl: 230, cg: 230, tMax: 1000 },
};

export type Phase = 'solid' | 'liquid' | 'gas';
export const PHASE_TITLE: Record<Phase, string> = { solid: 'твёрдое', liquid: 'жидкое', gas: 'газообразное' };

export interface Stage {
  /** heat — нагревание/охлаждение, change — плавление, кипение и обратные. */
  kind: 'heat' | 'change';
  name: string;
  /** Температура в начале и в конце, °C. */
  t0: number;
  t1: number;
  /** Количество теплоты (по модулю), Дж; время при мощности P, с. */
  Q: number;
  tau: number;
  /** Агрегатное состояние в начале и в конце участка. */
  from: Phase;
  to: Phase;
  formula: string;
}

const phaseAt = (s: Substance, t: number, rising: boolean): Phase => {
  if (t < s.tm || (t === s.tm && rising)) return 'solid';
  if (s.tb !== null && (t > s.tb || (t === s.tb && !rising))) return 'gas';
  return 'liquid';
};

/**
 * Участки графика t(τ) от tStart до tEnd при постоянной мощности P (Вт):
 * при нагревании — плавление и кипение, при охлаждении — конденсация и
 * кристаллизация. Вещество в начале — в состоянии, которое отвечает tStart.
 */
export function heatingStages(s: Substance, m: number, tStart: number, tEnd: number, P: number): Stage[] {
  const up = tEnd >= tStart;
  const stages: Stage[] = [];
  const c = (ph: Phase) => (ph === 'solid' ? s.cs : ph === 'liquid' ? s.cl : s.cg);
  const cName = (ph: Phase) => (ph === 'solid' ? 'c_тв' : ph === 'liquid' ? 'c_ж' : 'c_п');
  const points = [s.tm, ...(s.tb !== null ? [s.tb] : [])].filter((t) => (up ? t >= tStart && t < tEnd : t <= tStart && t > tEnd));
  if (!up) points.reverse();
  let t = tStart;
  let ph = phaseAt(s, tStart, up);
  const heat = (t1: number) => {
    if (t1 === t) return;
    const Q = c(ph) * m * Math.abs(t1 - t);
    stages.push({ kind: 'heat', name: `${up ? 'нагревание' : 'охлаждение'} (${PHASE_TITLE[ph]})`, t0: t, t1, Q, tau: Q / P, from: ph, to: ph, formula: `Q = ${cName(ph)}mΔt` });
    t = t1;
  };
  for (const tp of points) {
    heat(tp);
    const melt = tp === s.tm;
    const next: Phase = melt ? (up ? 'liquid' : 'solid') : up ? 'gas' : 'liquid';
    if (next === ph) continue;
    const Q = (melt ? s.lambda : s.L) * m;
    const name = melt ? (up ? 'плавление' : 'кристаллизация') : up ? 'кипение' : 'конденсация';
    stages.push({ kind: 'change', name, t0: tp, t1: tp, Q, tau: Q / P, from: ph, to: next, formula: melt ? 'Q = λm' : 'Q = Lm' });
    ph = next;
  }
  heat(tEnd);
  return stages;
}

export interface HeatingPoint {
  t: number;
  /** Номер участка и доля пройденного в нём. */
  stage: number;
  frac: number;
  /** Сколько теплоты уже подведено (отведено), Дж. */
  Q: number;
}

/** Состояние в момент τ (с от начала). */
export function heatingAt(stages: Stage[], tau: number): HeatingPoint {
  let Q = 0;
  let left = Math.max(0, tau);
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i]!;
    if (left <= st.tau || i === stages.length - 1) {
      const frac = st.tau > 0 ? Math.min(1, left / st.tau) : 1;
      return { t: st.t0 + (st.t1 - st.t0) * frac, stage: i, frac, Q: Q + st.Q * frac };
    }
    left -= st.tau;
    Q += st.Q;
  }
  return { t: 0, stage: -1, frac: 0, Q: 0 };
}

// =====================================================================
//  Движение молекул на рисунке
// =====================================================================

/** Координата при упругих отражениях от стенок 0 и w: «пила» с отражением. */
export function bounce(u: number, w: number): number {
  if (w <= 0) return 0;
  const m = ((u % (2 * w)) + 2 * w) % (2 * w);
  return m <= w ? m : 2 * w - m;
}
