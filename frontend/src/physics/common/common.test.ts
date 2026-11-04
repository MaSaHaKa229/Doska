import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type EditorContext, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { CELL, fmt, plainLabel, splitLabel, vectorValues } from './quantities';
import { SUM_TYPE, VECTOR_TYPE, components, sumGeom, valueText, vectorModule, type SumProps, type VectorProps } from './vectors';
import { AXES_TYPE, SCALE_TYPE, axesAngleDeg, physAxesModule, scaleText, type ScaleProps } from './axes';
import { BODY_TYPE, SUPPORT_TYPE, physBodyModule, supportModule } from './bodies';
import { applyScale } from './editor';

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
  let preview: unknown = null;
  let selection: string[] = [];
  let tool = '';
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
    activateTool: (id) => (tool = id),
    getToolOptions: <O,>() => useBoard.getState().toolOptions as O,
    screenToWorld: (px) => px,
  };
  const ev = (x: number, y: number, shift = false): ToolPointerEvent => ({ world: { x, y }, snapped: { x, y }, snap: null, pressure: 0.5, pointerType: 'mouse', modifiers: { shift, alt: false, ctrl: false }, timeStamp: 0 });
  const all = (type: string) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === type);
  const toolById = (id: string) => registry.getTool(id)!;
  return { model, pageId, ctx, ev, all, toolById, tool: () => tool, selection: () => selection };
}

/** Протяжка инструментом вектора. */
function drag(s: ReturnType<typeof setup>, toolId: string, from: [number, number], to: [number, number], shift = false) {
  const t = s.toolById(toolId);
  t.onPointerDown!(s.ev(...from), s.ctx);
  t.onPointerMove!(s.ev(...to, shift), s.ctx);
  t.onPointerUp!(s.ev(...to, shift), s.ctx);
}

describe('величины', () => {
  it('модуль и проекции по масштабу; повёрнутые оси', () => {
    // 3 клетки вправо и 4 вверх при 2 Н в клетке: 10 Н, Fx = 6, Fy = 8.
    const v = vectorValues(3 * CELL, -4 * CELL, 2, 0);
    expect(v.len).toBeCloseTo(10);
    expect(v.x).toBeCloseTo(6);
    expect(v.y).toBeCloseTo(8);
    // Ось x повёрнута на 30°: вектор вдоль неё — только x-проекция.
    const along = vectorValues(Math.cos(Math.PI / 6) * 100, -Math.sin(Math.PI / 6) * 100, CELL, 30);
    expect(along.x).toBeCloseTo(100);
    expect(along.y).toBeCloseTo(0);
  });

  it('обозначения с индексом и запись чисел', () => {
    expect(splitLabel('F_тр')).toEqual({ main: 'F', sub: 'тр' });
    expect(plainLabel('F_тр', 'x')).toBe('Fтрx');
    expect(fmt(-2.5)).toBe('−2,5');
    expect(valueText({ q: 'force', label: 'F_упр', perCell: 2 }, 6)).toBe('Fупр = 6 Н');
    expect(scaleText({ q: 'velocity', perCell: 0.5 })).toBe('v: 1 клетка — 0,5 м/с');
  });

  it('составляющие вектора по осям складываются в сам вектор', () => {
    const p: VectorProps = { ...vectorModule.createProps(), dx: 70, dy: -30, axisAngle: 25 };
    const { cx, cy } = components(p);
    expect(cx.x + cy.x).toBeCloseTo(70);
    expect(cx.y + cy.y).toBeCloseTo(-30);
    // Составляющие перпендикулярны.
    expect(cx.x * cy.x + cx.y * cy.y).toBeCloseTo(0);
  });
});

describe('плагин physics.common', () => {
  it('зарегистрирован: 6 типов объектов, 16 инструментов в подразделе', () => {
    for (const t of [VECTOR_TYPE, SUM_TYPE, BODY_TYPE, SUPPORT_TYPE, AXES_TYPE, SCALE_TYPE]) expect(registry.getObjectModule(t)).toBeTruthy();
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.common.'))).toHaveLength(16);
    expect(registry.search('сила трения').some((r) => r.title.includes('сила'))).toBe(true);
  });
});

describe('векторы', () => {
  it('сила протяжкой: обозначение F, цвет, значение по масштабу страницы', () => {
    const s = setup();
    applyScale(s.ctx as EditorContext, null, { x: 0, y: 300 }, 'force', 2);
    drag(s, 'physics.common.force', [100, 100], [160, 20]);
    const [v] = s.all(VECTOR_TYPE) as BoardObject<VectorProps>[];
    expect(v!.props).toMatchObject({ q: 'force', label: 'F', color: 'accent-1', dx: 60, dy: -80, perCell: 2 });
    expect(vectorValues(v!.props.dx, v!.props.dy, v!.props.perCell, 0).len).toBeCloseTo(10);
    expect(s.selection()).toEqual([v!.id]);
  });

  it('Shift — угол кратен 15°; щелчок без протяжки — 4 клетки вправо', () => {
    const s = setup();
    drag(s, 'physics.common.velocity', [0, 0], [100, -48], true);
    drag(s, 'physics.common.velocity', [0, 200], [2, 201]);
    const [a, b] = s.all(VECTOR_TYPE) as BoardObject<VectorProps>[];
    expect((Math.atan2(-a!.props.dy, a!.props.dx) * 180) / Math.PI).toBeCloseTo(30);
    expect([b!.props.dx, b!.props.dy]).toEqual([80, 0]);
  });

  it('привязка к сетке — целые клетки от точки приложения, даже если она не на сетке', () => {
    const s = setup();
    const t = s.toolById('physics.common.force');
    t.onPointerDown!({ ...s.ev(400, 395), snap: { kind: 'center', point: { x: 400, y: 395 } } }, s.ctx);
    // Сетка подвинула бы конец в (400, 460); получаем 3 клетки: (400, 455).
    t.onPointerUp!({ ...s.ev(401, 452), snapped: { x: 400, y: 460 } }, s.ctx);
    const [v] = s.all(VECTOR_TYPE) as BoardObject<VectorProps>[];
    expect([v!.props.dx, v!.props.dy]).toEqual([0, 60]);
  });

  it('ручки: конец (Shift — 15°) и точка приложения (конец остаётся на месте)', () => {
    const o = { id: 'v', type: VECTOR_TYPE, x: 10, y: 10, rotation: 0, scaleX: 1, scaleY: 1, props: { ...vectorModule.createProps(), dx: 40, dy: 0 } } as unknown as BoardObject<VectorProps>;
    const r = {} as never;
    const tip = vectorModule.dragHandle!(o, 'tip', { x: 110, y: 12 }, { shift: true, alt: false, ctrl: false }, r)!.props!;
    expect(tip.dx).toBeCloseTo(100, 1);
    expect(tip.dy).toBeCloseTo(0, 9);
    const p = vectorModule.dragHandle!(o, 'tail', { x: 30, y: 30 }, { shift: false, alt: false, ctrl: false }, r)!;
    expect(p).toEqual({ x: 30, y: 30, props: { dx: 20, dy: -20 } });
  });

  it('новый масштаб пересчитывает все векторы величины на странице одним шагом отмены; второй масштаб не ставится', () => {
    const s = setup();
    drag(s, 'physics.common.force', [0, 0], [60, 0]);
    drag(s, 'physics.common.force', [0, 100], [0, 40]);
    drag(s, 'physics.common.velocity', [0, 200], [60, 200]);
    const id = applyScale(s.ctx as EditorContext, null, { x: 0, y: 0 }, 'force', 5);
    expect((s.all(VECTOR_TYPE) as BoardObject<VectorProps>[]).map((v) => v.props.perCell)).toEqual([5, 5, 0]);
    expect(applyScale(s.ctx as EditorContext, null, { x: 0, y: 0 }, 'force', 3)).toBe(id);
    expect(s.all(SCALE_TYPE)).toHaveLength(1);
    expect((s.all(SCALE_TYPE)[0]!.props as ScaleProps).perCell).toBe(3);
    s.model.undo.undo();
    expect((s.all(VECTOR_TYPE) as BoardObject<VectorProps>[]).map((v) => v.props.perCell)).toEqual([5, 5, 0]);
  });

  it('проекции: щелчок по вектору — оси ближайших повёрнутых осей, повторный — убрать', () => {
    const s = setup();
    s.ctx.createObject(AXES_TYPE, { x: 0, y: 0, props: physAxesModule.createProps(), rotation: -Math.PI / 6 });
    drag(s, 'physics.common.force', [20, 20], [100, 20]);
    const t = s.toolById('physics.common.decompose');
    t.onPointerDown!(s.ev(60, 20), s.ctx);
    let [v] = s.all(VECTOR_TYPE) as BoardObject<VectorProps>[];
    expect(v!.props.decompose).toBe(true);
    expect(v!.props.axisAngle).toBe(30);
    expect(axesAngleDeg({ rotation: -Math.PI / 6 })).toBe(30);
    t.onPointerDown!(s.ev(60, 20), s.ctx);
    [v] = s.all(VECTOR_TYPE) as BoardObject<VectorProps>[];
    expect(v!.props.decompose).toBe(false);
  });
});

describe('сумма векторов', () => {
  it('общая точка приложения — параллелограмм; Enter создаёт сумму', () => {
    const s = setup();
    drag(s, 'physics.common.force', [0, 0], [60, 0]);
    drag(s, 'physics.common.force', [0, 0], [0, -80]);
    s.ctx.setSelection([]);
    const t = s.toolById('physics.common.sum');
    t.onActivate!(s.ctx);
    t.onPointerDown!(s.ev(40, 0), s.ctx);
    t.onPointerDown!(s.ev(0, -40), s.ctx);
    expect(t.onKeyDown!('Enter', { shift: false, alt: false, ctrl: false }, s.ctx)).toBe(true);
    const [sum] = s.all(SUM_TYPE) as BoardObject<SumProps>[];
    const g = sumGeom(sum!, s.model.resolve)!;
    expect(g.tip).toEqual({ x: 60, y: -80 });
    expect(g.guides).toHaveLength(2);
    expect(s.tool()).toBe('core.select');
  });

  it('разные точки приложения — правило многоугольника; выделенные заранее складываются сразу', () => {
    const s = setup();
    drag(s, 'physics.common.force', [0, 0], [60, 0]);
    drag(s, 'physics.common.force', [200, 0], [200, 40]);
    drag(s, 'physics.common.force', [300, 0], [280, 0]);
    s.ctx.setSelection(s.all(VECTOR_TYPE).map((v) => v.id));
    s.toolById('physics.common.sum').onActivate!(s.ctx);
    const [sum] = s.all(SUM_TYPE) as BoardObject<SumProps>[];
    const g = sumGeom(sum!, s.model.resolve)!;
    expect(g.tip).toEqual({ x: 40, y: 40 });
    expect(g.copies).toHaveLength(2);
    // Удаление слагаемого — сумма зависит от него (вместе с ним).
    expect(s.model.dependentsOf([s.all(VECTOR_TYPE)[0]!.id])).toEqual([sum!.id]);
  });
});

describe('тела, опоры, оси', () => {
  it('брусок щелчком по опоре встаёт на неё нижней гранью; точки приложения сил', () => {
    const s = setup();
    const sup = s.ctx.createObject(SUPPORT_TYPE, { x: 0, y: 100, props: supportModule.createProps() });
    expect(supportModule.getSnapCurves!(s.model.getObject(sup) as never, s.model.resolve)).toHaveLength(1);
    const e = { ...s.ev(120, 100), snap: { kind: 'midpoint' as const, point: { x: 120, y: 100 } } };
    s.toolById('physics.common.block').onPointerDown!(e, s.ctx);
    const [b] = s.all(BODY_TYPE);
    expect([b!.x, b!.y]).toEqual([120, 75]);
    const pts = physBodyModule.getSnapPoints!(b as never, s.model.resolve).map((p) => [p.kind, p.point.x, p.point.y]);
    expect(pts).toContainEqual(['center', 120, 75]);
    expect(pts).toContainEqual(['midpoint', 120, 100]);
    expect(pts).toHaveLength(9);
  });

  it('растяжение тела меняет размеры, а не масштаб', () => {
    const o = { props: physBodyModule.createProps() } as BoardObject<ReturnType<typeof physBodyModule.createProps>>;
    expect(physBodyModule.applyResize!(o, 2, 0.5)).toEqual({ scaleX: 1, scaleY: 1, props: { w: 160, h: 25 } });
  });
});
