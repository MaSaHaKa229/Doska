/**
 * Магнетизм (этап 7.4): чистые функции. Направления считаются в координатах
 * доски: x вправо, y вниз, ось z — от зрителя (правая тройка). «Поле на нас»
 * (точки) — B = (0, 0, −B), «от нас» (крестики) — (0, 0, +B).
 */

export type Out = 'out' | 'in';

/** z-компонента поля в координатах доски. */
export const bz = (B: number, dir: Out) => (dir === 'out' ? -B : B);

/** Сила q·v × B (или I·L × B) для вектора в плоскости доски и поля B вдоль z. */
export function crossZ(vx: number, vy: number, Bz: number): { x: number; y: number } {
  return { x: vy * Bz, y: -vx * Bz };
}

/**
 * Касательная к линии поля прямого тока в точке на угле a (координаты
 * доски): ток «на нас» — линии против часовой стрелки (как видит зритель),
 * «от нас» — по часовой (правило буравчика).
 */
export function wireTangent(a: number, dir: Out): { x: number; y: number } {
  return dir === 'out' ? { x: Math.sin(a), y: -Math.cos(a) } : { x: -Math.sin(a), y: Math.cos(a) };
}

// =====================================================================
//  Заряд в однородном магнитном поле
// =====================================================================

export const PARTICLES = {
  electron: { title: 'Электрон', q: -1.6e-19, m: 9.1e-31 },
  proton: { title: 'Протон', q: 1.6e-19, m: 1.67e-27 },
  alpha: { title: 'α-частица', q: 3.2e-19, m: 6.64e-27 },
} as const;
export type ParticleKind = keyof typeof PARTICLES;

export interface Orbit {
  /** Радиус и период в СИ. */
  r: number;
  T: number;
  F: number;
  /** Направление обхода на доске: 1 — по часовой стрелке (как видит зритель), −1 — против. */
  turn: 1 | -1;
}

/** r = mv/(|q|B), T = 2πm/(|q|B), F = |q|vB. */
export function orbit(q: number, m: number, v: number, B: number, dir: Out): Orbit {
  const aq = Math.abs(q);
  // Начальная скорость — вправо; сила — к центру; обход — от v к F.
  const f = crossZ(1, 0, bz(1, dir) * Math.sign(q));
  return { r: (m * v) / (aq * B), T: (2 * Math.PI * m) / (aq * B), F: aq * v * B, turn: f.y > 0 ? 1 : -1 };
}

// =====================================================================
//  Рамка в магнитном поле (генератор)
// =====================================================================

export interface Rotor {
  omega: number;
  /** Φ(t) = BS cos ωt, ε(t) = NBSω sin ωt. */
  flux(t: number): number;
  emf(t: number): number;
  emfMax: number;
}

/** S — в см², f — оборотов в секунду. */
export function rotor(B: number, S: number, N: number, f: number): Rotor {
  const omega = 2 * Math.PI * f;
  const s = S * 1e-4;
  return { omega, flux: (t) => B * s * Math.cos(omega * t), emf: (t) => N * B * s * omega * Math.sin(omega * t), emfMax: N * B * s * omega };
}

// =====================================================================
//  Правило Ленца: магнит у кольца
// =====================================================================

export interface Lenz {
  /** Положение магнита (доля пути к кольцу 0…1) и скорость (+ — приближается). */
  x: number;
  approaching: boolean;
  /** Полюс кольца, обращённый к магниту: при приближении — одноимённый (отталкивание), при удалении — разноимённый. */
  ringPole: 'N' | 'S';
}

/** Магнит приближается первую половину времени и удаляется вторую. */
export function lenz(t: number, tEnd: number, facing: 'N' | 'S'): Lenz {
  const u = Math.max(0, Math.min(1, t / tEnd));
  const approaching = u < 0.5;
  const other = facing === 'N' ? 'S' : 'N';
  return { x: Math.sin(Math.PI * u), approaching, ringPole: approaching ? facing : other };
}
