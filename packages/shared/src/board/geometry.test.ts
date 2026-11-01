import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  distanceToSegment,
  invert,
  multiply,
  rectsIntersect,
  transformRect,
  transformToMatrix,
  unionRects,
} from './geometry.js';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('geometry', () => {
  it('матрица трансформации: масштаб → поворот → перенос', () => {
    const m = transformToMatrix({ x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 1 });
    const p = applyMatrix(m, { x: 1, y: 0 });
    close(p.x, 10);
    close(p.y, 22);
  });

  it('обратная матрица', () => {
    const m = transformToMatrix({ x: -5, y: 7, rotation: 0.7, scaleX: 3, scaleY: 0.5 });
    const id = multiply(invert(m), m);
    [1, 0, 0, 1, 0, 0].forEach((v, i) => close(id[i] as number, v));
    expect(() => invert([0, 0, 0, 0, 1, 1])).toThrow();
  });

  it('габарит повёрнутого прямоугольника', () => {
    const m = transformToMatrix({ x: 0, y: 0, rotation: Math.PI / 4, scaleX: 1, scaleY: 1 });
    const r = transformRect(m, { x: -1, y: -1, width: 2, height: 2 });
    close(r.width, 2 * Math.SQRT2);
    close(r.x, -Math.SQRT2);
  });

  it('пересечение и объединение прямоугольников', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.5, width: 1, height: 1 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 2, width: 1, height: 1 })).toBe(false);
    expect(unionRects([{ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: -1, width: 1, height: 1 }])).toEqual({
      x: 0,
      y: -1,
      width: 3,
      height: 2,
    });
  });

  it('расстояние до отрезка', () => {
    close(distanceToSegment({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }), 1);
    close(distanceToSegment({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }), 2);
    close(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
  });
});
