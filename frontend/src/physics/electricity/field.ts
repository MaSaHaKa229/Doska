/**
 * Электростатика (этап 7.3a): поле системы точечных зарядов — чистые функции.
 *
 * Координаты зарядов — в пикселях доски внутри рамки системы; масштаб:
 * одна клетка (20 пикселей) = `cell` сантиметров. Заряды — в нанокулонах.
 * Физические величины считаются в СИ: k = 9·10⁹ / ε Н·м²/Кл².
 */

export const CELL_PX = 20;
export const K = 9e9;

export interface Charge {
  id: string;
  x: number;
  y: number;
  /** Заряд, нКл (не ноль). */
  q: number;
}

export interface System {
  charges: Charge[];
  /** Сантиметров в клетке. */
  cell: number;
  /** Диэлектрическая проницаемость среды. */
  eps: number;
}

/** Пиксели → метры. */
export const pxToM = (s: System) => (s.cell * 0.01) / CELL_PX;

/** Напряжённость (Н/Кл, ось y доски вниз) и потенциал (В) в точке (пиксели). */
export function fieldAt(s: System, x: number, y: number): { ex: number; ey: number; phi: number } {
  const m = pxToM(s);
  const k = K / s.eps;
  let ex = 0;
  let ey = 0;
  let phi = 0;
  for (const c of s.charges) {
    const dx = (x - c.x) * m;
    const dy = (y - c.y) * m;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-18) continue;
    const r = Math.sqrt(r2);
    const q = c.q * 1e-9;
    const e = (k * q) / r2;
    ex += (e * dx) / r;
    ey += (e * dy) / r;
    phi += (k * q) / r;
  }
  return { ex, ey, phi };
}

/** Силы Кулона на каждый заряд (Н, ось y вниз). */
export function forces(s: System): { id: string; fx: number; fy: number }[] {
  const m = pxToM(s);
  const k = K / s.eps;
  return s.charges.map((a) => {
    let fx = 0;
    let fy = 0;
    for (const b of s.charges) {
      if (a === b) continue;
      const dx = (a.x - b.x) * m;
      const dy = (a.y - b.y) * m;
      const r = Math.hypot(dx, dy);
      if (r < 1e-12) continue;
      const f = (k * a.q * 1e-9 * b.q * 1e-9) / (r * r);
      fx += (f * dx) / r;
      fy += (f * dy) / r;
    }
    return { id: a.id, fx, fy };
  });
}

/** Начальный радиус линий у заряда и радиус «попадания» в заряд, пиксели. */
const R0 = 10;
const STEP = 4;
const MAX_STEPS = 700;

/**
 * Силовые линии: выходят из зарядов знака, которого больше по модулю
 * (суммарно), и идут вдоль поля (из отрицательных — против), пока не
 * попадут в другой заряд или не выйдут за рамку. Число линий у заряда —
 * пропорционально |q| (от 4 до `perCharge`).
 */
export function fieldLines(s: System, w: number, h: number, perCharge = 12): number[][] {
  if (!s.charges.length) return [];
  const pos = s.charges.filter((c) => c.q > 0).reduce((a, c) => a + c.q, 0);
  const neg = -s.charges.filter((c) => c.q < 0).reduce((a, c) => a + c.q, 0);
  const fromPositive = pos >= neg;
  const sources = s.charges.filter((c) => (fromPositive ? c.q > 0 : c.q < 0));
  const qMax = Math.max(...sources.map((c) => Math.abs(c.q)));
  const out: number[][] = [];
  const dir = fromPositive ? 1 : -1;
  for (const c of sources) {
    const n = Math.max(4, Math.round((perCharge * Math.abs(c.q)) / qMax));
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * 2 * Math.PI;
      let x = c.x + R0 * Math.cos(a);
      let y = c.y + R0 * Math.sin(a);
      const pts = [x, y];
      for (let k = 0; k < MAX_STEPS; k++) {
        // Метод средней точки по направлению поля.
        const d1 = unit(s, x, y, dir);
        if (!d1) break;
        const d2 = unit(s, x + (d1.x * STEP) / 2, y + (d1.y * STEP) / 2, dir);
        if (!d2) break;
        x += d2.x * STEP;
        y += d2.y * STEP;
        pts.push(x, y);
        if (x < 0 || y < 0 || x > w || y > h) break;
        if (s.charges.some((o) => o !== c && Math.hypot(o.x - x, o.y - y) < R0)) break;
      }
      // Линия из отрицательного заряда строилась против поля — разворачиваем: точки всегда идут по полю (стрелки).
      if (dir < 0) {
        const rev: number[] = [];
        for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k]!, pts[k + 1]!);
        out.push(rev);
      } else out.push(pts);
    }
  }
  return out;
}

function unit(s: System, x: number, y: number, dir: number): { x: number; y: number } | null {
  const e = fieldAt(s, x, y);
  const l = Math.hypot(e.ex, e.ey);
  if (!Number.isFinite(l) || l < 1e-30) return null;
  return { x: (dir * e.ex) / l, y: (dir * e.ey) / l };
}

/**
 * Эквипотенциали: квадраты по сетке шагом `cellPx`, уровни — потенциалы на
 * расстояниях 1,5; 2,5; 4 и 6 клеток от самого сильного заряда каждого
 * знака. Отрезки [x0, y0, x1, y1].
 */
export function equipotentials(s: System, w: number, h: number, cellPx = 6): { level: number; segs: number[] }[] {
  if (!s.charges.length) return [];
  const nx = Math.ceil(w / cellPx);
  const ny = Math.ceil(h / cellPx);
  const phi = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) phi[j * (nx + 1) + i] = fieldAt(s, i * cellPx, j * cellPx).phi;
  const m = pxToM(s);
  const k = K / s.eps;
  const levels = new Set<number>();
  for (const sign of [1, -1]) {
    const strongest = s.charges.filter((c) => Math.sign(c.q) === sign).sort((a, b) => Math.abs(b.q) - Math.abs(a.q))[0];
    if (!strongest) continue;
    for (const cells of [1.5, 2.5, 4, 6]) levels.add((k * strongest.q * 1e-9) / (cells * CELL_PX * m));
  }
  const at = (i: number, j: number) => phi[j * (nx + 1) + i]!;
  const out: { level: number; segs: number[] }[] = [];
  for (const L of levels) {
    const segs: number[] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const xs = [i, i + 1, i + 1, i].map((q) => q * cellPx);
        const ys = [j, j, j + 1, j + 1].map((q) => q * cellPx);
        const cross: number[] = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e]!;
          const b = v[(e + 1) % 4]!;
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          if ((a - L) * (b - L) < 0) {
            const t = (L - a) / (b - a);
            cross.push(xs[e]! + (xs[(e + 1) % 4]! - xs[e]!) * t, ys[e]! + (ys[(e + 1) % 4]! - ys[e]!) * t);
          }
        }
        if (cross.length >= 4) segs.push(cross[0]!, cross[1]!, cross[2]!, cross[3]!);
      }
    out.push({ level: L, segs });
  }
  return out;
}

// =====================================================================
//  Конденсатор
// =====================================================================

export const EPS0 = 8.85e-12;

/** Плоский конденсатор: S — см², d — мм, U — В. */
export function capacitor(S: number, d: number, U: number, eps: number): { C: number; E: number; q: number; W: number } {
  const C = (eps * EPS0 * S * 1e-4) / (d * 1e-3);
  return { C, E: U / (d * 1e-3), q: C * U, W: (C * U * U) / 2 };
}

// =====================================================================
//  Запись с приставками
// =====================================================================

const PREFIX: [number, string][] = [
  [1e9, 'Г'],
  [1e6, 'М'],
  [1e3, 'к'],
  [1, ''],
  [1e-3, 'м'],
  [1e-6, 'мк'],
  [1e-9, 'н'],
  [1e-12, 'п'],
];

/** Значение с подходящей приставкой: 8,4·10⁻⁵ Н → «84 мкН». */
export function withPrefix(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  const [f, p] = PREFIX.find(([f]) => a >= f * 0.9999) ?? PREFIX[PREFIX.length - 1]!;
  const x = v / f;
  const s = String(Number(x.toPrecision(digits))).replace('.', ',').replace('-', '−');
  return `${s} ${p}${unit}`;
}
