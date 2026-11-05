import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND } from '@doska/shared';
import { findSnap, gridSnap, intersectCurves } from './snapping';

const close = (p: { x: number; y: number } | null | undefined, x: number, y: number) => {
  expect(p).toBeTruthy();
  expect(p!.x).toBeCloseTo(x, 6);
  expect(p!.y).toBeCloseTo(y, 6);
};

describe('сетка', () => {
  it('клетка, линейка, миллиметровка', () => {
    close(gridSnap({ x: 27, y: 52 }, { ...DEFAULT_BACKGROUND, kind: 'grid', step: 20 }, 1), 20, 60);
    close(gridSnap({ x: 27, y: 52 }, { ...DEFAULT_BACKGROUND, kind: 'ruled', step: 20 }, 1), 27, 60);
    close(gridSnap({ x: 5.1, y: 3 }, { ...DEFAULT_BACKGROUND, kind: 'millimeter', step: 20 }, 2), 4, 4);
    expect(gridSnap({ x: 1, y: 1 }, { ...DEFAULT_BACKGROUND, kind: 'blank' }, 1)).toBeNull();
  });
  it('шаг укрупняется при отдалении', () => {
    close(gridSnap({ x: 130, y: 0 }, { ...DEFAULT_BACKGROUND, kind: 'grid', step: 20 }, 0.1), 100, 0);
  });
  it('полярная сетка: радиус и угол 15°', () => {
    const p = gridSnap({ x: 38, y: 12 }, { ...DEFAULT_BACKGROUND, kind: 'polar', step: 20 }, 1)!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(40);
    expect((Math.atan2(p.y, p.x) * 180) / Math.PI).toBeCloseTo(15);
  });
  it('изометрическая решётка', () => {
    const s = 20;
    const h = (s * Math.sqrt(3)) / 2;
    close(gridSnap({ x: h + 1, y: s / 2 + 2 }, { ...DEFAULT_BACKGROUND, kind: 'isometric', step: s }, 1), h, s / 2);
  });
});

describe('пересечения', () => {
  it('отрезки', () => {
    const r = intersectCurves({ kind: 'segment', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { kind: 'segment', a: { x: 0, y: 10 }, b: { x: 10, y: 0 } });
    expect(r).toHaveLength(1);
    close(r[0], 5, 5);
    expect(intersectCurves({ kind: 'segment', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, { kind: 'segment', a: { x: 5, y: 0 }, b: { x: 6, y: -1 } })).toEqual([]);
  });
  it('прямая и окружность, окружности, дуга', () => {
    const lc = intersectCurves({ kind: 'line', point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }, { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 });
    expect(lc.map((p) => Math.round(p.x)).sort((a, b) => a - b)).toEqual([-5, 5]);
    const cc = intersectCurves({ kind: 'circle', center: { x: 0, y: 0 }, radius: 5 }, { kind: 'circle', center: { x: 8, y: 0 }, radius: 5 });
    expect(cc).toHaveLength(2);
    close(cc[0], 4, -3);
    const arc = intersectCurves(
      { kind: 'line', point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      { kind: 'arc', center: { x: 0, y: 0 }, radius: 5, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 },
    );
    expect(arc).toHaveLength(1);
    close(arc[0], 5, 0);
  });
  it('луч и ломаная', () => {
    const r = intersectCurves(
      { kind: 'ray', origin: { x: 0, y: 5 }, direction: { x: 1, y: 0 } },
      { kind: 'polyline', points: [{ x: -10, y: 0 }, { x: -10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }], closed: true },
    );
    expect(r).toHaveLength(1);
    close(r[0], 10, 5);
  });
});

describe('выбор привязки', () => {
  const sources = [
    {
      id: 'a',
      points: [
        { kind: 'endpoint' as const, point: { x: 0, y: 0 } },
        { kind: 'midpoint' as const, point: { x: 50, y: 0 } },
      ],
      curves: [{ kind: 'segment' as const, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
    },
    { id: 'b', points: [], curves: [{ kind: 'segment' as const, a: { x: 30, y: -50 }, b: { x: 30, y: 50 } }] },
  ];
  it('ближайшая характерная точка', () => {
    expect(findSnap({ x: 3, y: 2 }, 10, sources, null)).toMatchObject({ kind: 'endpoint', point: { x: 0, y: 0 } });
    expect(findSnap({ x: 28, y: 1 }, 10, sources, null)).toMatchObject({ kind: 'intersection' });
    expect(findSnap({ x: 70, y: 30 }, 10, sources, null)).toBeNull();
  });
  it('объекты важнее сетки', () => {
    expect(findSnap({ x: 49, y: 1 }, 10, sources, { x: 48, y: 0 })).toMatchObject({ kind: 'midpoint' });
    expect(findSnap({ x: 80, y: 30 }, 10, sources, { x: 80, y: 32 })).toMatchObject({ kind: 'grid' });
  });
});
