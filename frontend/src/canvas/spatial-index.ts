import RBush from 'rbush';
import type { Rect } from '@doska/shared';

interface Item {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

/**
 * Пространственный индекс (R-дерево) габаритов объектов одной страницы.
 * Позволяет за O(log n + k) найти объекты в видимой области (виртуализация
 * отрисовки) и кандидатов для проверки попадания курсора — вместо перебора
 * всех объектов страницы.
 */
export class SpatialIndex {
  private readonly tree = new RBush<Item>();
  private readonly items = new Map<string, Item>();

  set(id: string, r: Rect): void {
    this.remove(id);
    const item: Item = { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height, id };
    this.items.set(id, item);
    this.tree.insert(item);
  }

  remove(id: string): void {
    const old = this.items.get(id);
    if (old) {
      this.tree.remove(old);
      this.items.delete(id);
    }
  }

  search(r: Rect): string[] {
    return this.tree.search({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height }).map((i) => i.id);
  }

  get size(): number {
    return this.items.size;
  }

  /** Габарит всех объектов страницы (для «Показать всё»). */
  bounds(): Rect | null {
    if (this.items.size === 0) return null;
    const d = this.tree.toJSON() as { minX: number; minY: number; maxX: number; maxY: number };
    return { x: d.minX, y: d.minY, width: d.maxX - d.minX, height: d.maxY - d.minY };
  }
}
