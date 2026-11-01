import type { AwarenessState, Point } from '@doska/shared';

/** За сколько след лазера угасает полностью. */
export const LASER_FADE_MS = 1500;
/** Предел точек следа (как в схеме awareness: 400 точек). */
export const LASER_MAX_POINTS = 400;
/** Публикация следа другим — не чаще ~30 раз в секунду. */
const PUBLISH_INTERVAL_MS = 33;

export type LaserState = NonNullable<AwarenessState['laser']>;

/**
 * Собственный след лазерной указки. Точки хранятся плоско: [x, y, t, …],
 * где t — мс от начала следа (так требует схема awareness). Старые точки
 * отбрасываются по мере угасания, пустой след публикуется как null.
 */
export class LaserTrail {
  pageId: string | null = null;
  points: number[] = [];
  private start = 0;

  /** Начать (или продолжить, если след ещё не угас) след на странице. */
  begin(pageId: string, now: number): void {
    if (this.pageId !== pageId || this.points.length === 0) {
      this.pageId = pageId;
      this.points = [];
      this.start = now;
    }
  }

  add(p: Point, now: number): void {
    if (!this.pageId) return;
    this.points.push(p.x, p.y, now - this.start);
    if (this.points.length > LASER_MAX_POINTS * 3) this.points.splice(0, this.points.length - LASER_MAX_POINTS * 3);
  }

  /** Убрать угасшие точки; true — след изменился. */
  prune(now: number): boolean {
    const age = now - this.start;
    let drop = 0;
    while (drop < this.points.length && age - this.points[drop + 2]! > LASER_FADE_MS) drop += 3;
    if (!drop) return false;
    this.points.splice(0, drop);
    if (!this.points.length) this.pageId = null;
    return true;
  }

  /** Время последней точки относительно начала следа. */
  get lastT(): number {
    return this.points.length ? this.points[this.points.length - 1]! : 0;
  }

  /** Сколько прошло после последней точки. */
  idleFor(now: number): number {
    return now - this.start - this.lastT;
  }

  get state(): LaserState | null {
    return this.pageId && this.points.length ? { pageId: this.pageId, points: [...this.points] } : null;
  }
}

/**
 * Прозрачность точки следа: 1 — только что, 0 — угасла. Возраст считается
 * от последней точки следа (lastT) плюс время, прошедшее с её получения:
 * часы участников не нужно синхронизировать.
 */
export function laserAlpha(pointT: number, lastT: number, sinceLast: number): number {
  return Math.max(0, Math.min(1, 1 - (lastT - pointT + sinceLast) / LASER_FADE_MS));
}

/**
 * Указка текущего пользователя: ведёт след, публикует его в присутствие
 * (с ограничением частоты) и сообщает слоям отрисовки об изменениях.
 */
export class LaserPointer {
  readonly trail = new LaserTrail();
  private readonly listeners = new Set<() => void>();
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private lastPublished = 0;
  private published = false;

  constructor(
    private readonly publish: (state: LaserState | null) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  down(pageId: string, p: Point): void {
    this.trail.begin(pageId, this.now());
    this.trail.add(p, this.now());
    this.changed();
    this.pruneTimer ??= setInterval(() => this.tick(), 100);
  }

  move(p: Point): void {
    if (!this.trail.pageId) return;
    this.trail.add(p, this.now());
    this.changed();
  }

  /** Отпускание: след остаётся и угасает сам. */
  up(): void {
    this.flush();
  }

  private tick(): void {
    if (this.trail.prune(this.now())) this.changed();
    if (!this.trail.pageId && this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
    const wait = PUBLISH_INTERVAL_MS - (this.now() - this.lastPublished);
    if (wait <= 0) this.flush();
    else this.publishTimer ??= setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    const state = this.trail.state;
    if (!state && !this.published) return;
    this.lastPublished = this.now();
    this.published = !!state;
    this.publish(state);
  }

  destroy(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.listeners.clear();
  }
}
