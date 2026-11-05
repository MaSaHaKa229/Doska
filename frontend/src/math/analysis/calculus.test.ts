import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { loadMath, parseCurve } from './expr';
import { AXES_TYPE, CURVE_TYPE, SLIDER_TYPE, type CurveProps } from './plot';
import { axesModule, sliderModule } from './objects';
import { derivativeAt, extrema, fourier, graphOf, integrate, riemann, roots, taylor } from './calculus';
import { epsDelta, lineEq, taylorText } from './features';

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

/** Оси x ∈ [−8; 8], y ∈ [−6; 6] (480×360 в начале координат) и график. */
function graph(text: string, sliders: Record<string, number> = {}) {
  const model = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: caps, ownerId: T });
  model.addPage('Страница 1');
  const pageId = model.pages()[0]!.id;
  let curve = '';
  model.transact(() => {
    const axes = model.createObject(AXES_TYPE, { pageId, x: 0, y: 0, props: axesModule.createProps() })!;
    const ids = Object.entries(sliders).map(([name, value], i) =>
      model.createObject(SLIDER_TYPE, { pageId, x: 0, y: 400 + i * 60, props: { ...sliderModule.createProps(), name, value } })!,
    );
    const props: CurveProps = { text, color: 'accent-3', width: 2, dash: 'solid', showLabel: true, tMin: 0, tMax: 6.28 };
    curve = model.createObject(CURVE_TYPE, { pageId, x: 0, y: 0, props, deps: [axes, ...ids] })!;
  });
  return { model, pageId, curve, g: graphOf(curve, model.resolve)! };
}

beforeAll(async () => {
  await loadMath();
});

describe('6.2b: численный анализ', () => {
  it('нули, экстремумы, касания и разрывы', () => {
    const f = (x: number) => x * x - 4;
    expect(roots(f, -8, 8).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-2, 2]);
    expect(roots((x) => x * x, -8, 8).map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0]);
    // 1/x меняет знак в разрыве, но корня нет.
    expect(roots((x) => 1 / x, -8, 8)).toEqual([]);
    const e = extrema((x) => x ** 3 - 3 * x, -8, 8);
    expect(e.map((p) => [Math.round(p.x * 1e4) / 1e4, p.kind])).toEqual([
      [-1, 'max'],
      [1, 'min'],
    ]);
  });

  it('интеграл, суммы Римана, Фурье', () => {
    expect(integrate((x) => x * x, 0, 3)).toBeCloseTo(9, 8);
    const left = riemann((x) => x * x, 0, 2, 4, 'left');
    expect(left.sum).toBeCloseTo(0.5 * (0 + 0.25 + 1 + 2.25), 10);
    expect(riemann((x) => x * x, 0, 2, 4, 'trap').sum).toBeCloseTo(2.75, 10);
    expect(riemann((x) => x * x, 0, 2, 100, 'mid').sum).toBeCloseTo(8 / 3, 3);
    // Ряд Фурье f(x) = x на [−π; π]: bₖ = 2(−1)^{k+1}/k.
    const s = fourier((x) => x, -Math.PI, Math.PI, 3);
    expect(s.a0).toBeCloseTo(0, 6);
    expect(s.bk.map((b) => Math.round(b * 1000) / 1000)).toEqual([2, -1, 0.667]);
  });

  it('производная символьно, касательная и Тейлор', () => {
    const { g } = graph('y = sin(x)');
    expect(derivativeAt(g, 0)).toBeCloseTo(1, 10);
    expect(derivativeAt(g, Math.PI)).toBeCloseTo(-1, 10);
    const t = taylor(g, 0, 5)!;
    expect(t.coeffs.map((c) => Math.round(c * 1e6) / 1e6 + 0)).toEqual([0, 1, 0, -0.166667, 0, 0.008333]);
    expect(t.p(0.5)).toBeCloseTo(Math.sin(0.5), 5);
    expect(taylorText(t.coeffs, 0)).toBe('x − 0,167x^3 + 0,00833x^5');
    expect(lineEq(2, -3)).toBe('y = 2x − 3');
    expect(lineEq(-1, 0)).toBe('y = −x');
    expect(lineEq(0, 0)).toBe('y = 0');
  });

  it('параметры слайдеров входят в функцию графика', () => {
    const { g, model, pageId, curve } = graph('y = a·x^2 + b', { a: 2, b: -8 });
    expect(roots(g.f, -8, 8).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-2, 2]);
    expect(derivativeAt(g, 1)).toBeCloseTo(4, 10);
    // Неравенство — не функция: анализ на нём не строится.
    model.updateObjects([{ id: curve, patch: { props: { text: 'y > x' } } }]);
    expect(graphOf(curve, model.resolve)).toBeNull();
    expect(pageId).toBeTruthy();
  });

  it('ε-δ: условие выполняется при малом δ и нарушается при большом', () => {
    const f = (x: number) => x * x;
    const r = epsDelta(f, { x0: 1, eps: 0.5, delta: 0.2, color: 'ink' })!;
    expect(r.L).toBeCloseTo(1, 10);
    expect(r.holds).toBe(true);
    expect(epsDelta(f, { x0: 1, eps: 0.5, delta: 0.5, color: 'ink' })!.holds).toBe(false);
  });
});

describe('6.2b: объекты и инструменты', () => {
  const ev = (x: number, y: number) => ({ world: { x, y }, snapped: { x, y }, snap: null, pressure: 0.5, pointerType: 'mouse' as const, modifiers: { shift: false, alt: false, ctrl: false }, timeStamp: 0 });
  function ctxFor(model: BoardModel, pageId: string) {
    let preview: unknown = null;
    let selection: string[] = [];
    return {
      userId: T,
      pageId,
      canWrite: true,
      resolve: model.resolve,
      createObject: (type: string, init: { x: number; y: number; props: unknown; deps?: string[] }) => model.createObject(type, { ...init, pageId }) ?? '',
      updateObject: (id: string, patch: object) => void model.updateObjects([{ id, patch }]),
      deleteObjects: (ids: string[]) => void model.deleteObjects(ids),
      transact: (fn: () => void) => model.transact(fn),
      canModify: () => true,
      canDelete: () => true,
      publishDrawing: () => undefined,
      listObjects: () => [] as BoardObject[],
      guides: () => [],
      hitTest: (pt: { x: number; y: number }, tol: number) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)!),
      setSelection: (ids: string[]) => (selection = ids),
      getSelection: () => selection,
      setPreview: (p: unknown) => (preview = p),
      getPreview: () => preview as never,
      activateTool: () => undefined,
      getToolOptions: () => ({}) as never,
      screenToWorld: (px: number) => px,
    };
  }

  it('касательная щелчком по графику; точка на графике тянется ручкой', () => {
    const { model, pageId, curve } = graph('y = x^2 - 4');
    const ctx = ctxFor(model, pageId);
    // Точка (2; 0) графика: x = 240 + 2·30 = 300, y = (6 − 0)·30 = 180.
    registry.getTool('math.analysis.tangent')!.onPointerDown!(ev(300, 180), ctx as never);
    const tan = model.pageObjects(pageId).map((id) => model.getObject(id)!).find((o) => o.type === 'math.analysis.tangent')!;
    expect(tan.deps).toEqual([curve]);
    expect((tan.props as { x: number }).x).toBeCloseTo(2, 1);
    registry.getTool('math.analysis.graph-point')!.onPointerDown!(ev(300, 180), ctx as never);
    const pt = model.pageObjects(pageId).map((id) => model.getObject(id)!).find((o) => o.type === 'math.analysis.graph-point')!;
    const mod = registry.getObjectModule(pt.type)!;
    const patch = mod.dragHandle!(pt, 'x', { x: 330, y: 50 }, { shift: false, alt: false, ctrl: false }, model.resolve)!;
    expect((patch.props as { x: number }).x).toBeCloseTo(3, 6);
    // Объект анализа не двигается сам и не двигает график.
    expect(model.movableSet([tan.id])).toEqual([]);
  });

  it('пересечения двух графиков — двумя щелчками', () => {
    const { model, pageId, curve } = graph('y = x^2 - 4');
    let second = '';
    model.transact(() => {
      const props: CurveProps = { text: 'y = x - 2', color: 'accent-1', width: 2, dash: 'solid', showLabel: true, tMin: 0, tMax: 6.28 };
      second = model.createObject(CURVE_TYPE, { pageId, x: 0, y: 0, props, deps: [model.getObject(curve)!.deps[0]!] })!;
    });
    const ctx = ctxFor(model, pageId);
    const tool = registry.getTool('math.analysis.intersections')!;
    tool.onPointerDown!(ev(240, 300), ctx as never); // вершина параболы (0; −4)
    tool.onPointerDown!(ev(240 + 4 * 30, (6 - 2) * 30), ctx as never); // (4; 2) на прямой
    const it = model.pageObjects(pageId).map((id) => model.getObject(id)!).find((o) => o.type === 'math.analysis.intersections')!;
    expect(it.deps).toEqual([curve, second]);
    const g1 = graphOf(curve, model.resolve)!;
    const g2 = graphOf(second, model.resolve)!;
    expect(roots((x) => g1.f(x) - g2.f(x), -8, 8).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-1, 2]);
    expect(parseCurve('y = x - 2')).not.toHaveProperty('error');
  });
});
