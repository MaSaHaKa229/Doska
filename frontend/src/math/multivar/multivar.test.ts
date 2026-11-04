import { beforeAll, describe, expect, it } from 'vitest';
import type { MathJsInstance } from 'mathjs';
import { getMath, loadMath } from '../analysis/expr';
import { type Compiled, compile2, contour, fieldAt, fieldMeaning, levels, project, sampleGrid, streamline, zRange } from './multivar';

let m: MathJsInstance;
beforeAll(async () => {
  await loadMath();
  m = getMath()!;
});
const ok = (src: string): Compiled => {
  const c = compile2(m, src);
  if ('error' in c) throw new Error(c.error);
  return c;
};

describe('функции двух переменных', () => {
  it('разбор и частные производные: f = x²y + sin(y)', () => {
    const c = ok('x^2*y + sin(y)');
    expect(c.f(2, 0)).toBe(0);
    expect(c.fx(2, 3)).toBeCloseTo(12, 9);
    expect(c.fy(2, 0)).toBeCloseTo(4 + 1, 9);
    expect(c.dxText).toBeTruthy();
  });

  it('школьная запись: «z =», «f(x, y) =», ², √, ·', () => {
    expect(ok('z = x² + y²').f(3, 4)).toBe(25);
    expect(ok('f(x, y) = √(x² + y²)').f(3, 4)).toBe(5);
    expect(ok('2x·y').f(2, 3)).toBe(12);
  });

  it('ошибки: неизвестное обозначение и подсказка про xy', () => {
    expect(compile2(m, 'x + a')).toEqual({ error: 'неизвестное обозначение «a»' });
    expect((compile2(m, 'xy') as { error: string }).error).toMatch(/x·y/);
    expect(compile2(m, '(x +')).toHaveProperty('error');
  });

  it('линии уровня параболоида — окружности', () => {
    const c = ok('x^2 + y^2');
    const r = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 };
    const g = sampleGrid(c.f, r, 60);
    expect(g.min).toBe(0);
    const segs = contour(g, r, 4);
    expect(segs.length).toBeGreaterThan(40);
    for (let i = 0; i < segs.length; i += 2) expect(Math.hypot(segs[i]!, segs[i + 1]!)).toBeCloseTo(2, 1);
    expect(levels(0, 18, 6)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(zRange(g)[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('векторное поле', () => {
  it('вихрь (−y; x): div = 0, rot = 2; источник (x; y): div = 2, rot = 0', () => {
    const v = fieldAt(ok('-y'), ok('x'), 1, 2);
    expect(v.P).toBe(-2);
    expect(v.div).toBeCloseTo(0, 9);
    expect(v.rot).toBeCloseTo(2, 9);
    const s = fieldAt(ok('x'), ok('y'), 1, 1);
    expect(s.div).toBeCloseTo(2, 9);
    expect(fieldMeaning(s.div, s.rot)).toMatch(/источник.*без вращения/);
    expect(fieldMeaning(0, -1)).toMatch(/по часовой/);
  });

  it('линия тока вихря — окружность, источника — луч', () => {
    const r = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
    const circ = streamline((x, y) => -y, (x) => x, 2, 0, r, 0.05);
    for (const [x, y] of circ) expect(Math.hypot(x, y)).toBeCloseTo(2, 3);
    const ray = streamline((x) => x, (_x, y) => y, 1, 1, r, 0.1);
    for (const [x, y] of ray) expect(Math.abs(x - y)).toBeLessThan(1e-9);
  });
});

describe('проекция поверхности', () => {
  it('сверху (наклон 90°) — вид плана; сбоку (0°) — высота вверх', () => {
    const top = project({ yaw: 0, pitch: 90 }, 1, 2, 5);
    expect(top.u).toBeCloseTo(1, 12);
    expect(top.up).toBeCloseTo(2, 12);
    const side = project({ yaw: 0, pitch: 0 }, 1, 2, 5);
    expect(side.up).toBeCloseTo(5, 12);
    expect(side.depth).toBeCloseTo(2, 12);
  });
});

describe('объекты раздела', () => {
  it('поверхность: клетки от дальних к ближним; ползунки поворота в пределах', async () => {
    const { surfaceQuads, surfaceModule } = await import('./objects');
    const { registry } = await import('../../plugins/registry');
    const s = surfaceQuads(ok('x^2 - y^2').f, { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, 10, 35, 30);
    expect(s.quads).toHaveLength(100);
    for (let i = 1; i < s.quads.length; i++) expect(s.quads[i - 1]!.depth).toBeGreaterThanOrEqual(s.quads[i]!.depth);
    const o = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: surfaceModule.createProps() } as never;
    const mods = { shift: false, alt: false, ctrl: false };
    expect(surfaceModule.dragHandle!(o, 'yaw', { x: 500, y: 0 }, mods, {} as never)).toEqual({ props: { yaw: 180 } });
    expect(surfaceModule.dragHandle!(o, 'pitch', { x: 0, y: -1000 }, mods, {} as never)).toEqual({ props: { pitch: 90 } });
    expect(registry.listTools().filter((t) => t.id.startsWith('math.multivar.'))).toHaveLength(3);
  });

  it('точка M линий уровня тянется в пределах области и округляется', async () => {
    const { contoursModule } = await import('./objects');
    const o = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: contoursModule.createProps() } as never;
    const r = contoursModule.dragHandle!(o, 'M', { x: 285, y: 95 }, { shift: false, alt: false, ctrl: false }, {} as never) as { props: { x0: number; y0: number } };
    expect(r.props.x0).toBeCloseTo(2, 1);
    expect(r.props.y0).toBeCloseTo(2, 1);
    const out = contoursModule.dragHandle!(o, 'M', { x: 9999, y: 9999 }, { shift: false, alt: false, ctrl: false }, {} as never) as { props: { x0: number; y0: number } };
    expect(out.props).toEqual({ x0: 4, y0: -4 });
  });
});
