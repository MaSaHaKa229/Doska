import { describe, expect, it } from 'vitest';
import { classify, equilibria, second, solveAt, solveCurve, trajectory } from './diffeq';

const R = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };

describe('задача Коши y′ = f(x, y)', () => {
  it('y′ = y, y(0) = 1: Рунге — Кутта точнее Эйлера, оба сходятся к e', () => {
    const f = (_x: number, y: number) => y;
    const rk = solveAt(f, 0, 1, 1, 0.1, 'rk4');
    const eu = solveAt(f, 0, 1, 1, 0.1, 'euler');
    expect(rk).toBeCloseTo(Math.E, 5);
    expect(eu).toBeCloseTo(1.1 ** 10, 9);
    expect(Math.abs(eu - Math.E)).toBeGreaterThan(Math.abs(rk - Math.E) * 1000);
    expect(Math.abs(solveAt(f, 0, 1, 1, 0.01, 'euler') - Math.E)).toBeLessThan(Math.abs(eu - Math.E));
  });

  it('интегральная кривая y′ = x через (0; 0) — парабола x²/2, в обе стороны', () => {
    const pts = solveCurve((x) => x, 0, 0, R, 0.05, 'rk4');
    expect(pts[0]![0]).toBeLessThan(-3.9);
    expect(pts[pts.length - 1]![0]).toBeGreaterThan(3.9);
    for (const [x, y] of pts) expect(y).toBeCloseTo((x * x) / 2, 6);
  });

  it('обрыв, когда решение уходит в бесконечность (y′ = y²)', () => {
    const pts = solveCurve((_x, y) => y * y, 0, 1, R, 0.01, 'rk4');
    expect(pts[pts.length - 1]![0]).toBeLessThan(1.01);
  });
});

describe('особые точки', () => {
  it('тип по якобиану', () => {
    expect(classify({ a: 1, b: 0, c: 0, d: -1 }).kind).toBe('saddle');
    expect(classify({ a: -1, b: 0, c: 0, d: -2 }).kind).toBe('node-stable');
    expect(classify({ a: 0, b: -1, c: 1, d: 0 })).toMatchObject({ kind: 'center', im: 1 });
    expect(classify({ a: -0.2, b: -1, c: 1, d: -0.2 }).kind).toBe('focus-stable');
    expect(classify({ a: 0.5, b: 0, c: 0, d: 1 }).kind).toBe('node-unstable');
  });

  it('маятник x′ = y, y′ = −sin x: центр в 0, сёдла в ±π', () => {
    const s = { P: (_x: number, y: number) => y, Q: (x: number) => -Math.sin(x), Px: () => 0, Py: () => 1, Qx: (x: number) => -Math.cos(x), Qy: () => 0 };
    const eq = equilibria(s, R).sort((a, b) => a.x - b.x);
    expect(eq.map((e) => e.kind)).toEqual(['saddle', 'center', 'saddle']);
    expect(eq[0]!.x).toBeCloseTo(-Math.PI, 8);
  });

  it('траектория центра x′ = −y, y′ = x — замкнутая окружность', () => {
    const t = trajectory((_x, y) => -y, (x) => x, 2, 0, R, 3);
    for (const [x, y] of t) expect(Math.hypot(x, y)).toBeCloseTo(2, 4);
  });
});

describe('y″ + py′ + qy = 0', () => {
  it('три случая корней и начальные условия', () => {
    const osc = second(0, 4, 1, 0);
    expect(osc.kind).toBe('complex');
    expect(osc.y(Math.PI / 2)).toBeCloseTo(-1, 9);
    expect(osc.behaviour).toMatch(/гармонические/);
    const real = second(3, 2, 1, 0);
    expect([real.r1, real.r2]).toEqual([-2, -1]);
    expect(real.y(0)).toBeCloseTo(1, 12);
    const crit = second(2, 1, 0, 1);
    expect(crit.kind).toBe('double');
    expect(crit.y(1)).toBeCloseTo(Math.exp(-1), 12);
    // Проверка уравнения численно: y″ + py′ + qy ≈ 0.
    for (const s of [second(0.4, 3, 1, -1), real, crit]) {
      const h = 1e-4;
      const t = 0.7;
      const y = s.y(t);
      const y1 = (s.y(t + h) - s.y(t - h)) / (2 * h);
      const y2 = (s.y(t + h) - 2 * y + s.y(t - h)) / (h * h);
      const p = s === real ? 3 : s === crit ? 2 : 0.4;
      const q = s === real ? 2 : s === crit ? 1 : 3;
      expect(y2 + p * y1 + q * y).toBeCloseTo(0, 4);
    }
  });
});

describe('объекты раздела', () => {
  it('точки задачи Коши: перенос с округлением, добавление и удаление; 3 инструмента', async () => {
    const { slopeModule } = await import('./objects');
    const { registry } = await import('../../plugins/registry');
    const o = { id: 's', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: slopeModule.createProps() } as never;
    const mods = { shift: false, alt: false, ctrl: false };
    const moved = slopeModule.dragHandle!(o, 'p:1', { x: 190, y: 95 }, mods, {} as never) as { props: { points: { x: number; y: number }[] } };
    expect(moved.props.points[1]).toEqual({ x: 0, y: 2 });
    expect(moved.props.points[0]).toEqual({ x: -3, y: 2 });
    let updated: unknown = null;
    const ctx = { updateObject: (_id: string, patch: unknown) => (updated = patch) } as never;
    slopeModule.runAction!(o, 'add', ctx);
    expect((updated as { props: { points: unknown[] } }).props.points).toHaveLength(3);
    slopeModule.runAction!(o, 'remove', ctx);
    expect((updated as { props: { points: unknown[] } }).props.points).toHaveLength(1);
    expect(registry.listTools().filter((t) => t.id.startsWith('math.diffeq.'))).toHaveLength(3);
  });
});
