import { dot, isPolyhedron, keyPoints, labelsOf, norm, polyhedron, roundDims, sub, type Body, type V3 } from './solids';

/**
 * Развёртки (этап 6.4b) в единицах сцены, ось y вниз (как на доске).
 * Многогранник разворачивается вокруг нижнего основания: боковые грани
 * прикладываются к его рёбрам, верхнее основание — к первой боковой грани
 * (у куба получается «крест»). Наклонные тела разворачиваются так же —
 * длины рёбер и углы граней сохраняются.
 */

export type P2 = [number, number];

export interface Net {
  /** Грани-многоугольники; names — подписи вершин (повторяются у разных граней). */
  polys: { pts: P2[]; names: string[] }[];
  circles: { c: P2; r: number; name: string }[];
  /** Сектор или кольцевой сектор (конус, усечённый конус): центр, радиусы, углы. */
  sectors: { c: P2; r1: number; r2: number; a0: number; a1: number; name: string }[];
}

const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/**
 * Вершины грани в развёртке, если её ребро (ia, ib) уже лежит в точках
 * pa, pb, а грань откладывается в сторону от точки away.
 */
function unfoldFace(verts: V3[], face: number[], ia: number, ib: number, pa: P2, pb: P2, away: P2): Map<number, P2> {
  const out = new Map<number, P2>([
    [ia, pa],
    [ib, pb],
  ]);
  const e3 = norm(sub(verts[ib]!, verts[ia]!));
  const ex = pb[0] - pa[0];
  const ey = pb[1] - pa[1];
  const el = Math.hypot(ex, ey) || 1;
  const u: P2 = [ex / el, ey / el];
  let n: P2 = [-u[1], u[0]];
  // Нормаль — от уже разложенной грани.
  if ((away[0] - pa[0]) * n[0] + (away[1] - pa[1]) * n[1] > 0) n = [-n[0], -n[1]];
  for (const k of face) {
    if (out.has(k)) continue;
    const w = sub(verts[k]!, verts[ia]!);
    const along = dot(w, e3);
    const perp = len(sub(w, [e3[0] * along, e3[1] * along, e3[2] * along]));
    out.set(k, [pa[0] + u[0] * along + n[0] * perp, pa[1] + u[1] * along + n[1] * perp]);
  }
  return out;
}

const centroid = (pts: P2[]): P2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

export function netOf(b: Body): Net | null {
  if (b.kind === 'sphere') return null;
  if (isPolyhedron(b.kind)) {
    const ph = polyhedron(b);
    const names = labelsOf(b, ph.names);
    const nb = ph.faces[0]!.length;
    // Нижнее основание: вид сверху, ближнее ребро AB — внизу.
    const base = new Map<number, P2>();
    for (let i = 0; i < nb; i++) base.set(i, [ph.verts[i]![0], -ph.verts[i]![1]]);
    const baseC = centroid([...base.values()]);
    const polys: Net['polys'] = [];
    const place = (face: number[], m: Map<number, P2>) => polys.push({ pts: face.map((k) => m.get(k)!), names: face.map((k) => names[k] ?? '') });
    place(ph.faces[0]!, base);
    const pyramid = b.kind === 'pyramid';
    const lateral = ph.faces.slice(pyramid ? 1 : 2);
    let first: Map<number, P2> | null = null;
    lateral.forEach((face, i) => {
      const m = unfoldFace(ph.verts, face, i, (i + 1) % nb, base.get(i)!, base.get((i + 1) % nb)!, baseC);
      if (i === 0) first = m;
      place(face, m);
    });
    if (!pyramid && first) {
      // Верхнее основание — к верхнему ребру первой боковой грани (A₁B₁).
      const f0 = first as Map<number, P2>;
      const away = centroid([...f0.values()]);
      const m = unfoldFace(ph.verts, ph.faces[1]!, nb, nb + 1, f0.get(nb)!, f0.get(nb + 1)!, away);
      place(ph.faces[1]!, m);
    }
    return { polys, circles: [], sectors: [] };
  }
  const { r1, r2, h } = roundDims(b);
  // Характерные точки: у конуса [S, O], у цилиндра и усечённого конуса [O, O₁].
  const kp = keyPoints(b);
  const O = (b.kind === 'cone' ? kp[1]?.name : kp[0]?.name) ?? 'O';
  const O1 = b.kind === 'cone' ? '' : (kp[1]?.name ?? 'O₁');
  if (b.kind === 'cylinder' || Math.abs(r1 - r2) < 1e-9) {
    const w = 2 * Math.PI * r1;
    return {
      polys: [
        {
          pts: [
            [-w / 2, -h / 2],
            [w / 2, -h / 2],
            [w / 2, h / 2],
            [-w / 2, h / 2],
          ],
          names: ['', '', '', ''],
        },
      ],
      circles: [
        { c: [0, -h / 2 - r2], r: r2, name: O1 },
        { c: [0, h / 2 + r1], r: r1, name: O },
      ],
      sectors: [],
    };
  }
  // Конус и усечённый конус: (кольцевой) сектор с центром в вершине полного конуса.
  const big = Math.max(r1, r2);
  const small = Math.min(r1, r2);
  const s = Math.hypot(big - small, h);
  const L = (big * s) / (big - small);
  const theta = (2 * Math.PI * big) / L;
  const a0 = Math.PI / 2 - theta / 2;
  const a1 = Math.PI / 2 + theta / 2;
  const net: Net = {
    polys: [],
    circles: [{ c: [0, L + big], r: big, name: r1 >= r2 ? O : O1 }],
    sectors: [{ c: [0, 0], r1: L - s, r2: L, a0, a1, name: b.kind === 'cone' ? (kp[0]?.name ?? 'S') : '' }],
  };
  if (small > 1e-9) net.circles.push({ c: [0, L - s - small], r: small, name: r1 >= r2 ? O1 : O });
  return net;
}

/** Габарит развёртки. */
export function netBounds(n: Net): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of n.polys)
    for (const q of p.pts) {
      xs.push(q[0]);
      ys.push(q[1]);
    }
  for (const c of n.circles) (xs.push(c.c[0] - c.r, c.c[0] + c.r), ys.push(c.c[1] - c.r, c.c[1] + c.r));
  for (const s of n.sectors) {
    // Дуги: концы и крайние точки внутри углового промежутка.
    const angles = [s.a0, s.a1, ...[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI].filter((a) => a > s.a0 && a < s.a1)];
    for (const r of [s.r1, s.r2]) for (const a of angles) (xs.push(s.c[0] + r * Math.cos(a)), ys.push(s.c[1] + r * Math.sin(a)));
    xs.push(s.c[0]);
    ys.push(s.c[1]);
  }
  if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Площадь полной поверхности по развёртке (для проверки и подписи). */
export function netArea(n: Net): number {
  let s = 0;
  for (const p of n.polys) s += Math.abs(p.pts.reduce((acc, q, i) => acc + q[0] * p.pts[(i + 1) % p.pts.length]![1] - p.pts[(i + 1) % p.pts.length]![0] * q[1], 0)) / 2;
  for (const c of n.circles) s += Math.PI * c.r * c.r;
  for (const sec of n.sectors) s += ((sec.a1 - sec.a0) / 2) * (sec.r2 * sec.r2 - sec.r1 * sec.r1);
  return s;
}
