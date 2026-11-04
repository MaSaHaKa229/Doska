import { describe, expect, it } from 'vitest';
import { solve, type Part, type PartKind } from './circuit';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { CIRCUIT_TYPE, circuitModule, partNames, solutionOf, type CircuitProps } from './circuits';

let n = 0;
const part = (kind: PartKind, a: [number, number], b: [number, number], v = 0, extra: Partial<Part> = {}): Part => ({ id: `p${n++}`, kind, a, b, v, r: 0, closed: true, pnom: 2, ...extra });

describe('решатель цепей', () => {
  it('закон Ома для полной цепи: E = 12 В, r = 1 Ом, R = 5 Ом → I = 2 А, U_R = 10 В', () => {
    // Прямоугольник: источник слева (плюс сверху), резистор справа, провода сверху и снизу.
    const bat = part('battery', [0, 3], [0, 0], 12, { r: 1 });
    const res = part('resistor', [4, 0], [4, 3], 5);
    const amm = part('ammeter', [0, 0], [2, 0]);
    const parts = [bat, amm, part('wire', [2, 0], [4, 0]), res, part('wire', [4, 3], [0, 3])];
    const s = solve(parts);
    expect(s.results.get(bat.id)!.I).toBeCloseTo(2, 3);
    expect(s.results.get(res.id)!.U).toBeCloseTo(10, 3);
    expect(s.results.get(res.id)!.I).toBeCloseTo(2, 3);
    expect(Math.abs(s.results.get(amm.id)!.I)).toBeCloseTo(2, 3);
    expect(s.summary!.Rext).toBeCloseTo(5, 2);
    expect(s.short).toBeNull();
  });

  it('параллельное соединение 6 Ом и 3 Ом: общее 2 Ом, токи 1 А и 2 А, вольтметр — 6 В', () => {
    const bat = part('battery', [0, 3], [0, 0], 6);
    const r1 = part('resistor', [3, 0], [3, 3], 6);
    const r2 = part('resistor', [6, 0], [6, 3], 3);
    const vm = part('voltmeter', [6, 3], [6, 0]);
    const parts = [bat, part('wire', [0, 0], [3, 0]), part('wire', [3, 0], [6, 0]), r1, r2, part('wire', [6, 3], [3, 3]), part('wire', [3, 3], [0, 3]), vm];
    const s = solve(parts);
    expect(s.results.get(r1.id)!.I).toBeCloseTo(1, 3);
    expect(s.results.get(r2.id)!.I).toBeCloseTo(2, 3);
    expect(s.results.get(vm.id)!.U).toBeCloseTo(6, 3);
    expect(s.summary!.Rext).toBeCloseTo(2, 3);
  });

  it('разомкнутый ключ — тока нет; замкнутый — есть; лампа: мощность I²R', () => {
    const bat = part('battery', [0, 2], [0, 0], 6);
    const k = part('switch', [0, 0], [2, 0], 0, { closed: false });
    const lamp = part('lamp', [2, 0], [2, 2], 12);
    const parts = [bat, k, lamp, part('wire', [2, 2], [0, 2])];
    expect(solve(parts).results.get(lamp.id)!.I).toBeCloseTo(0, 6);
    const on = solve(parts.map((p) => (p === k ? { ...k, closed: true } : p)));
    expect(on.results.get(lamp.id)!.I).toBeCloseTo(0.5, 3);
    expect(on.results.get(lamp.id)!.P).toBeCloseTo(3, 3);
  });

  it('короткое замыкание идеального источника проводом', () => {
    const bat = part('battery', [0, 2], [0, 0], 6);
    const s = solve([bat, part('wire', [0, 0], [2, 0]), part('wire', [2, 0], [2, 2]), part('wire', [2, 2], [0, 2])]);
    expect(s.short).toMatch(/Короткое замыкание/);
  });

  it('два источника навстречу: 12 В и 4 В, r = 1 + 1, R = 2 → I = 2 А', () => {
    const b1 = part('battery', [0, 2], [0, 0], 12, { r: 1 });
    // Плюс второго — сверху (у b): по обходу он навстречу первому.
    const b2 = part('battery', [4, 2], [4, 0], 4, { r: 1 });
    const r = part('resistor', [2, 2], [0, 2], 2);
    const s = solve([b1, part('wire', [0, 0], [4, 0]), b2, part('wire', [4, 2], [2, 2]), r]);
    expect(Math.abs(s.results.get(r.id)!.I)).toBeCloseTo(2, 3);
    expect(s.summary).toBeNull();
  });
});

describe('схема на доске', () => {
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
    let preview: unknown = null;
    const ctx = {
      userId: T,
      pageId,
      canWrite: true,
      resolve: model.resolve,
      createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
      updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
      transact: (fn, opts) => model.transact(fn, opts),
      listObjects: (type) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => !type || o.type === type),
      setSelection: () => undefined,
      setPreview: (p) => (preview = p),
      getPreview: <P,>() => preview as P | null,
    } satisfies Partial<ToolContext> as unknown as ToolContext;
    const ev = (x: number, y: number) => ({ world: { x, y }, snapped: { x, y }, snap: null, pressure: 0.5, pointerType: 'mouse', modifiers: { shift: false, alt: false, ctrl: false }, timeStamp: 0 }) as ToolPointerEvent;
    const draw = (kind: string, from: [number, number], to: [number, number]) => {
      const t = registry.getTool(`physics.electricity.${kind}`)!;
      t.onPointerDown!(ev(...from), ctx);
      t.onPointerMove!(ev(...to), ctx);
      t.onPointerUp!(ev(...to), ctx);
    };
    const circuit = () => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === CIRCUIT_TYPE) as BoardObject<CircuitProps>[];
    return { model, ctx, draw, circuit };
  }

  it('элементы протяжкой по узлам сетки собираются в одну схему; ток считается', () => {
    const { draw, circuit } = setup();
    // Прямоугольник 4×3 клетки: источник слева (снизу вверх — плюс сверху), резистор справа.
    draw('battery', [102, 158], [99, 103]);
    draw('wire', [100, 100], [181, 104]);
    draw('resistor', [180, 100], [182, 161]);
    draw('wire', [180, 160], [99, 158]);
    const [c] = circuit();
    expect(circuit()).toHaveLength(1);
    expect(c!.props.parts.map((p) => [p.kind, p.a, p.b])).toEqual([
      ['battery', [0, 0], [0, -3]],
      ['wire', [0, -3], [4, -3]],
      ['resistor', [4, -3], [4, 0]],
      ['wire', [4, 0], [0, 0]],
    ]);
    // E = 12 В, r = 1 Ом, R = 4 Ом → I = 2,4 А.
    const s = solutionOf(c!.props);
    expect(s.summary!.I).toBeCloseTo(2.4, 3);
    expect([...partNames(c!.props.parts).values()]).toEqual(['ε₁', 'R₁']);
  });

  it('ключ переключается щелчком по ручке (finishHandle) без перетаскивания', () => {
    const { model, ctx, draw, circuit } = setup();
    draw('switch', [0, 0], [60, 0]);
    const [c] = circuit();
    expect(c!.props.parts[0]!.closed).toBe(false);
    const h = circuitModule.getHandles(c!, model.resolve);
    expect(h.map((x) => x.id)).toEqual(['sw:e1']);
    circuitModule.finishHandle!(c!, 'sw:e1', ctx);
    expect(circuit()[0]!.props.parts[0]!.closed).toBe(true);
  });
});
