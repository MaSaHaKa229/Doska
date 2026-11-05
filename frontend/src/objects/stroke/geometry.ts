import { distance, distanceToSegment, type Point, type Rect } from '@doska/shared';

/**
 * Геометрия рукописного штриха. Точки хранятся плоско: [x0, y0, p0, x1, y1, p1, …],
 * p — нажатие 0..1 (мышь — 0,5). Все функции чистые: их используют модуль
 * объекта, инструменты и тесты.
 */

/** Множитель радиуса от нажатия: 0,5 (мышь) — номинальная толщина. */
export function pressureFactor(p: number): number {
  return Math.min(1.7, Math.max(0.3, 0.3 + 1.4 * p));
}

export function pointRadius(width: number, p: number, usePressure: boolean): number {
  return (width / 2) * (usePressure ? pressureFactor(p) : 1);
}

export function pointCount(flat: readonly number[]): number {
  return Math.floor(flat.length / 3);
}

const at = (flat: readonly number[], i: number): Point => ({ x: flat[i * 3]!, y: flat[i * 3 + 1]! });

// ---------------------------------------------------------------------
//  Ввод: прореживание и сглаживание
// ---------------------------------------------------------------------

/**
 * Накопление точек штриха при рисовании. Слишком близкие точки
 * отбрасываются (minDistance), положение сглаживается «стримлайном» —
 * каждая новая точка подтягивается к предыдущей (дрожание руки гасится),
 * нажатие сглаживается скользящим средним.
 */
export class StrokeBuilder {
  readonly points: number[] = [];
  private last: { x: number; y: number; p: number } | null = null;

  constructor(
    /** Минимальное расстояние между точками (мировые единицы). */
    private readonly minDistance: number,
    /** 0 — без сглаживания, 0,9 — сильное. */
    private readonly streamline = 0.45,
  ) {}

  add(x: number, y: number, p: number): boolean {
    const last = this.last;
    if (!last) {
      this.last = { x, y, p };
      this.points.push(x, y, p);
      return true;
    }
    if (Math.hypot(x - last.x, y - last.y) < this.minDistance) return false;
    const k = 1 - this.streamline;
    const nx = last.x + (x - last.x) * k;
    const ny = last.y + (y - last.y) * k;
    const np = last.p + (p - last.p) * 0.5;
    this.last = { x: nx, y: ny, p: np };
    this.points.push(nx, ny, np);
    return true;
  }

  /** Довести штрих до фактической последней точки указателя. */
  finish(x: number, y: number, p: number): void {
    const last = this.last;
    if (last && Math.hypot(x - last.x, y - last.y) >= this.minDistance * 0.5) {
      this.points.push(x, y, last.p + (p - last.p) * 0.5);
      this.last = { x, y, p };
    }
  }

  get count(): number {
    return pointCount(this.points);
  }
}

/** Упрощение ломаной (Рамер — Дуглас — Пекер) с сохранением нажатия точек. */
export function simplifyStroke(flat: readonly number[], epsilon: number): number[] {
  const n = pointCount(flat);
  if (n <= 2) return [...flat];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const pa = at(flat, a);
    const pb = at(flat, b);
    for (let i = a + 1; i < b; i++) {
      // Заметный перепад нажатия тоже сохраняет точку (толщина линии).
      const dp = Math.abs(flat[i * 3 + 2]! - (flat[a * 3 + 2]! + flat[b * 3 + 2]!) / 2) > 0.15 ? epsilon : 0;
      const d = Math.max(distanceToSegment(at(flat, i), pa, pb), dp);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD >= epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!);
  return out;
}

/** Округление координат (размер документа) — до сотых. */
export function roundPoints(flat: readonly number[]): number[] {
  return flat.map((v) => Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------
//  Отрисовка: контур штриха переменной толщины
// ---------------------------------------------------------------------

const CAP_STEPS = 8;

/**
 * Многоугольник контура штриха (плоский [x, y, …]): точки левого края,
 * скруглённый конец, правый край в обратном порядке, скруглённое начало.
 * Толщина в каждой точке зависит от нажатия. Заливается по правилу nonzero,
 * поэтому петли и самопересечения закрашиваются без «дыр».
 */
export function strokeOutline(flat: readonly number[], width: number, usePressure: boolean): number[] {
  const n = pointCount(flat);
  if (n === 0) return [];
  if (n === 1) {
    const c = at(flat, 0);
    const r = Math.max(0.01, pointRadius(width, flat[2]!, usePressure));
    const out: number[] = [];
    for (let i = 0; i < CAP_STEPS * 2; i++) {
      const a = (i / (CAP_STEPS * 2)) * Math.PI * 2;
      out.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
    return out;
  }
  const left: number[] = [];
  const right: number[] = [];
  const normals: Point[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = at(flat, Math.max(0, i - 1));
    const next = at(flat, Math.min(n - 1, i + 1));
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      const nb = normals[i - 1] ?? { x: 0, y: 1 };
      dx = nb.y;
      dy = -nb.x;
    } else {
      dx /= len;
      dy /= len;
    }
    const nrm = { x: -dy, y: dx };
    const r = pointRadius(width, flat[i * 3 + 2]!, usePressure);
    const p = at(flat, i);
    normals.push(nrm);
    radii.push(r);
    left.push(p.x + nrm.x * r, p.y + nrm.y * r);
    right.push(p.x - nrm.x * r, p.y - nrm.y * r);
  }
  const out = [...left];
  // Конец: полуокружность от левого края к правому через направление движения.
  const end = at(flat, n - 1);
  const aEnd = Math.atan2(normals[n - 1]!.y, normals[n - 1]!.x);
  for (let s = 1; s < CAP_STEPS; s++) {
    const a = aEnd - (s / CAP_STEPS) * Math.PI;
    out.push(end.x + Math.cos(a) * radii[n - 1]!, end.y + Math.sin(a) * radii[n - 1]!);
  }
  for (let i = n - 1; i >= 0; i--) out.push(right[i * 2]!, right[i * 2 + 1]!);
  // Начало: от правого края к левому позади первой точки.
  const start = at(flat, 0);
  const aStart = Math.atan2(normals[0]!.y, normals[0]!.x) + Math.PI;
  for (let s = 1; s < CAP_STEPS; s++) {
    const a = aStart - (s / CAP_STEPS) * Math.PI;
    out.push(start.x + Math.cos(a) * radii[0]!, start.y + Math.sin(a) * radii[0]!);
  }
  return out;
}

/** Наибольший радиус штриха (для габарита). */
export function maxRadius(flat: readonly number[], width: number, usePressure: boolean): number {
  let r = width / 2;
  if (usePressure) for (let i = 2; i < flat.length; i += 3) r = Math.max(r, pointRadius(width, flat[i]!, true));
  return r;
}

export function strokeBounds(flat: readonly number[], width: number, usePressure: boolean): Rect {
  const n = pointCount(flat);
  if (n === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = flat[i * 3]!;
    const y = flat[i * 3 + 1]!;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const r = maxRadius(flat, width, usePressure);
  return { x: x0 - r, y: y0 - r, width: x1 - x0 + 2 * r, height: y1 - y0 + 2 * r };
}

/** Попадание точки в штрих с допуском tol (всё в одних единицах). */
export function hitStroke(flat: readonly number[], width: number, usePressure: boolean, pt: Point, tol: number, closed = false): boolean {
  const n = pointCount(flat);
  if (n === 0) return false;
  if (n === 1) return distance(pt, at(flat, 0)) <= tol + pointRadius(width, flat[2]!, usePressure);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const r = Math.max(pointRadius(width, flat[i * 3 + 2]!, usePressure), pointRadius(width, flat[j * 3 + 2]!, usePressure));
    if (distanceToSegment(pt, at(flat, i), at(flat, j)) <= tol + r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
//  Попиксельный ластик: разрезание штриха кругом
// ---------------------------------------------------------------------

/**
 * Стирание части штриха кругом (center, radius). Возвращает null, если
 * круг штрих не задел, иначе — оставшиеся куски (каждый — плоский массив
 * точек, может быть пустым списком: штрих стёрт целиком). Отрезки рядом с
 * кругом дробятся с шагом radius / 3, чтобы край стирания был ровным;
 * остальная часть штриха не меняется.
 */
export function eraseFromStroke(flat: readonly number[], center: Point, radius: number): number[][] | null {
  const n = pointCount(flat);
  if (n === 0) return null;
  const step = Math.max(radius / 3, 1e-6);
  const dense: number[] = [];
  let touched = false;
  for (let i = 0; i < n; i++) {
    const a = at(flat, i);
    dense.push(a.x, a.y, flat[i * 3 + 2]!);
    if (distance(a, center) < radius) touched = true;
    if (i === n - 1) break;
    const b = at(flat, i + 1);
    const segD = distanceToSegment(center, a, b);
    if (segD < radius) touched = true;
    if (segD < radius + step) {
      const len = distance(a, b);
      const k = Math.ceil(len / step);
      for (let s = 1; s < k; s++) {
        const t = s / k;
        dense.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, flat[i * 3 + 2]! + (flat[i * 3 + 5]! - flat[i * 3 + 2]!) * t);
      }
    }
  }
  if (!touched) return null;
  const pieces: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pointCount(dense); i++) {
    const p = at(dense, i);
    if (distance(p, center) < radius) {
      if (cur.length) pieces.push(cur);
      cur = [];
    } else cur.push(p.x, p.y, dense[i * 3 + 2]!);
  }
  if (cur.length) pieces.push(cur);
  // Одиночные точки на краю стирания — мусор, их не оставляем.
  return pieces.filter((piece) => pointCount(piece) >= 2);
}

// ---------------------------------------------------------------------
//  Распознавание фигур
// ---------------------------------------------------------------------

export type RecognizedShape =
  | { kind: 'line'; a: Point; b: Point }
  /** Прямоугольник: центр, размеры, поворот (рад, по часовой). */
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; angle: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number }
  /** Многоугольник (треугольник, произвольный четырёхугольник). */
  | { kind: 'polygon'; points: Point[] };

function pathLength(pts: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += distance(pts[i - 1]!, pts[i]!);
  return l;
}

function rdp(pts: readonly Point[], eps: number): Point[] {
  if (pts.length <= 2) return [...pts];
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i]!, a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD < eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Вершины замкнутого контура: делим его в самой далёкой от начала точке. */
function closedVertices(pts: readonly Point[], eps: number): Point[] {
  let far = 0;
  let farD = 0;
  pts.forEach((p, i) => {
    const d = distance(p, pts[0]!);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const first = rdp(pts.slice(0, far + 1), eps);
  const second = rdp([...pts.slice(far), pts[0]!], eps);
  const verts = [...first.slice(0, -1), ...second.slice(0, -1)];
  // Почти совпадающие вершины и вершины на прямой (угол ≈ 180°) убираются.
  let changed = true;
  let out = verts;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i - 1 + out.length) % out.length]!;
      const c = out[i]!;
      const nx = out[(i + 1) % out.length]!;
      if (distanceToSegment(c, p, nx) < eps) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function angleAt(p: Point, c: Point, n: Point): number {
  const a1 = Math.atan2(p.y - c.y, p.x - c.x);
  const a2 = Math.atan2(n.y - c.y, n.x - c.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Угол, близкий к 0 / 90°, прижимается к оси (рисунок от руки редко точен). */
function snapAngle(a: number): number {
  const q = Math.PI / 2;
  const k = Math.round(a / q);
  // «+ 0» превращает −0 в 0.
  return (Math.abs(a - k * q) < (8 * Math.PI) / 180 ? k * q : a) + 0;
}

/**
 * Распознавание фигуры по точкам штриха (мировые координаты): отрезок,
 * прямоугольник, эллипс (окружность), треугольник или четырёхугольник.
 * null — штрих не похож ни на одну фигуру (остаётся как нарисован).
 */
export function recognizeShape(pts: readonly Point[], minSize: number): RecognizedShape | null {
  if (pts.length < 3) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < minSize) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const len = pathLength(pts);
  const gap = distance(first, last);

  // Отрезок: все точки близко к прямой «начало — конец».
  if (gap > diag * 0.8) {
    const dev = Math.max(...pts.map((p) => distanceToSegment(p, first, last)));
    if (dev < Math.max(gap * 0.06, minSize * 0.1)) return { kind: 'line', a: first, b: last };
    return null;
  }
  // Замкнутая фигура: конец вернулся к началу, путь заметно длиннее размера.
  if (gap > diag * 0.3 || len < diag * 1.6) return null;

  const ellipse = fitEllipse(pts);
  if (ellipse && ellipse.error < 0.07) return ellipse.shape;

  const verts = closedVertices(pts, diag * 0.08);
  if (verts.length === 3) return { kind: 'polygon', points: verts };
  if (verts.length === 4) {
    const right = verts.every((v, i) => Math.abs(angleAt(verts[(i + 3) % 4]!, v, verts[(i + 1) % 4]!) - Math.PI / 2) < (20 * Math.PI) / 180);
    if (!right) return { kind: 'polygon', points: verts };
    const [a, b, c, d] = verts as [Point, Point, Point, Point];
    const w = (distance(a, b) + distance(c, d)) / 2;
    const h = (distance(b, c) + distance(d, a)) / 2;
    let angle = snapAngle(Math.atan2(b.y - a.y, b.x - a.x));
    let rw = w;
    let rh = h;
    // Приводим угол к (−45°, 45°], меняя стороны местами.
    while (angle > Math.PI / 4) {
      angle -= Math.PI / 2;
      [rw, rh] = [rh, rw];
    }
    while (angle <= -Math.PI / 4) {
      angle += Math.PI / 2;
      [rw, rh] = [rh, rw];
    }
    const cx = (a.x + b.x + c.x + d.x) / 4;
    const cy = (a.y + b.y + c.y + d.y) / 4;
    return { kind: 'rect', cx, cy, w: rw, h: rh, angle: snapAngle(angle) };
  }
  if (ellipse && ellipse.error < 0.16) return ellipse.shape;
  return null;
}

/** Эллипс по главным осям точек; error — среднее отклонение от контура (доля радиуса). */
function fitEllipse(pts: readonly Point[]): { shape: RecognizedShape & { kind: 'ellipse' }; error: number } | null {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  const uv = pts.map((p) => {
    const dx = p.x - mx;
    const dy = p.y - my;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
    return { u, v };
  });
  let rx = (u1 - u0) / 2;
  let ry = (v1 - v0) / 2;
  if (rx < 1e-6 || ry < 1e-6) return null;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  let error = 0;
  for (const { u, v } of uv) error += Math.abs(Math.hypot((u - cu) / rx, (v - cv) / ry) - 1);
  error /= n;
  const cx = mx + cu * cos - cv * sin;
  const cy = my + cu * sin + cv * cos;
  // Почти круг — окружность без поворота; почти по осям — без поворота.
  if (Math.min(rx, ry) / Math.max(rx, ry) > 0.85) {
    rx = ry = (rx + ry) / 2;
    angle = 0;
  } else {
    angle = snapAngle(angle);
    while (angle > Math.PI / 4) {
      angle -= Math.PI / 2;
      [rx, ry] = [ry, rx];
    }
    while (angle <= -Math.PI / 4) {
      angle += Math.PI / 2;
      [rx, ry] = [ry, rx];
    }
  }
  return { shape: { kind: 'ellipse', cx, cy, rx, ry, angle }, error };
}

/** Предел точек недорисованного штриха в присутствии (размер состояния awareness — до 64 КБ). */
export const PRESENCE_MAX_POINTS = 1500;

/**
 * Штрих для трансляции другим во время рисования: координаты округлены до
 * десятых, длинный штрих равномерно прорежен (последняя точка сохраняется).
 */
export function compactForPresence(flat: readonly number[]): number[] {
  const n = pointCount(flat);
  const step = Math.max(1, Math.ceil(n / PRESENCE_MAX_POINTS));
  const out: number[] = [];
  const push = (i: number) => out.push(Math.round(flat[i * 3]! * 10) / 10, Math.round(flat[i * 3 + 1]! * 10) / 10, Math.round(flat[i * 3 + 2]! * 100) / 100);
  for (let i = 0; i < n; i += step) push(i);
  if (n > 1 && (n - 1) % step !== 0) push(n - 1);
  return out.slice(0, PRESENCE_MAX_POINTS * 3);
}
