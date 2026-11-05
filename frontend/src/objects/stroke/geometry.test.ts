import { describe, expect, it } from 'vitest';
import type { Point } from '@doska/shared';
import {
  StrokeBuilder,
  eraseFromStroke,
  hitStroke,
  pointCount,
  pressureFactor,
  recognizeShape,
  simplifyStroke,
  strokeBounds,
  strokeOutline,
} from './geometry';

const flat = (pts: Point[], p = 0.5) => pts.flatMap((q) => [q.x, q.y, p]);
const line = (n: number, len = 100) => Array.from({ length: n }, (_, i) => ({ x: (i / (n - 1)) * len, y: 0 }));
const jitter = (pts: Point[], amp: number) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * amp, y: p.y + Math.cos(i * 2.3) * amp }));

describe('штрих: ввод', () => {
  it('близкие точки отбрасываются, дрожание сглаживается', () => {
    const b = new StrokeBuilder(1, 0.5);
    b.add(0, 0, 0.5);
    expect(b.add(0.3, 0, 0.5)).toBe(false);
    b.add(10, 0, 0.5);
    expect(b.points.slice(3, 5)).toEqual([5, 0]); // подтянута к предыдущей
    b.finish(10, 0, 0.5);
    expect(b.points.slice(-3, -1)).toEqual([10, 0]);
  });

  it('упрощение сохраняет форму и концы, убирает лишние точки прямой', () => {
    const pts = flat(line(200));
    const s = simplifyStroke(pts, 0.5);
    expect(pointCount(s)).toBe(2);
    const corner = flat([...line(50), ...line(50).map((p) => ({ x: 100, y: p.x }))]);
    expect(pointCount(simplifyStroke(corner, 0.5))).toBe(3);
    // Перепад нажатия сохраняет точку.
    const press = [0, 0, 0.1, 50, 0, 0.9, 100, 0, 0.1];
    expect(pointCount(simplifyStroke(press, 0.5))).toBe(3);
  });

  it('нажатие меняет толщину: мышь (0,5) — номинальная', () => {
    expect(pressureFactor(0.5)).toBeCloseTo(1);
    expect(pressureFactor(0)).toBeCloseTo(0.3);
    expect(pressureFactor(1)).toBeCloseTo(1.7);
  });
});

describe('штрих: отрисовка и попадание', () => {
  it('контур охватывает линию с обеих сторон и со скруглёнными концами', () => {
    const o = strokeOutline(flat(line(5)), 10, false);
    const xs = o.filter((_, i) => i % 2 === 0);
    const ys = o.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-5, 0);
    expect(Math.max(...xs)).toBeCloseTo(105, 0);
    expect(Math.min(...ys)).toBeCloseTo(-5);
    expect(Math.max(...ys)).toBeCloseTo(5);
    expect(strokeOutline([3, 4, 0.5], 2, true).length).toBeGreaterThan(10); // точка — кружок
  });

  it('габарит и попадание учитывают толщину и нажатие', () => {
    const pts = [0, 0, 1, 100, 0, 1];
    expect(strokeBounds(pts, 10, true)).toMatchObject({ x: -8.5, width: 117 });
    expect(hitStroke(pts, 10, true, { x: 50, y: 8 }, 0)).toBe(true);
    expect(hitStroke(pts, 10, false, { x: 50, y: 8 }, 0)).toBe(false);
    expect(hitStroke(pts, 10, false, { x: 50, y: 8 }, 4)).toBe(true);
    // Замкнутый многоугольник: попадание и по замыкающей стороне.
    const tri = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]);
    expect(hitStroke(tri, 2, false, { x: 25, y: 40 }, 1)).toBe(false);
    expect(hitStroke(tri, 2, false, { x: 25, y: 40 }, 1, true)).toBe(true);
  });
});

describe('попиксельный ластик', () => {
  it('разрезает штрих на две части, не трогает далёкие штрихи', () => {
    const pts = flat(line(3));
    const pieces = eraseFromStroke(pts, { x: 50, y: 0 }, 10)!;
    expect(pieces).toHaveLength(2);
    const ends = pieces.map((p) => [p[0]!, p[p.length - 3]!]);
    expect(ends[0]![0]).toBe(0);
    expect(ends[0]![1]).toBeLessThanOrEqual(40.01);
    expect(ends[0]![1]).toBeGreaterThan(35);
    expect(ends[1]![1]).toBe(100);
    expect(eraseFromStroke(pts, { x: 50, y: 40 }, 10)).toBeNull();
  });

  it('стирает конец штриха и весь штрих целиком', () => {
    const pts = flat(line(3));
    const tail = eraseFromStroke(pts, { x: 100, y: 0 }, 10)!;
    expect(tail).toHaveLength(1);
    expect(eraseFromStroke(pts, { x: 50, y: 0 }, 80)).toEqual([]);
  });
});

describe('распознавание фигур', () => {
  const circle = (cx: number, cy: number, rx: number, ry: number, n = 60) =>
    Array.from({ length: n + 1 }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * Math.PI * 2), y: cy + ry * Math.sin((i / n) * Math.PI * 2) }));
  const polyline = (vs: Point[], perSide = 20) =>
    vs.flatMap((a, i) => {
      const b = vs[(i + 1) % vs.length]!;
      return Array.from({ length: perSide }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / perSide, y: a.y + ((b.y - a.y) * k) / perSide }));
    }).concat([vs[0]!]);

  it('отрезок', () => {
    expect(recognizeShape(jitter(line(40, 200), 1.5), 20)).toMatchObject({ kind: 'line', a: { y: expect.any(Number) } });
    // Кривая — не отрезок.
    expect(recognizeShape(Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: Math.sin(i / 6) * 60 })), 20)).toBeNull();
  });

  it('окружность и эллипс', () => {
    const c = recognizeShape(jitter(circle(100, 100, 50, 48), 1.5), 20);
    expect(c).toMatchObject({ kind: 'ellipse', angle: 0 });
    expect((c as { rx: number }).rx).toBeCloseTo((c as { ry: number }).ry);
    const e = recognizeShape(circle(0, 0, 120, 40), 20);
    expect(e).toMatchObject({ kind: 'ellipse', angle: 0 });
    expect((e as { rx: number }).rx).toBeCloseTo(120, 0);
  });

  it('прямоугольник (и повёрнутый), треугольник, четырёхугольник', () => {
    const r = recognizeShape(jitter(polyline([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]), 1.5), 20);
    expect(r).toMatchObject({ kind: 'rect', angle: 0 });
    expect((r as { w: number }).w).toBeCloseTo(200, -1);
    expect((r as { cx: number }).cx).toBeCloseTo(100, -1);
    const a = Math.PI / 6;
    const rot = (x: number, y: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const rr = recognizeShape(polyline([rot(0, 0), rot(200, 0), rot(200, 100), rot(0, 100)]), 20);
    expect(rr).toMatchObject({ kind: 'rect' });
    expect((rr as { angle: number }).angle).toBeCloseTo(a, 1);
    const t = recognizeShape(jitter(polyline([{ x: 0, y: 100 }, { x: 60, y: 0 }, { x: 150, y: 100 }]), 1), 20);
    expect(t).toMatchObject({ kind: 'polygon' });
    expect((t as { points: Point[] }).points).toHaveLength(3);
    const q = recognizeShape(polyline([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 150, y: 100 }, { x: 40, y: 100 }]), 20);
    expect(q).toMatchObject({ kind: 'polygon' });
  });

  it('мелочь и каракули не распознаются', () => {
    expect(recognizeShape(circle(0, 0, 3, 3), 20)).toBeNull();
    const scribble = Array.from({ length: 80 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 90 }));
    expect(recognizeShape(scribble, 20)).toBeNull();
  });
});
