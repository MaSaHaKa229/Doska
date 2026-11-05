import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { fmtNum, loadMath, niceStep, parseCurve, prepare } from './expr';
import { AXES_TYPE, CURVE_TYPE, SLIDER_TYPE, TABLE_TYPE, curveState, frameOf, type AxesProps, type CurveProps } from './plot';
import { parseSet, tableRows, trigValues, type SliderProps, type TableProps } from './objects';
import { axesAt, sliderIds } from './editor';

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

function setup() {
  const model = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: caps, ownerId: T });
  model.addPage('Страница 1');
  const pageId = model.pages()[0]!.id;
  let selection: string[] = [];
  let preview: unknown = null;
  const ctx: ToolContext = {
    userId: T,
    pageId,
    canWrite: true,
    resolve: model.resolve,
    createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
    updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
    deleteObjects: (ids) => void model.deleteObjects(ids),
    transact: (fn, opts) => model.transact(fn, opts),
    canModify: (id) => model.canModify(id, 'props'),
    canDelete: (id) => model.canDelete(id),
    publishDrawing: () => undefined,
    listObjects: (type) => model.pageObjects(pageId).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o && (!type || o.type === type)),
    guides: () => [],
    hitTest: (pt, tol) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o),
    setSelection: (ids) => (selection = ids),
    getSelection: () => selection,
    setPreview: (p) => (preview = p),
    getPreview: <P,>() => preview as P | null,
    activateTool: () => undefined,
    getToolOptions: <O,>() => useBoard.getState().toolOptions as O,
    screenToWorld: (px) => px,
  };
  return { model, ctx, pageId };
}

const ev = (x: number, y: number): ToolPointerEvent => ({
  world: { x, y },
  snapped: { x, y },
  snap: null,
  pressure: 0.5,
  pointerType: 'mouse',
  modifiers: { shift: false, alt: false, ctrl: false },
  timeStamp: 0,
});

/** Оси 480×360 с пределами x ∈ [−8; 8], y ∈ [−6; 6] в точке (0, 0) и график на них. */
function withCurve(text: string) {
  const env = setup();
  const { id: axes } = axesAt(env.ctx, null);
  env.model.updateObjects([{ id: axes, patch: { x: 0, y: 0 } }]);
  const a = env.model.getObject(axes)!;
  const parsed = parseCurve(text);
  if ('error' in parsed) throw new Error(parsed.error);
  let id = '';
  env.model.transact(() => {
    const sliders = sliderIds(env.ctx, frameOf(a).rect, parsed.params);
    const props: CurveProps = { text, color: 'accent-3', width: 2, dash: 'solid', showLabel: true, tMin: 0, tMax: Math.PI * 2 };
    id = env.ctx.createObject(CURVE_TYPE, { x: 0, y: 0, props, deps: [axes, ...sliders] });
  });
  return { ...env, axes, curve: id, a };
}

beforeAll(async () => {
  await loadMath();
});

describe('6.2a: запись графиков', () => {
  it('определяет вид кривой и параметры', () => {
    const kind = (t: string) => {
      const r = parseCurve(t);
      return 'error' in r ? r.error : `${r.kind}:${r.params.join(',')}`;
    };
    expect(kind('x^2 - 2x')).toBe('function:');
    expect(kind('y = a·sin(b·x)')).toBe('function:a,b');
    expect(kind('f(x) = 2x + k')).toBe('function:k');
    expect(kind('x² + y² = 25')).toBe('implicit:');
    expect(kind('y ≥ x^2 - 4')).toBe('inequality:');
    expect(kind('(3cos(t); 2sin(t))')).toBe('parametric:');
    expect(kind('r = 2(1 + cos(θ))')).toBe('polar:');
    expect(kind('y = = x')).toBe('Знак «=» встречается больше одного раза');
    expect(kind('y = (x')).toBe('Ошибка в записи');
    expect(prepare('2,5x + tg(x) − √x')).toBe('2.5x + tan(x) - sqrt(x)');
  });

  it('деления осей и числа', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(31)).toBe(50);
    expect(fmtNum(-2.5)).toBe('−2,5');
    expect(fmtNum(1 / 3)).toBe('0,3333');
  });
});

describe('6.2a: построение', () => {
  it('парабола: точки на графике в координатах доски', () => {
    const { model, curve } = withCurve('y = x^2 - 4');
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    if (!st.ok) throw new Error(st.reason);
    // Вершина (0; −4): x = 240, y = (6 − (−4)) · 30 = 300.
    const all = st.plot.lines.flat();
    const v = all.reduce((a, b) => (b.y > a.y ? b : a));
    expect(v.x).toBeCloseTo(240, 0);
    expect(v.y).toBeCloseTo(300, 0);
    expect(model.hitTest(model.pages()[0]!.id, { x: 240, y: 300 }, 3)).toContain(curve);
    expect(model.hitTest(model.pages()[0]!.id, { x: 100, y: 300 }, 3)).not.toContain(curve);
  });

  it('гипербола разрывается на асимптоте', () => {
    const { model, curve } = withCurve('y = 1/x');
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    expect(st.ok && st.plot.lines.length).toBe(2);
  });

  it('окружность x² + y² = 16 и неравенство с закраской', () => {
    const { model, curve, ctx } = withCurve('x^2 + y^2 = 16');
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    if (!st.ok) throw new Error(st.reason);
    const fr = st.frame;
    for (let k = 0; k < st.plot.segments.length; k += 2) {
      const m = fr.toMath({ x: st.plot.segments[k]!, y: st.plot.segments[k + 1]! });
      expect(Math.hypot(m.X, m.Y)).toBeCloseTo(4, 1);
    }
    model.updateObjects([{ id: curve, patch: { props: { text: 'y > x' } } }]);
    const st2 = curveState(model.getObject(curve) as BoardObject<CurveProps>, ctx.resolve);
    if (!st2.ok) throw new Error(st2.reason);
    expect(st2.plot.dashedBoundary).toBe(true);
    // Выше прямой y = x закрашено, ниже — нет.
    expect(model.hitTest(model.pages()[0]!.id, fr.toWorld(-4, 4), 1)).toContain(curve);
    expect(model.hitTest(model.pages()[0]!.id, fr.toWorld(4, -4), 1)).not.toContain(curve);
  });

  it('параметрическая и полярная кривые', () => {
    const { model, curve } = withCurve('(3cos(t); 2sin(t))');
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    if (!st.ok) throw new Error(st.reason);
    const m = st.plot.lines[0]!.map((p) => st.frame.toMath(p));
    expect(Math.max(...m.map((q) => q.X))).toBeCloseTo(3, 2);
    expect(Math.max(...m.map((q) => q.Y))).toBeCloseTo(2, 2);
    model.updateObjects([{ id: curve, patch: { props: { text: 'r = 2' } } }]);
    const st2 = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    expect(st2.ok && st2.plot.lines[0]!.every((p) => Math.abs(Math.hypot(st2.frame.toMath(p).X, st2.frame.toMath(p).Y) - 2) < 1e-6)).toBe(true);
  });

  it('параметры: слайдеры создаются и меняют график; перемещение графика двигает только оси', () => {
    const { model, curve, axes, pageId } = withCurve('y = a·x + b');
    const sliders = model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === SLIDER_TYPE);
    expect(sliders.map((s) => (s.props as SliderProps).name)).toEqual(['a', 'b']);
    expect(sliders[1]!.y).toBeGreaterThan(sliders[0]!.y);
    // Под осями (оси 480×360 в начале координат).
    expect(sliders[0]!.y).toBeGreaterThan(360);
    const b = sliders[1]!;
    // Ручка слайдера: шаг 0,1, пределы −5…5, дорожка 200.
    const mod = registry.getObjectModule(SLIDER_TYPE)!;
    const patch = mod.dragHandle!(b as BoardObject<never>, 'value', { x: b.x + 150, y: b.y }, { shift: false, alt: false, ctrl: false }, model.resolve)!;
    expect((patch.props as { value: number }).value).toBe(2.5);
    model.updateObjects([{ id: b.id, patch }]);
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    if (!st.ok) throw new Error(st.reason);
    // y = x + 2,5 при x = 0.
    const at0 = st.plot.lines[0]!.map((p) => st.frame.toMath(p)).find((q) => Math.abs(q.X) < 0.02)!;
    expect(at0.Y).toBeCloseTo(2.5, 1);
    expect(model.movableSet([curve])).toEqual([axes]);
    expect(model.dependentsOf([b.id])).toEqual([curve]);
  });

  it('нет слайдера — график не строится; инструмент «Слайдер» его подключает', () => {
    const { model, curve, ctx } = withCurve('y = x');
    model.updateObjects([{ id: curve, patch: { props: { text: 'y = k·x' } } }]);
    const st = curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve);
    expect(!st.ok && st.reason).toBe('нет слайдера: k');
    // Слайдеры a, b, c заняты не будут — инструмент даёт первое свободное имя; переименуем в k.
    const tool = registry.getTool('math.analysis.slider')!;
    for (const n of ['a', 'b', 'c']) model.createObject(SLIDER_TYPE, { pageId: ctx.pageId, x: 0, y: 900, props: { ...(registry.getObjectModule(SLIDER_TYPE)!.createProps() as object), name: n } });
    tool.onPointerDown!(ev(0, 1000), ctx);
    const k = model.pageObjects(ctx.pageId).map((id) => model.getObject(id)!).find((o) => o.type === SLIDER_TYPE && (o.props as SliderProps).name === 'k')!;
    expect(model.getObject(curve)!.deps).toContain(k.id);
    expect(curveState(model.getObject(curve) as BoardObject<CurveProps>, model.resolve).ok).toBe(true);
  });

  it('таблица значений функции', () => {
    const { model, ctx, curve, pageId } = withCurve('y = x^2');
    registry.getTool('math.analysis.table')!.onPointerDown!(ev(240, 300), ctx);
    const t = model.pageObjects(pageId).map((id) => model.getObject(id)!).find((o) => o.type === TABLE_TYPE)!;
    expect(t.deps).toEqual([curve]);
    const rows = tableRows(t as BoardObject<TableProps>, model.resolve);
    expect(Array.isArray(rows) && rows.map((r) => r.y)).toEqual([9, 4, 1, 0, 1, 4, 9]);
  });

  it('система координат: протяжкой — область, щелчком — стандартная; пределы по размеру', () => {
    const { model, ctx, pageId } = setup();
    const tool = registry.getTool('math.analysis.axes')!;
    tool.onPointerDown!(ev(0, 0), ctx);
    tool.onPointerMove!(ev(320, 160), ctx);
    tool.onPointerUp!(ev(320, 160), ctx);
    const [a] = model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === AXES_TYPE);
    const p = a!.props as AxesProps;
    expect([p.w, p.h, p.xMin, p.xMax, p.yMin, p.yMax]).toEqual([320, 160, -4, 4, -2, 2]);
    expect(frameOf(a!).toWorld(0, 0)).toEqual({ x: 160, y: 80 });
  });
});

describe('6.2a: числовая прямая и тригонометрическая окружность', () => {
  it('разбор множеств', () => {
    expect(parseSet('[-2; 3) ∪ (5; +∞)')).toEqual([
      { from: -2, to: 3, fromClosed: true, toClosed: false },
      { from: 5, to: Infinity, fromClosed: false, toClosed: false },
    ]);
    expect(parseSet('{1; 2,5}')).toEqual([
      { from: 1, to: 1, fromClosed: true, toClosed: true },
      { from: 2.5, to: 2.5, fromClosed: true, toClosed: true },
    ]);
    expect(parseSet('(3; 1)')).toEqual({ error: 'Не понял промежуток «(3; 1)»' });
  });

  it('значения функций угла и ручка с прилипанием к отметкам', () => {
    expect(trigValues(30).sin).toBeCloseTo(0.5);
    expect(Number.isNaN(trigValues(90).tan)).toBe(true);
    const { model, ctx, pageId } = setup();
    registry.getTool('math.analysis.trig')!.onPointerDown!(ev(0, 0), ctx);
    const t = model.pageObjects(pageId).map((id) => model.getObject(id)!)[0]!;
    const mod = registry.getObjectModule(t.type)!;
    // Почти 60° — прилипает к π/3.
    const a = (58.5 * Math.PI) / 180;
    const patch = mod.dragHandle!(t as BoardObject<never>, 'angle', { x: Math.cos(a) * 100, y: -Math.sin(a) * 100 }, { shift: false, alt: false, ctrl: false }, model.resolve)!;
    expect((patch.props as { angle: number }).angle).toBe(60);
  });
});
