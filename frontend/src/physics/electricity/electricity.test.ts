import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { capacitor, equipotentials, fieldAt, fieldLines, forces, withPrefix, type System } from './field';
import { CAPACITOR_TYPE, SYSTEM_TYPE, capacitorModule, computed, systemInfo, systemModule, type CapacitorProps, type SystemProps } from './objects';

/** Два заряда по 1 нКл на расстоянии 1 см (одна клетка = 1 см). */
const pair = (q2 = 1): System => ({ charges: [{ id: 'a', x: 100, y: 100, q: 1 }, { id: 'b', x: 120, y: 100, q: q2 }], cell: 1, eps: 1 });

describe('поле точечных зарядов', () => {
  it('закон Кулона: F = kq₁q₂/r² = 90 мкН; третий закон Ньютона; отталкивание и притяжение', () => {
    const f = forces(pair());
    expect(Math.hypot(f[0]!.fx, f[0]!.fy)).toBeCloseTo(9e-5, 12);
    expect(f[0]!.fx + f[1]!.fx).toBeCloseTo(0, 15);
    expect(f[0]!.fx).toBeLessThan(0);
    expect(forces(pair(-1))[0]!.fx).toBeGreaterThan(0);
    // В среде с ε = 2 — вдвое меньше.
    expect(Math.abs(forces({ ...pair(), eps: 2 })[0]!.fx)).toBeCloseTo(4.5e-5, 12);
  });

  it('напряжённость и потенциал одного заряда: E = kq/r², φ = kq/r', () => {
    const s: System = { charges: [{ id: 'a', x: 0, y: 0, q: 1 }], cell: 1, eps: 1 };
    const e = fieldAt(s, 40, 0);
    expect(e.ex).toBeCloseTo(9e9 * 1e-9 / 0.02 ** 2, 6);
    expect(e.ey).toBeCloseTo(0, 9);
    expect(e.phi).toBeCloseTo(450, 9);
  });

  it('силовые линии диполя выходят из «+» и приходят в «−»; число — по заряду', () => {
    const s: System = { charges: [{ id: 'a', x: 200, y: 200, q: 2 }, { id: 'b', x: 320, y: 200, q: -2 }], cell: 1, eps: 1 };
    const lines = fieldLines(s, 600, 400);
    expect(lines).toHaveLength(12);
    const ended = lines.filter((l) => Math.hypot(l[l.length - 2]! - 320, l[l.length - 1]! - 200) < 12);
    expect(ended.length).toBeGreaterThanOrEqual(6);
    // Только отрицательный заряд — линии приходят в него «из бесконечности»: последняя точка — у заряда.
    const inward = fieldLines({ charges: [{ id: 'n', x: 300, y: 200, q: -1 }], cell: 1, eps: 1 }, 600, 400);
    expect(inward).toHaveLength(12);
    for (const l of inward) expect(Math.hypot(l[l.length - 2]! - 300, l[l.length - 1]! - 200)).toBeCloseTo(10, 6);
  });

  it('эквипотенциали одного заряда — окружности радиусов 1,5; 2,5; 4; 6 клеток', () => {
    const s: System = { charges: [{ id: 'a', x: 300, y: 200, q: 1 }], cell: 1, eps: 1 };
    const eq = equipotentials(s, 600, 400);
    expect(eq).toHaveLength(4);
    const radii = eq.map((e) => Math.hypot(e.segs[0]! - 300, e.segs[1]! - 200));
    radii.forEach((r, i) => expect(r).toBeCloseTo([1.5, 2.5, 4, 6][i]! * 20, -0.5));
  });

  it('конденсатор: C = εε₀S/d, E = U/d, q = CU, W = CU²/2', () => {
    const c = capacitor(100, 5, 100, 1);
    expect(c.C).toBeCloseTo(8.85e-12 * 1e-2 / 5e-3, 20);
    expect(c.E).toBeCloseTo(2e4, 6);
    expect(c.q).toBeCloseTo(c.C * 100, 20);
    expect(c.W).toBeCloseTo(c.C * 1e4 / 2, 20);
    expect(withPrefix(c.C, 'Ф')).toBe('17,7 пФ');
    expect(withPrefix(9e-5, 'Н')).toBe('90 мкН');
    expect(withPrefix(22500, 'Н/Кл')).toBe('22,5 кН/Кл');
    expect(withPrefix(-450, 'В')).toBe('−450 В');
  });

  it('сведения о двух зарядах; двенадцать зарядов считаются быстро', () => {
    const p = { ...systemModule.createProps(), charges: pair(-1).charges };
    expect(systemInfo(p)[0]).toBe('r = 10 мм,  F = k|q₁q₂|/r² = 90 мкН — притягиваются');
    const many: SystemProps = { ...systemModule.createProps(), charges: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, x: 50 + (i % 4) * 150, y: 80 + Math.floor(i / 4) * 120, q: i % 2 ? -3 : 5 })) };
    const t0 = performance.now();
    const c = computed(many);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(c.lines.length).toBeGreaterThan(20);
    expect(computed(many)).toBe(c);
  });
});

describe('инструменты и объекты', () => {
  const T = '11111111-1111-4111-8111-111111111111';
  function setup() {
    const caps = () =>
      computeCapabilities({
        user: { id: T, role: 'TEACHER' },
        board: { kind: 'LESSON', mode: 'COLLABORATIVE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
        memberRole: null,
        studentViaClass: false,
        teachesOwner: false,
        hasChalk: false,
      });
    const model = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: caps, ownerId: T });
    model.addPage('Страница 1');
    const pageId = model.pages()[0]!.id;
    let selection: string[] = [];
    const ctx = {
      userId: T,
      pageId,
      canWrite: true,
      resolve: model.resolve,
      createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
      updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
      transact: (fn, opts) => model.transact(fn, opts),
      listObjects: (type) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => !type || o.type === type),
      setSelection: (ids) => (selection = ids),
      getSelection: () => selection,
      activateTool: () => undefined,
      getToolOptions: <O,>() => ({ chargeQ: 4 }) as O,
    } satisfies Partial<ToolContext> as unknown as ToolContext;
    const ev = (x: number, y: number) => ({ world: { x, y }, snapped: { x, y }, snap: null, pressure: 0.5, pointerType: 'mouse', modifiers: { shift: false, alt: false, ctrl: false }, timeStamp: 0 }) as ToolPointerEvent;
    return { model, pageId, ctx, ev };
  }

  it('«Заряд +» создаёт систему, «Заряд −» в её рамке добавляет заряд туда же', () => {
    const { model, pageId, ctx, ev } = setup();
    registry.getTool('physics.electricity.positive')!.onPointerDown!(ev(500, 400), ctx);
    registry.getTool('physics.electricity.negative')!.onPointerDown!(ev(600, 400), ctx);
    const systems = model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === SYSTEM_TYPE) as BoardObject<SystemProps>[];
    expect(systems).toHaveLength(1);
    expect(systems[0]!.props.charges.map((c) => [c.x, c.y, c.q])).toEqual([[300, 200, 4], [400, 200, -4]]);
  });

  it('заряды тянутся ручками в пределах рамки; расстояние конденсатора — ручкой', () => {
    const o = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: { ...systemModule.createProps(), charges: [{ id: 'q1', x: 10, y: 10, q: 1 }] } } as unknown as BoardObject<SystemProps>;
    const mods = { shift: false, alt: false, ctrl: false };
    expect(systemModule.dragHandle!(o, 'c:q1', { x: 900, y: 50 }, mods, {} as never)).toEqual({ props: { charges: [{ id: 'q1', x: 600, y: 50, q: 1 }] } });
    expect(systemModule.hitTest(o, { x: 300, y: 300 }, 2, {} as never)).toBe(false);
    expect(systemModule.hitTest(o, { x: 12, y: 12 }, 2, {} as never)).toBe(true);
    const cap = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: capacitorModule.createProps() } as unknown as BoardObject<CapacitorProps>;
    expect(capacitorModule.dragHandle!(cap, 'd', { x: 80, y: 80 }, mods, {} as never)).toEqual({ props: { d: 10 } });
    expect(registry.getObjectModule(CAPACITOR_TYPE)).toBeTruthy();
  });
});
