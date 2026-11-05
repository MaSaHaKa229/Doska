import { describe, expect, it } from 'vitest';
import { netArea, netBounds, netOf } from './net';
import { newBody, polyhedron, type Body } from './solids';

/** Площадь поверхности многогранника по граням в пространстве. */
function surface(b: Body): number {
  const ph = polyhedron(b);
  let s = 0;
  for (const f of ph.faces) {
    const o = ph.verts[f[0]!]!;
    const acc: [number, number, number] = [0, 0, 0];
    for (let i = 1; i + 1 < f.length; i++) {
      const a = ph.verts[f[i]!]!.map((v, k) => v - o[k]!);
      const c = ph.verts[f[i + 1]!]!.map((v, k) => v - o[k]!);
      acc[0] += a[1]! * c[2]! - a[2]! * c[1]!;
      acc[1] += a[2]! * c[0]! - a[0]! * c[2]!;
      acc[2] += a[0]! * c[1]! - a[1]! * c[0]!;
    }
    s += Math.hypot(acc[0]!, acc[1]!, acc[2]!) / 2;
  }
  return s;
}

describe('развёртки', () => {
  it('куб: шесть квадратов «крестом», площадь 6a², подписи вершин', () => {
    const n = netOf({ ...newBody('cube', 'b'), a: 2 })!;
    expect(n.polys).toHaveLength(6);
    expect(netArea(n)).toBeCloseTo(24, 9);
    const b = netBounds(n);
    // Крест: 3 квадрата в ширину, 4 в высоту.
    expect([Math.round(b.width), Math.round(b.height)].sort()).toEqual([6, 8]);
    expect(n.polys[0]!.names).toEqual(['D', 'C', 'B', 'A']);
  });

  it('грани не накладываются: развёртка пирамиды — «звезда» вокруг основания', () => {
    const n = netOf(newBody('pyramid', 'b'))!;
    expect(n.polys).toHaveLength(5);
    const apexes = n.polys.slice(1).map((p) => p.pts[2]!);
    // Вершина S у каждой боковой грани — своя точка развёртки.
    expect(new Set(apexes.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)).size).toBe(4);
  });

  it('площадь развёртки равна площади поверхности — в том числе у наклонных тел', () => {
    for (const b of [
      newBody('box', 'b'),
      { ...newBody('prism', 'b'), n: 6, shift: [1, 0.5] as [number, number] },
      { ...newBody('pyramid', 'b'), shift: [0.7, -0.4] as [number, number] },
      { ...newBody('frustum', 'b'), n: 5, k: 0.4 },
      {
        ...newBody('prism', 'b'),
        base: [
          [0, 0],
          [4, 0],
          [3, 2],
          [0, 3],
        ] as [number, number][],
      },
    ])
      expect(netArea(netOf(b)!)).toBeCloseTo(surface(b), 9);
  });

  it('цилиндр, конус, усечённый конус — формулы полной поверхности', () => {
    const r = 2;
    const h = 3;
    expect(netArea(netOf({ ...newBody('cylinder', 'b'), r, h })!)).toBeCloseTo(2 * Math.PI * r * (r + h), 9);
    const l = Math.hypot(r, h);
    const cone = netOf({ ...newBody('cone', 'b'), r, h })!;
    expect(netArea(cone)).toBeCloseTo(Math.PI * r * (r + l), 9);
    expect(cone.sectors[0]!.name).toBe('S');
    const [R, r2] = [3, 1];
    const s = Math.hypot(R - r2, h);
    expect(netArea(netOf({ ...newBody('tcone', 'b'), r: R, r2, h })!)).toBeCloseTo(Math.PI * (R * R + r2 * r2 + (R + r2) * s), 9);
  });

  it('у шара развёртки нет', () => {
    expect(netOf(newBody('sphere', 'b'))).toBeNull();
  });
});
