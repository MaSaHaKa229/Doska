import { applyMatrix, invert, transformToMatrix, type BoardObject, type Point } from '@doska/shared';

/** Мировая точка → локальные координаты объекта (с учётом поворота и масштаба). */
export function toLocal(obj: Pick<BoardObject, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>, p: Point): Point {
  return applyMatrix(invert(transformToMatrix(obj)), p);
}

/** Локальная точка → мировая. */
export function toWorld(obj: Pick<BoardObject, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>, p: Point): Point {
  return applyMatrix(transformToMatrix(obj), p);
}

/** Допуск попадания в локальных единицах (масштаб объекта уменьшает/увеличивает его). */
export function localTolerance(obj: Pick<BoardObject, 'scaleX' | 'scaleY'>, worldTolerance: number): number {
  const s = (Math.abs(obj.scaleX) + Math.abs(obj.scaleY)) / 2 || 1;
  return worldTolerance / s;
}

export function dashFor(style: 'solid' | 'dashed' | 'dotted', width: number): number[] | undefined {
  if (style === 'dashed') return [width * 4, width * 3];
  if (style === 'dotted') return [0.01, width * 2.5];
  return undefined;
}
