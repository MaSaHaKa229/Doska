import { z } from 'zod';
import { add, bodyPoints, convexPolyhedron, cross, dot, isPolyhedron, keyPoints, mul, norm, polyhedron, projection, sceneCenter, sub, type Body, type ExtraLayer, type V3, type View } from './solids';

/**
 * Построения в пространстве (этап 6.4b): точки на вершинах, рёбрах и гранях
 * тел или по координатам; отрезки, прямые, плоскости и сечения через
 * точки; расстояния и углы. Хранятся в props сцены рядом с телами и
 * пересчитываются из них: правка тела двигает и построения.
 */

const id = z.string().min(1).max(16);
const coord = z.number().finite().min(-1e4).max(1e4);
const color = z.string().max(32);

export const pointRefSchema = z.discriminatedUnion('k', [
  /** Характерная точка тела: вершина многогранника, центр основания, вершина конуса, центр шара. */
  z.object({ k: z.literal('vertex'), body: id, i: z.number().int().min(0).max(63) }),
  /** Точка на ребре i–j: P = Vi + t·(Vj − Vi). */
  z.object({ k: z.literal('edge'), body: id, i: z.number().int().min(0).max(63), j: z.number().int().min(0).max(63), t: z.number().finite().min(0).max(1) }),
  /** Точка на грани f в её аффинных координатах: P = V0 + u·(V1 − V0) + v·(Vn−1 − V0). */
  z.object({ k: z.literal('face'), body: id, f: z.number().int().min(0).max(63), u: coord, v: coord }),
  z.object({ k: z.literal('coord'), p: z.tuple([coord, coord, coord]) }),
]);
export type PointRef = z.infer<typeof pointRefSchema>;

export const spacePointSchema = z.object({ id, name: z.string().max(8), at: pointRefSchema, color });
export type SpacePoint = z.infer<typeof spacePointSchema>;

const fillOpacity = z.number().finite().min(0).max(1);
export const itemSchema = z.discriminatedUnion('k', [
  z.object({ id, k: z.literal('segment'), a: id, b: id, color }),
  z.object({ id, k: z.literal('line'), a: id, b: id, color }),
  z.object({ id, k: z.literal('plane'), a: id, b: id, c: id, color, opacity: fillOpacity }),
  /** Сечение тела body плоскостью через три точки. */
  z.object({ id, k: z.literal('section'), body: id, a: id, b: id, c: id, color, opacity: fillOpacity }),
  /** Расстояние и угол между точками, прямыми (отрезки и прямые) и плоскостями (плоскости и сечения). */
  z.object({ id, k: z.literal('dist'), x: id, y: id, color }),
  z.object({ id, k: z.literal('angle'), x: id, y: id, color }),
]);
export type Item = z.infer<typeof itemSchema>;
export type ItemKind = Item['k'];

export const MAX_POINTS = 64;
export const MAX_ITEMS = 64;

export const ITEM_TITLES: Record<ItemKind, string> = { segment: 'Отрезок', line: 'Прямая', plane: 'Плоскость', section: 'Сечение', dist: 'Расстояние', angle: 'Угол' };

export interface Space {
  bodies: Body[];
  points: SpacePoint[];
  items: Item[];
}

// =====================================================================
//  Положение точек
// =====================================================================

/** Аффинная система грани: начало и две стороны из первой вершины. */
export function faceFrame(b: Body, f: number): { o: V3; eu: V3; ev: V3; n: V3 } | null {
  if (!isPolyhedron(b.kind)) return null;
  const ph = polyhedron(b);
  const face = ph.faces[f];
  if (!face) return null;
  const o = ph.verts[face[0]!]!;
  const eu = sub(ph.verts[face[1]!]!, o);
  const ev = sub(ph.verts[face[face.length - 1]!]!, o);
  return { o, eu, ev, n: norm(cross(eu, ev)) };
}

/** Аффинные координаты точки плоскости грани. */
export function faceUV(fr: { o: V3; eu: V3; ev: V3 }, p: V3): { u: number; v: number } {
  const q = sub(p, fr.o);
  const a = dot(fr.eu, fr.eu);
  const b = dot(fr.eu, fr.ev);
  const c = dot(fr.ev, fr.ev);
  const d1 = dot(q, fr.eu);
  const d2 = dot(q, fr.ev);
  const det = a * c - b * b || 1;
  return { u: (d1 * c - d2 * b) / det, v: (a * d2 - b * d1) / det };
}

export function refPosition(ref: PointRef, bodies: readonly Body[]): V3 | null {
  if (ref.k === 'coord') return ref.p as V3;
  const b = bodies.find((x) => x.id === ref.body);
  if (!b) return null;
  if (ref.k === 'vertex') return keyPoints(b)[ref.i]?.p ?? null;
  if (ref.k === 'edge') {
    if (!isPolyhedron(b.kind)) return null;
    const v = polyhedron(b).verts;
    const a = v[ref.i];
    const c = v[ref.j];
    return a && c ? add(a, mul(sub(c, a), ref.t)) : null;
  }
  const fr = faceFrame(b, ref.f);
  return fr ? add(fr.o, add(mul(fr.eu, ref.u), mul(fr.ev, ref.v))) : null;
}

/** Положения всех точек (null — опора удалена: тело, вершина или грань). */
export function pointPositions(s: Space): Map<string, V3 | null> {
  return new Map(s.points.map((p) => [p.id, refPosition(p.at, s.bodies)]));
}

/** Тело, на поверхности которого лежит точка (для сечения). */
export const bodyOfRef = (ref: PointRef): string | null => (ref.k === 'coord' ? null : ref.body);

// =====================================================================
//  Прямые и плоскости
// =====================================================================

export type Elem = { kind: 'point'; p: V3; name: string } | { kind: 'line'; p: V3; u: V3; a: V3; b: V3; name: string; seg: boolean } | { kind: 'plane'; p: V3; n: V3; name: string };

const EPS = 1e-9;
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Плоскость через три точки (null — точки на одной прямой). */
export function planeOf(a: V3, b: V3, c: V3): { p: V3; n: V3 } | null {
  const n = cross(sub(b, a), sub(c, a));
  const l = len(n);
  const scale = Math.max(len(sub(b, a)), len(sub(c, a)), 1e-12);
  if (l < 1e-9 * scale * scale) return null;
  return { p: a, n: mul(n, 1 / l) };
}

/** Имя построения для подписей: «A», «AB», «(ABC)». */
function itemName(it: Item, names: Map<string, string>): string {
  const n = (k: string) => names.get(k) ?? '?';
  if (it.k === 'segment' || it.k === 'line') return n(it.a) + n(it.b);
  if (it.k === 'plane' || it.k === 'section') return `(${n(it.a)}${n(it.b)}${n(it.c)})`;
  return '';
}

/** Элемент (точка, прямая, плоскость) по id точки или построения. */
export function elemOf(s: Space, ref: string, pos = pointPositions(s)): Elem | null {
  const names = new Map(s.points.map((p) => [p.id, p.name]));
  const pt = s.points.find((p) => p.id === ref);
  if (pt) {
    const p = pos.get(pt.id);
    return p ? { kind: 'point', p, name: pt.name || '?' } : null;
  }
  const it = s.items.find((i) => i.id === ref);
  if (!it) return null;
  if (it.k === 'segment' || it.k === 'line') {
    const a = pos.get(it.a);
    const b = pos.get(it.b);
    if (!a || !b || len(sub(b, a)) < EPS) return null;
    return { kind: 'line', p: a, u: norm(sub(b, a)), a, b, name: itemName(it, names), seg: it.k === 'segment' };
  }
  if (it.k === 'plane' || it.k === 'section') {
    const [a, b, c] = [pos.get(it.a), pos.get(it.b), pos.get(it.c)];
    const pl = a && b && c ? planeOf(a, b, c) : null;
    return pl ? { kind: 'plane', ...pl, name: itemName(it, names) } : null;
  }
  return null;
}

// =====================================================================
//  Сечение
// =====================================================================

/** Многоугольник сечения выпуклого тела плоскостью (вершины по кругу) или null. */
export function sectionPolygon(b: Body, pl: { p: V3; n: V3 }): V3[] | null {
  if (b.kind === 'sphere') {
    const c = b.pos as V3;
    const d = dot(sub(c, pl.p), pl.n);
    if (Math.abs(d) >= b.r) return null;
    const r = Math.sqrt(b.r * b.r - d * d);
    const o = sub(c, mul(pl.n, d));
    const u = basisU(pl.n);
    const w = cross(pl.n, u);
    return Array.from({ length: 96 }, (_, i) => {
      const t = (i / 96) * 2 * Math.PI;
      return add(o, add(mul(u, r * Math.cos(t)), mul(w, r * Math.sin(t))));
    });
  }
  const ph = convexPolyhedron(b);
  const size = Math.max(...bodyPoints(b).map((q) => len(sub(q, ph.verts[0]!))), 1);
  const tol = size * 1e-9;
  const dist = ph.verts.map((v) => dot(sub(v, pl.p), pl.n));
  const pts: V3[] = [];
  const push = (q: V3) => {
    if (!pts.some((x) => len(sub(x, q)) < size * 1e-7)) pts.push(q);
  };
  dist.forEach((d, i) => Math.abs(d) <= tol && push(ph.verts[i]!));
  for (const [i, j] of ph.edges) {
    const di = dist[i]!;
    const dj = dist[j]!;
    if ((di > tol && dj < -tol) || (di < -tol && dj > tol)) {
      const t = di / (di - dj);
      push(add(ph.verts[i]!, mul(sub(ph.verts[j]!, ph.verts[i]!), t)));
    }
  }
  if (pts.length < 3) return null;
  const c = mul(
    pts.reduce((s, q) => add(s, q), [0, 0, 0] as V3),
    1 / pts.length,
  );
  const u = basisU(pl.n);
  const w = cross(pl.n, u);
  const ang = (q: V3) => Math.atan2(dot(sub(q, c), w), dot(sub(q, c), u));
  return pts.sort((a, b2) => ang(a) - ang(b2));
}

/** Единичный вектор, перпендикулярный n. */
function basisU(n: V3): V3 {
  const t: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, t));
}

// =====================================================================
//  Расстояния и углы
// =====================================================================

export interface Measure {
  /** Значение: длина или угол в радианах. */
  value: number;
  /** Отрезок, по которому измерено расстояние (общий перпендикуляр); у угла — место подписи. */
  from: V3;
  to: V3;
  text: string;
}

const footOnLine = (q: V3, l: { p: V3; u: V3 }): V3 => add(l.p, mul(l.u, dot(sub(q, l.p), l.u)));
const footOnPlane = (q: V3, pl: { p: V3; n: V3 }): V3 => sub(q, mul(pl.n, dot(sub(q, pl.p), pl.n)));

/** Число по-русски: «2,83». */
export function fmt(v: number, digits = 2): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(Object.is(r, -0) ? 0 : r)
    .replace('.', ',')
    .replace('-', '−');
}

/**
 * Длина в «школьном» виде, если её квадрат — дробь с небольшим знаменателем:
 * 2√2, √3/2, 3. Иначе — приближённо.
 */
export function surd(v: number): string {
  if (v < 1e-9) return '0';
  const sq = v * v;
  for (let q = 1; q <= 12; q++) {
    const n = Math.round(sq * q * q);
    if (n === 0 || Math.abs(sq * q * q - n) > 1e-6 * Math.max(1, n)) continue;
    // v = √n / q, √n = a√b.
    let a = 1;
    let b = n;
    for (let k = 2; k * k <= b; k++)
      while (b % (k * k) === 0) {
        b /= k * k;
        a *= k;
      }
    const g = gcd(a, q);
    a /= g;
    const den = q / g;
    const root = b === 1 ? String(a) : `${a === 1 ? '' : a}√${b}`;
    const exact = den === 1 ? root : `${root}/${den}`;
    return b === 1 && den === 1 ? exact : `${exact} ≈ ${fmt(v)}`;
  }
  return `≈ ${fmt(v)}`;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

const degText = (rad: number) => {
  const d = (rad * 180) / Math.PI;
  return Math.abs(d - Math.round(d)) < 1e-6 ? `${Math.round(d)}°` : `≈ ${fmt(d, 1)}°`;
};
const eq = (t: string) => (t.startsWith('≈') ? t : `= ${t}`);

/** Расстояние между двумя элементами; null — не определено. */
export function distance(x: Elem, y: Elem): Measure | null {
  if (y.kind === 'point' && x.kind !== 'point') [x, y] = [y, x];
  if (x.kind === 'plane' && y.kind === 'line') [x, y] = [y, x];
  let from: V3;
  let to: V3;
  if (x.kind === 'point' && y.kind === 'point') [from, to] = [x.p, y.p];
  else if (x.kind === 'point' && y.kind === 'line') [from, to] = [x.p, footOnLine(x.p, y)];
  else if (x.kind === 'point' && y.kind === 'plane') [from, to] = [x.p, footOnPlane(x.p, y)];
  else if (x.kind === 'line' && y.kind === 'line') {
    const w = cross(x.u, y.u);
    if (len(w) < 1e-9) [from, to] = [x.p, footOnLine(x.p, y)];
    else {
      // Общий перпендикуляр скрещивающихся (или пересекающихся) прямых.
      const r = sub(y.p, x.p);
      const ww = dot(w, w);
      const s = dot(cross(r, y.u), w) / ww;
      const t = dot(cross(r, x.u), w) / ww;
      [from, to] = [add(x.p, mul(x.u, s)), add(y.p, mul(y.u, t))];
    }
  } else if (x.kind === 'line' && y.kind === 'plane') {
    if (Math.abs(dot(x.u, y.n)) > 1e-9) {
      const t = dot(sub(y.p, x.p), y.n) / dot(x.u, y.n);
      from = to = add(x.p, mul(x.u, t));
    } else [from, to] = [x.p, footOnPlane(x.p, y)];
  } else if (x.kind === 'plane' && y.kind === 'plane') {
    if (len(cross(x.n, y.n)) > 1e-9) return { value: 0, from: x.p, to: x.p, text: `ρ(${x.name}, ${y.name}) = 0` };
    [from, to] = [x.p, footOnPlane(x.p, y)];
  } else return null;
  const value = len(sub(to, from));
  return { value, from, to, text: `ρ(${x.name}, ${y.name}) ${eq(surd(value))}` };
}

/** Угол между прямыми и плоскостями (в радианах, от 0 до 90°); с точкой — null. */
export function angle(x: Elem, y: Elem): Measure | null {
  if (x.kind === 'point' || y.kind === 'point') return null;
  let value: number;
  if (x.kind === 'line' && y.kind === 'line') value = Math.acos(Math.min(1, Math.abs(dot(x.u, y.u))));
  else if (x.kind === 'plane' && y.kind === 'plane') value = Math.acos(Math.min(1, Math.abs(dot(x.n, y.n))));
  else {
    const l = (x.kind === 'line' ? x : y) as Extract<Elem, { kind: 'line' }>;
    const pl = (x.kind === 'plane' ? x : y) as Extract<Elem, { kind: 'plane' }>;
    value = Math.asin(Math.min(1, Math.abs(dot(l.u, pl.n))));
  }
  // Подпись — у общей точки или посередине между элементами.
  const d = distance(x, y);
  const at = d ? mul(add(d.from, d.to), 0.5) : x.p;
  return { value, from: at, to: at, text: `∠(${x.name}, ${y.name}) ${eq(degText(value))}` };
}

export function measureOf(s: Space, it: Extract<Item, { k: 'dist' | 'angle' }>, pos = pointPositions(s)): Measure | null {
  const x = elemOf(s, it.x, pos);
  const y = elemOf(s, it.y, pos);
  if (!x || !y) return null;
  return it.k === 'dist' ? distance(x, y) : angle(x, y);
}

// =====================================================================
//  Слой чертежа
// =====================================================================

/** Полуразмер сцены — для продолжения прямых и плоскостей. */
function sceneRadius(s: Space, pos: Map<string, V3 | null>): { c: V3; r: number } {
  const pts = [...s.bodies.flatMap(bodyPoints), ...[...pos.values()].filter((p): p is V3 => !!p)];
  const c = pts.length ? sceneCenter(s.bodies) : ([0, 0, 0] as V3);
  const r = Math.max(1, ...pts.map((p) => len(sub(p, c))));
  return { c, r };
}

/** Построения в виде слоя чертежа (линии, заливки, точки, значения). */
export function spaceLayer(s: Space): ExtraLayer {
  const pos = pointPositions(s);
  const out: ExtraLayer = { lines: [], fills: [], points: [], values: [] };
  const { c, r } = sceneRadius(s, pos);
  for (const it of s.items) {
    if (it.k === 'segment') {
      const a = pos.get(it.a);
      const b = pos.get(it.b);
      if (a && b) out.lines.push({ pts: [a, b], color: it.color });
    } else if (it.k === 'line') {
      const e = elemOf(s, it.id, pos);
      if (e?.kind !== 'line') continue;
      const tc = dot(sub(c, e.p), e.u);
      out.lines.push({ pts: [add(e.p, mul(e.u, tc - r * 1.2)), add(e.p, mul(e.u, tc + r * 1.2))], color: it.color });
    } else if (it.k === 'plane') {
      const quad = planePatch(it, pos);
      if (!quad) continue;
      out.fills.push({ pts: quad, color: it.color, opacity: it.opacity });
      out.lines.push({ pts: [...quad, quad[0]!], color: it.color });
    } else if (it.k === 'section') {
      const poly = sectionOf(s, it, pos);
      if (!poly) continue;
      const b = s.bodies.find((x) => x.id === it.body)!;
      out.fills.push({ pts: poly, color: it.color, opacity: it.opacity });
      // Хорды сечения тела вращения — чуть внутри поверхности: допуск видимости.
      out.lines.push({ pts: [...poly, poly[0]!], color: it.color, tol: isPolyhedron(b.kind) || b.kind === 'sphere' ? 0 : Math.max(b.r, b.r2) * 0.02 });
    } else {
      const m = measureOf(s, it, pos);
      if (!m) continue;
      if (it.k === 'dist' && m.value > 1e-9) out.lines.push({ pts: [m.from, m.to], color: it.color, accent: true });
      out.values.push({ p: mul(add(m.from, m.to), 0.5), text: m.text, color: it.color });
    }
  }
  for (const p of s.points) {
    const q = pos.get(p.id);
    if (!q) continue;
    // Вершина с подписью тела уже подписана: вторую подпись и точку не рисуем.
    if (p.at.k === 'vertex') {
      const vb = p.at.body;
      const b = s.bodies.find((x) => x.id === vb);
      if (b?.showLabels && keyPoints(b)[p.at.i]?.name === p.name) continue;
    }
    out.points.push({ p: q, name: p.name, color: p.color });
  }
  return out;
}

/** Параллелограмм плоскости вокруг трёх её точек (с запасом). */
export function planePatch(it: Extract<Item, { k: 'plane' }>, pos: Map<string, V3 | null>): V3[] | null {
  const [a, b, c] = [pos.get(it.a), pos.get(it.b), pos.get(it.c)];
  const pl = a && b && c ? planeOf(a, b, c) : null;
  if (!a || !b || !c || !pl) return null;
  const u = norm(sub(b, a));
  const w = cross(pl.n, u);
  const uv = [a, b, c].map((p) => [dot(sub(p, a), u), dot(sub(p, a), w)] as const);
  const [u0, u1] = [Math.min(...uv.map((q) => q[0])), Math.max(...uv.map((q) => q[0]))];
  const [w0, w1] = [Math.min(...uv.map((q) => q[1])), Math.max(...uv.map((q) => q[1]))];
  const m = Math.max(u1 - u0, w1 - w0) * 0.3;
  const at = (x: number, y: number) => add(a, add(mul(u, x), mul(w, y)));
  return [at(u0 - m, w0 - m), at(u1 + m, w0 - m), at(u1 + m, w1 + m), at(u0 - m, w1 + m)];
}

export function sectionOf(s: Space, it: Extract<Item, { k: 'section' }>, pos = pointPositions(s)): V3[] | null {
  const b = s.bodies.find((x) => x.id === it.body);
  const [a, bb, c] = [pos.get(it.a), pos.get(it.b), pos.get(it.c)];
  const pl = a && bb && c ? planeOf(a, bb, c) : null;
  return b && pl ? sectionPolygon(b, pl) : null;
}

// =====================================================================
//  Правка
// =====================================================================

const POINT_NAMES = ['K', 'L', 'M', 'N', 'P', 'Q', 'R', 'T', 'E', 'F'];

/** Свободное имя новой точки: K, L, M…, затем K₁… (не совпадает с вершинами тел). */
export function nextPointName(s: Space): string {
  const used = new Set([...s.points.map((p) => p.name), ...s.bodies.flatMap((b) => keyPoints(b).map((k) => k.name))]);
  for (const sub of ['', '₁', '₂', '₃', '₄', '₅', '₆']) for (const n of POINT_NAMES) if (!used.has(n + sub)) return n + sub;
  return '';
}

export function nextId(prefix: string, taken: readonly { id: string }[]): string {
  let i = 1;
  while (taken.some((x) => x.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** Одинаковые опоры (та же вершина; точка ребра с тем же t…) — та же точка. */
export function sameRef(a: PointRef, b: PointRef): boolean {
  if (a.k === 'vertex' && b.k === 'vertex') return a.body === b.body && a.i === b.i;
  if (a.k === 'edge' && b.k === 'edge') return a.body === b.body && ((a.i === b.i && a.j === b.j && Math.abs(a.t - b.t) < 1e-6) || (a.i === b.j && a.j === b.i && Math.abs(a.t + b.t - 1) < 1e-6));
  return false;
}

/** Удалить точки или построения вместе со всем, что на них опирается. */
export function removeWithDependents(s: Space, ids: readonly string[]): Pick<Space, 'points' | 'items'> {
  const gone = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of s.items) {
      if (gone.has(it.id)) continue;
      const refs = it.k === 'dist' || it.k === 'angle' ? [it.x, it.y] : it.k === 'plane' || it.k === 'section' ? [it.a, it.b, it.c] : [it.a, it.b];
      if (refs.some((r) => gone.has(r)) || (it.k === 'section' && gone.has(it.body))) {
        gone.add(it.id);
        changed = true;
      }
    }
  }
  return { points: s.points.filter((p) => !gone.has(p.id)), items: s.items.filter((i) => !gone.has(i.id)) };
}

/** Удалить тело: его точки и построения на них уходят тоже. */
export function removeBody(s: Space, bodyId: string): Space {
  const pts = s.points.filter((p) => bodyOfRef(p.at) === bodyId).map((p) => p.id);
  const rest = removeWithDependents(s, [...pts, bodyId]);
  return { bodies: s.bodies.filter((b) => b.id !== bodyId), ...rest };
}

/** Описание опоры точки для списка: «вершина», «на ребре AB, AK : KB = 1 : 2». */
export function refText(p: SpacePoint, bodies: readonly Body[]): string {
  const at = p.at;
  if (at.k === 'coord') return `(${at.p.map((v) => fmt(v)).join('; ')})`;
  const b = bodies.find((x) => x.id === at.body);
  if (!b) return 'опора удалена';
  const kp = keyPoints(b);
  if (at.k === 'vertex') return `вершина ${kp[at.i]?.name ?? '?'}`;
  if (at.k === 'edge') return `на ребре ${kp[at.i]?.name ?? '?'}${kp[at.j]?.name ?? '?'}`;
  return `на грани ${
    polyhedron(b)
      .faces[at.f]?.map((k) => kp[k]?.name ?? '')
      .join('') ?? '?'
  }`;
}

// =====================================================================
//  Выбор щелчком в 3D-редакторе
// =====================================================================

export type SpacePick = { kind: 'point'; id: string } | { kind: 'item'; id: string } | { kind: 'ref'; ref: PointRef; p: V3 };

const segDist = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  return { d: Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy), t };
};

const inPoly = (q: { x: number; y: number }, poly: { x: number; y: number }[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * Что под курсором (x, y — координаты чертежа с центром сцены в 0):
 * точка построения, построение (если нужны прямые и плоскости), вершина,
 * точка ребра или видимой грани.
 */
export function pickAt(s: Space, view: View, x: number, y: number, opts: { items: boolean; tol?: number }): SpacePick | null {
  const tol = opts.tol ?? 8;
  const proj = projection(view, sceneCenter(s.bodies));
  const q = { x, y };
  const pos = pointPositions(s);
  let best: { d: number; pick: SpacePick } | null = null;
  const offer = (d: number, pick: SpacePick) => {
    if (d <= tol && (!best || d < best.d)) best = { d, pick };
  };
  for (const p of s.points) {
    const v = pos.get(p.id);
    if (v) {
      const sp = proj.project(v);
      offer(Math.hypot(sp.x - x, sp.y - y) - 3, { kind: 'point', id: p.id });
    }
  }
  if (best) return (best as { pick: SpacePick }).pick;
  for (const b of s.bodies)
    keyPoints(b).forEach((k, i) => {
      const sp = proj.project(k.p);
      offer(Math.hypot(sp.x - x, sp.y - y) - 2, { kind: 'ref', ref: { k: 'vertex', body: b.id, i }, p: k.p });
    });
  if (best) return (best as { pick: SpacePick }).pick;
  if (opts.items) {
    for (const it of s.items) {
      if (it.k === 'segment' || it.k === 'line') {
        const e = elemOf(s, it.id, pos);
        if (e?.kind !== 'line') continue;
        const a = proj.project(it.k === 'segment' ? e.a : add(e.p, mul(e.u, -1e3)));
        const b = proj.project(it.k === 'segment' ? e.b : add(e.p, mul(e.u, 1e3)));
        offer(segDist(q, a, b).d, { kind: 'item', id: it.id });
      }
    }
    if (best) return (best as { pick: SpacePick }).pick;
    for (const it of s.items) {
      const poly = it.k === 'plane' ? planePatch(it, pos) : it.k === 'section' ? sectionOf(s, it, pos) : null;
      if (
        poly &&
        inPoly(
          q,
          poly.map((p) => proj.project(p)),
        )
      )
        return { kind: 'item', id: it.id };
    }
  }
  // Рёбра многогранников.
  for (const b of s.bodies) {
    if (!isPolyhedron(b.kind)) continue;
    const ph = polyhedron(b);
    for (const [i, j] of ph.edges) {
      const a = ph.verts[i]!;
      const c = ph.verts[j]!;
      const { d, t } = segDist(q, proj.project(a), proj.project(c));
      // Доли ребра округляются до сотых: «середина» — ровно 0,5.
      const tt = Math.round(t * 100) / 100;
      offer(d, { kind: 'ref', ref: { k: 'edge', body: b.id, i, j, t: tt }, p: add(a, mul(sub(c, a), tt)) });
    }
  }
  if (best) return (best as { pick: SpacePick }).pick;
  // Видимые грани: ближайшая к зрителю под курсором.
  const base = add(proj.center, add(mul(proj.e1, x / proj.scale), mul(proj.e2, -y / proj.scale)));
  let face: { depth: number; pick: SpacePick } | null = null;
  for (const b of s.bodies) {
    if (!isPolyhedron(b.kind)) continue;
    const ph = polyhedron(b);
    ph.faces.forEach((f, fi) => {
      const fr = faceFrame(b, fi)!;
      const c = mul(
        ph.verts.reduce((acc, v) => add(acc, v), [0, 0, 0] as V3),
        1 / ph.verts.length,
      );
      const n = dot(fr.n, sub(c, fr.o)) > 0 ? mul(fr.n, -1) : fr.n;
      if (dot(n, proj.d) <= 1e-9) return;
      if (
        !inPoly(
          q,
          f.map((k) => proj.project(ph.verts[k]!)),
        )
      )
        return;
      const sDepth = dot(sub(fr.o, base), n) / dot(proj.d, n);
      const p = add(base, mul(proj.d, sDepth));
      const { u, v } = faceUV(fr, p);
      if (!face || sDepth > face.depth) face = { depth: sDepth, pick: { kind: 'ref', ref: { k: 'face', body: b.id, f: fi, u, v }, p } };
    });
  }
  return face ? (face as { pick: SpacePick }).pick : null;
}
