import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { loadMath } from '../analysis/expr';
import { AXES_TYPE, SLIDER_TYPE } from '../analysis/plot';
import { axesModule, sliderModule } from '../analysis/objects';
import {
  APOINT_TYPE,
  CONIC_TYPE,
  LINE_TYPE,
  MEASURE_TYPE,
  VECOP_TYPE,
  VECTOR_TYPE,
  conicOf,
  lineOf,
  measureOf,
  vecResult,
  type MeasureProps,
  type VecOpProps,
  type VectorProps,
} from './objects';

const T = '11111111-1111-4111-8111-111111111111';
const caps = () =>
  computeCapabilities({
    user: { id: T, role: 'TEACHER' },
    board: { kind: 'LESSON', mode: 'COLLABORATIVE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
    memberRole: null,
    studentViaClass: false,
    teachesOwner: false,
    hasChalk: false,
  });

/** Оси 480×360 в начале координат: x ∈ [−8; 8], y ∈ [−6; 6], единица — 30. */
function setup() {
  const model = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: caps, ownerId: T });
  model.addPage('Страница 1');
  const pageId = model.pages()[0]!.id;
  const axes = model.createObject(AXES_TYPE, { pageId, x: 0, y: 0, props: axesModule.createProps() })!;
  let preview: unknown = null;
  let selection: string[] = [];
  const ctx: ToolContext = {
    userId: T,
    pageId,
    canWrite: true,
    resolve: model.resolve,
    createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
    updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
    deleteObjects: (ids) => void model.deleteObjects(ids),
    transact: (fn, opts) => model.transact(fn, opts),
    canModify: () => true,
    canDelete: () => true,
    publishDrawing: () => undefined,
    listObjects: (type) => model.pageObjects(pageId).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o && (!type || o.type === type)),
    guides: () => [],
    hitTest: (pt, tol) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)!),
    setSelection: (ids) => (selection = ids),
    getSelection: () => selection,
    setPreview: (p) => (preview = p),
    getPreview: <P,>() => preview as P | null,
    activateTool: () => undefined,
    getToolOptions: <O,>() => useBoard.getState().toolOptions as O,
    screenToWorld: (px) => px,
  };
  const W = (X: number, Yv: number) => ({ x: 240 + X * 30, y: 180 - Yv * 30 });
  const ev = (X: number, Yv: number) => ({ world: W(X, Yv), snapped: W(X, Yv), snap: null, pressure: 0.5, pointerType: 'mouse' as const, modifiers: { shift: false, alt: false, ctrl: false }, timeStamp: 0 });
  const make = (type: string, props: object, deps: string[] = []) => model.createObject(type, { pageId, x: 0, y: 0, props: { ...(registry.getObjectModule(type)!.createProps() as object), ...props }, deps: [axes, ...deps] })!;
  const all = (type: string) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === type);
  return { model, pageId, axes, ctx, W, ev, make, all };
}

beforeAll(async () => {
  await loadMath();
});

describe('6.3a: объекты', () => {
  it('прямая по уравнению: попадание по линии, параметр из слайдера', () => {
    const { model, pageId, make, W } = setup();
    const s = model.createObject(SLIDER_TYPE, { pageId, x: 0, y: 500, props: { ...sliderModule.createProps(), name: 'k', value: 2 } })!;
    const line = make(LINE_TYPE, { text: 'y = k·x - 1' }, [s]);
    const l = lineOf(model.getObject(line)!, model.resolve);
    expect(l).toEqual({ A: -2, B: 1, C: 1 });
    expect(model.hitTest(pageId, W(1, 1), 2)).toContain(line);
    expect(model.hitTest(pageId, W(1, 3), 2)).not.toContain(line);
    model.updateObjects([{ id: s, patch: { props: { value: 0 } } }]);
    expect(model.hitTest(pageId, W(3, -1), 2)).toContain(line);
  });

  it('кривая второго порядка: эллипс выбирается по линии', () => {
    const { model, pageId, make, W } = setup();
    const c = make(CONIC_TYPE, { text: 'x^2/25 + y^2/9 = 1' });
    const k = conicOf(model.getObject(c)!, model.resolve);
    expect(k && !('error' in k) && k.kind).toBe('ellipse');
    expect(model.hitTest(pageId, W(5, 0), 2)).toContain(c);
    expect(model.hitTest(pageId, W(0, 3), 2)).toContain(c);
    expect(model.hitTest(pageId, W(0, 0), 2)).not.toContain(c);
  });

  it('действия с векторами и измерения', () => {
    const a: VectorProps = { X0: 0, Y0: 0, X: 3, Y: 1, name: 'a', color: 'ink', showCoords: true };
    const b: VectorProps = { X0: 0, Y0: 0, X: 1, Y: 2, name: 'b', color: 'ink', showCoords: true };
    expect(vecResult('sum', a, b, 1)).toEqual({ v: { x: 4, y: 3 }, text: 'a + b(4; 3), |a + b| = 5' });
    expect(vecResult('diff', a, b, 1).v).toEqual({ x: 2, y: -1 });
    expect(vecResult('scale', a, null, -2).text).toBe('−2a(−6; −2)');
    expect(vecResult('dot', a, b, 1).text).toBe('a·b = 3·1 + 1·2 = 5;  φ = 45°');
    const { model, make } = setup();
    const p = make(APOINT_TYPE, { X: 0, Y: 0, label: 'M' });
    const l = make(LINE_TYPE, { text: '3x + 4y - 25 = 0' });
    const m = make(MEASURE_TYPE, { kind: 'dist' }, [p, l]);
    expect(measureOf(model.getObject(m) as BoardObject<MeasureProps>, model.resolve)!.text).toBe('d = |3·0 + 4·0 − 25| / √(3² + 4²) = 5');
    model.updateObjects([{ id: p, patch: { props: { X: -2, Y: -3 } } }]);
    expect(measureOf(model.getObject(m) as BoardObject<MeasureProps>, model.resolve)!.text).toBe('d = |3·(−2) + 4·(−3) − 25| / √(3² + 4²) = 8,6');
    const l2 = make(LINE_TYPE, { text: 'y = 0' });
    const ang = make(MEASURE_TYPE, { kind: 'angle' }, [l, l2]);
    expect(measureOf(model.getObject(ang) as BoardObject<MeasureProps>, model.resolve)!.text).toMatch(/^φ = 36,87°, пересечение \(8,33; 0\)$/);
  });
});

describe('6.3a: инструменты', () => {
  it('точка по координатам с привязкой к половинам, тянется ручкой', () => {
    const { model, ctx, ev, all, W } = setup();
    registry.getTool('math.analytic.point')!.onPointerDown!(ev(2.1, -0.9), ctx);
    const [p] = all(APOINT_TYPE);
    expect([p!.props.X, p!.props.Y, p!.props.label]).toEqual([2, -1, 'M']);
    const mod = registry.getObjectModule(APOINT_TYPE)!;
    const patch = mod.dragHandle!(p!, 'p', W(3.4, 1.6), { shift: false, alt: false, ctrl: false }, model.resolve)!;
    expect(patch.props).toEqual({ X: 3.5, Y: 1.5 });
    expect(model.movableSet([p!.id])).toEqual([]);
  });

  it('вектор протяжкой, сумма двумя щелчками', () => {
    const { ctx, ev, all, model } = setup();
    const vt = registry.getTool('math.analytic.vector')!;
    vt.onPointerDown!(ev(0, 0), ctx);
    vt.onPointerMove!(ev(3, 1), ctx);
    vt.onPointerUp!(ev(3, 1), ctx);
    vt.onPointerDown!(ev(0, 0), ctx);
    vt.onPointerMove!(ev(1, 2), ctx);
    vt.onPointerUp!(ev(1, 2), ctx);
    const vs = all(VECTOR_TYPE);
    expect(vs.map((v) => [(v.props as VectorProps).name, v.props.X, v.props.Y])).toEqual([
      ['a', 3, 1],
      ['b', 1, 2],
    ]);
    const sum = registry.getTool('math.analytic.vector-sum')!;
    sum.onActivate!(ctx);
    sum.onPointerDown!(ev(1.5, 0.5), ctx);
    sum.onPointerDown!(ev(0.5, 1), ctx);
    const [op] = all(VECOP_TYPE);
    expect((op!.props as VecOpProps).op).toBe('sum');
    expect(op!.deps.slice(1)).toEqual(vs.map((v) => v.id));
    expect(model.getObject(op!.id)).toBeDefined();
  });
});
