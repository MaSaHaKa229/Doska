import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { arcGeom, distToArc, ellipseGeom, polygonArea, regularPolygon } from './geometry';
import { ANGLE_TYPE, CPOINT_TYPE, POINT_TYPE, TICKS_TYPE, angleArc, figureType, fmt, measureText, type CPointProps, type FigureProps, type PointProps } from './objects';
import { geomOfId, isPointType } from './eval';
import { COMPASS_TYPE, PROTRACTOR_TYPE, RULER_TYPE } from './drafting';
import { nextLabels } from './tools';

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
  const doc = new Y.Doc();
  const model = new BoardModel(doc, { userId: T, registry, getCaps: caps, ownerId: T });
  model.addPage('Страница 1');
  const pageId = model.pages()[0]!.id;
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
    canModify: (id) => model.canModify(id, 'props'),
    canDelete: (id) => model.canDelete(id),
    publishDrawing: () => undefined,
    listObjects: (type) => model.pageObjects(pageId).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o && (!type || o.type === type)),
    guides: () => model.pageObjects(pageId).flatMap((id) => { const e = model.get(id)!; return e.module?.guides?.(e.obj, model.resolve) ?? []; }),
    hitTest: (pt, tol) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o),
    setSelection: (ids) => (selection = ids),
    getSelection: () => selection,
    setPreview: (p) => (preview = p),
    getPreview: <P,>() => preview as P | null,
    activateTool: () => undefined,
    getToolOptions: <O,>() => ({ ...useBoard.getState().toolOptions, polygonSides: 4 }) as O,
    screenToWorld: (px) => px,
  };
  return { model, ctx, pageId, selected: () => selection };
}

const ev = (x: number, y: number, refId?: string): ToolPointerEvent => ({
  world: { x, y },
  snapped: { x, y },
  snap: refId ? { kind: 'anchor', point: { x, y }, refId } : null,
  pressure: 0.5,
  pointerType: 'mouse',
  modifiers: { shift: false, alt: false, ctrl: false },
  timeStamp: 0,
});

/** Щелчки инструментом по точкам. */
function clicks(tool: string, ctx: ToolContext, pts: [number, number][]) {
  const t = registry.getTool(`math.planimetry.${tool}`)!;
  t.onActivate?.(ctx);
  for (const [x, y] of pts) {
    t.onPointerDown?.(ev(x, y), ctx);
    t.onPointerUp?.(ev(x, y), ctx);
  }
}

const ofType = (model: BoardModel, pageId: string, type: string) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === type);

describe('геометрия', () => {
  it('правильный многоугольник, дуга, эллипс', () => {
    const sq = regularPolygon({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(sq[2]!.x).toBeCloseTo(10);
    expect(sq[2]!.y).toBeCloseTo(-10);
    expect(polygonArea(sq)).toBeCloseTo(100);
    const g = arcGeom({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 });
    expect(g.sweep).toBeCloseTo(Math.PI / 2);
    expect(distToArc({ x: 7.07, y: -7.07 }, g)).toBeCloseTo(0, 1);
    expect(distToArc({ x: -10, y: 0 }, g)).toBeCloseTo(Math.SQRT2 * 10, 1);
    const e = ellipseGeom({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 3, y: 8 });
    expect([e.rx, e.ry]).toEqual([20, 8]);
  });

  it('подписи точек: A…Z, затем A₁', () => {
    expect(nextLabels(['A', 'C'], 3)).toEqual(['B', 'D', 'E']);
    const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    expect(nextLabels(all, 2)).toEqual(['A₁', 'B₁']);
  });
});

describe('построения и зависимости', () => {
  it('отрезок двумя щелчками: две точки A и B и отрезок — один шаг отмены', () => {
    const { model, ctx, pageId, selected } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const pts = ofType(model, pageId, POINT_TYPE);
    const [seg] = ofType(model, pageId, figureType('segment'));
    expect(pts.map((p) => (p.props as PointProps).label)).toEqual(['A', 'B']);
    expect(seg!.deps).toEqual(pts.map((p) => p.id));
    expect(selected()).toEqual([seg!.id]);
    expect(model.boundsOf([seg!.id])!.width).toBeGreaterThanOrEqual(100);
    model.undo.undo();
    expect(model.pageObjects(pageId)).toHaveLength(0);
  });

  it('фигура перестраивается при перемещении точки, точку можно взять поверх отрезка', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const [a, b] = ofType(model, pageId, POINT_TYPE);
    const [seg] = ofType(model, pageId, figureType('segment'));
    // Под курсором в точке B — сначала сама точка.
    expect(model.hitTest(pageId, { x: 100, y: 0 }, 4)[0]).toBe(b!.id);
    model.updateObjects([{ id: b!.id, patch: { x: 100, y: 200 } }]);
    expect(model.boundsOf([seg!.id])!.height).toBeGreaterThanOrEqual(200);
    expect(model.hitTest(pageId, { x: 50, y: 100 }, 4)).toContain(seg!.id);
    // Перемещение отрезка — это перемещение его свободных точек.
    expect(model.movableSet([seg!.id]).sort()).toEqual([a!.id, b!.id].sort());
    expect(model.dependentsOf([a!.id])).toEqual([seg!.id]);
  });

  it('щелчок по существующей точке использует её: треугольник на общих вершинах', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const [a, b] = ofType(model, pageId, POINT_TYPE);
    const tool = registry.getTool('math.planimetry.polygon')!;
    for (const [x, y, ref] of [[0, 0, a!.id], [100, 0, b!.id], [50, -80, undefined], [0, 0, a!.id]] as const) {
      tool.onPointerDown!(ev(x, y, ref), ctx);
      tool.onPointerUp!(ev(x, y, ref), ctx);
    }
    const [poly] = ofType(model, pageId, figureType('polygon'));
    const pts = ofType(model, pageId, POINT_TYPE);
    expect(pts.map((p) => (p.props as PointProps).label)).toEqual(['A', 'B', 'C']);
    expect(poly!.deps).toEqual(pts.map((p) => p.id));
    expect(model.dependentsOf([a!.id]).length).toBe(2);
  });

  it('правильный многоугольник по стороне, окружность, дуга, эллипс', () => {
    const { model, ctx, pageId } = setup();
    clicks('regular-polygon', ctx, [[0, 0], [50, 0]]);
    clicks('circle', ctx, [[300, 0], [340, 0]]);
    clicks('arc', ctx, [[0, 300], [60, 300], [0, 240]]);
    clicks('ellipse', ctx, [[400, 300], [480, 300], [400, 260]]);
    const reg = ofType(model, pageId, figureType('regular-polygon'))[0]!;
    expect((reg.props as FigureProps).n).toBe(4);
    expect(model.boundsOf([reg.id])!.height).toBeGreaterThanOrEqual(50);
    const circle = ofType(model, pageId, figureType('circle'))[0]!;
    expect(model.boundsOf([circle.id])!.width).toBeGreaterThanOrEqual(80);
    expect(model.hitTest(pageId, { x: 300, y: 40 }, 3)).toContain(circle.id);
    const arc = ofType(model, pageId, figureType('arc'))[0]!;
    expect(model.hitTest(pageId, { x: 42.4, y: 257.6 }, 3)).toContain(arc.id);
    expect(model.hitTest(pageId, { x: -60, y: 300 }, 3)).not.toContain(arc.id);
    const ell = ofType(model, pageId, figureType('ellipse'))[0]!;
    expect(model.boundsOf([ell.id])!.height).toBeGreaterThanOrEqual(80);
  });

  it('прямая видна при любой области; ломаная завершается Enter', () => {
    const { model, ctx, pageId } = setup();
    clicks('line', ctx, [[0, 0], [10, 0]]);
    const [line] = ofType(model, pageId, figureType('line'));
    expect(model.queryRect(pageId, { x: 5000, y: -5, width: 10, height: 10 })).toContain(line!.id);
    const tool = registry.getTool('math.planimetry.polyline')!;
    clicks('polyline', ctx, [[0, 100], [50, 150], [100, 100]]);
    expect(tool.onKeyDown!('Enter', { shift: false, alt: false, ctrl: false }, ctx)).toBe(true);
    expect(ofType(model, pageId, figureType('polyline'))[0]!.deps).toHaveLength(3);
  });

  it('удаление построения уносит его автоточки, удаление точки — с построениями', () => {
    const { model, ctx, pageId } = setup();
    clicks('point', ctx, [[500, 500]]);
    const free = ofType(model, pageId, POINT_TYPE)[0]!;
    expect((free.props as PointProps).auto).toBe(false);
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const seg = ofType(model, pageId, figureType('segment'))[0]!;
    model.deleteObjects([seg.id]);
    expect(ofType(model, pageId, POINT_TYPE).map((p) => p.id)).toEqual([free.id]);
    clicks('circle', ctx, [[0, 0], [30, 0]]);
    const [c] = ofType(model, pageId, POINT_TYPE).filter((p) => p.id !== free.id);
    const circle = ofType(model, pageId, figureType('circle'))[0]!;
    model.deleteObjects([c!.id, ...model.dependentsOf([c!.id])]);
    expect(model.getObject(circle.id)).toBeUndefined();
  });

  it('построение без опоры рисуется по запасным координатам', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const [a] = ofType(model, pageId, POINT_TYPE);
    const seg = ofType(model, pageId, figureType('segment'))[0]!;
    // Другой участник удалил опору: напрямую, без каскада.
    model.transact(() => model.objectsMap.delete(a!.id));
    expect(model.boundsOf([seg.id])!.width).toBeGreaterThanOrEqual(100);
    expect(model.getObject(seg.id)).toBeDefined();
  });

  it('копирование отрезка копирует и его точки, вставка сдвигает точки', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    const seg = ofType(model, pageId, figureType('segment'))[0]!;
    const data = model.serialize([seg.id]);
    expect(data.map((o) => o.type).sort()).toEqual([POINT_TYPE, POINT_TYPE, figureType('segment')].sort());
    model.paste(data, pageId, { x: 0, y: 50 });
    const segs = ofType(model, pageId, figureType('segment'));
    expect(segs).toHaveLength(2);
    const copy = segs.find((s) => s.id !== seg.id)!;
    expect(copy.deps.every((d) => !seg.deps.includes(d))).toBe(true);
    expect(model.boundsOf([copy.id])!.y).toBeGreaterThan(40);
  });
});

// =====================================================================
//  6.1b
// =====================================================================

const geom = (model: BoardModel, id: string) => geomOfId(id, model.resolve);
const pos = (model: BoardModel, id: string) => {
  const g = geom(model, id);
  if (g?.kind !== 'point') throw new Error('не точка: ' + id);
  return g.p;
};
const byLabel = (model: BoardModel, pageId: string, label: string) =>
  model.pageObjects(pageId).map((id) => model.getObject(id)!).find((o) => isPointType(o.type) && (o.props as PointProps).label === label)!;

/** Треугольник A(0,0) B(120,0) C(0,90) — прямоугольный, гипотенуза 150. */
function triangle() {
  const env = setup();
  clicks('polygon', env.ctx, [[0, 0], [120, 0], [0, 90], [0, 0]]);
  const tri = ofType(env.model, env.pageId, figureType('polygon'))[0]!;
  return { ...env, tri, A: byLabel(env.model, env.pageId, 'A'), B: byLabel(env.model, env.pageId, 'B'), C: byLabel(env.model, env.pageId, 'C') };
}

describe('6.1b: зависимые точки', () => {
  it('пересечение двух прямых следует за точками', () => {
    const { model, ctx, pageId } = setup();
    clicks('line', ctx, [[0, 0], [100, 100]]);
    clicks('line', ctx, [[0, 100], [100, 0]]);
    clicks('intersection', ctx, [[50, 50]]);
    const [x] = ofType(model, pageId, CPOINT_TYPE);
    expect(pos(model, x!.id)).toEqual({ x: 50, y: 50 });
    const b = byLabel(model, pageId, 'B');
    model.updateObjects([{ id: b.id, patch: { x: 100, y: 0 } }]);
    // Первая прямая теперь y = 0 → пересечение со второй в (100, 0).
    expect(pos(model, x!.id).x).toBeCloseTo(100);
    expect(pos(model, x!.id).y).toBeCloseTo(0);
    // Параллельные — точки нет, объект остаётся и вернётся.
    model.updateObjects([{ id: b.id, patch: { x: 100, y: -100 } }]);
    expect(geom(model, x!.id)).toBeNull();
  });

  it('пересечение прямой и окружности выбором двух линий — обе точки', () => {
    const { model, ctx, pageId } = setup();
    clicks('circle', ctx, [[0, 0], [50, 0]]);
    clicks('line', ctx, [[-100, 0], [-90, 0]]);
    const circle = ofType(model, pageId, figureType('circle'))[0]!;
    const line = ofType(model, pageId, figureType('line'))[0]!;
    const tool = registry.getTool('math.planimetry.intersection')!;
    tool.onActivate!(ctx);
    // По окружности (вверху) и по прямой (вдали от пересечений).
    tool.onPointerDown!(ev(0, -50), ctx);
    tool.onPointerDown!(ev(200, 0), ctx);
    const pts = ofType(model, pageId, CPOINT_TYPE).map((o) => pos(model, o.id));
    expect(pts.map((p) => Math.round(p.x)).sort((a, b) => a - b)).toEqual([-50, 50]);
    expect(ofType(model, pageId, CPOINT_TYPE).every((o) => o.deps.join() === [circle.id, line.id].join())).toBe(true);
  });

  it('середина отрезка щелчком по отрезку; точка на окружности тянется вдоль неё', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    clicks('midpoint', ctx, [[30, 0]]);
    const m = ofType(model, pageId, CPOINT_TYPE)[0]!;
    expect((m.props as CPointProps).label).toBe('M');
    expect(pos(model, m.id)).toEqual({ x: 50, y: 0 });
    clicks('circle', ctx, [[300, 0], [340, 0]]);
    clicks('point-on', ctx, [[300, -40]]);
    const on = ofType(model, pageId, CPOINT_TYPE).find((o) => (o.props as CPointProps).kind === 'on')!;
    expect(pos(model, on.id).y).toBeCloseTo(-40);
    const mod = registry.getObjectModule(CPOINT_TYPE)!;
    const patch = mod.dragHandle!(model.getObject(on.id)!, 't', { x: 400, y: 0 }, { shift: false, alt: false, ctrl: false }, model.resolve)!;
    model.updateObjects([{ id: on.id, patch }]);
    expect(pos(model, on.id).x).toBeCloseTo(340);
    expect(pos(model, on.id).y).toBeCloseTo(0);
  });

  it('замечательные точки треугольника щелчком по нему', () => {
    const { model, ctx, pageId } = triangle();
    for (const t of ['centroid', 'orthocenter', 'incenter', 'circumcenter']) clicks(t, ctx, [[60, 0.5]]);
    const get = (kind: string) => ofType(model, pageId, CPOINT_TYPE).find((o) => (o.props as CPointProps).kind === kind)!;
    expect(pos(model, get('centroid').id)).toEqual({ x: 40, y: 30 });
    // Прямоугольный треугольник: ортоцентр — вершина прямого угла, центр описанной — середина гипотенузы.
    expect(pos(model, get('orthocenter').id).x).toBeCloseTo(0);
    expect(pos(model, get('orthocenter').id).y).toBeCloseTo(0);
    expect(pos(model, get('circumcenter').id)).toEqual({ x: 60, y: 45 });
    // r = (a + b − c) / 2 = (120 + 90 − 150) / 2 = 30.
    expect(pos(model, get('incenter').id).x).toBeCloseTo(30);
    expect(['M', 'H', 'I', 'O']).toEqual(['centroid', 'orthocenter', 'incenter', 'circumcenter'].map((k) => (get(k).props as CPointProps).label));
  });
});

describe('6.1b: построения', () => {
  it('перпендикуляр и параллельная через точку', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 50]]);
    clicks('perpendicular', ctx, [[200, 200], [50, 25]]);
    clicks('parallel', ctx, [[200, 200], [50, 25]]);
    const perp = geom(model, ofType(model, pageId, figureType('perpendicular'))[0]!.id)!;
    const par = geom(model, ofType(model, pageId, figureType('parallel'))[0]!.id)!;
    if (perp.kind !== 'linear' || par.kind !== 'linear') throw new Error('не прямая');
    const d = (g: { a: { x: number; y: number }; b: { x: number; y: number } }) => ({ x: g.b.x - g.a.x, y: g.b.y - g.a.y });
    expect(d(perp).x * 100 + d(perp).y * 50).toBeCloseTo(0);
    expect(d(par).x * 50 - d(par).y * 100).toBeCloseTo(0);
    // Обе через одну и ту же новую точку C.
    expect(ofType(model, pageId, POINT_TYPE)).toHaveLength(3);
  });

  it('касательные из внешней точки: две, точка касания на окружности', () => {
    const { model, ctx, pageId } = setup();
    clicks('circle', ctx, [[0, 0], [30, 0]]);
    clicks('tangent', ctx, [[100, 0], [0, -30]]);
    const tans = ofType(model, pageId, figureType('tangent'));
    expect(tans).toHaveLength(2);
    for (const t of tans) {
      const g = geom(model, t.id)!;
      if (g.kind !== 'linear') throw new Error('не прямая');
      expect(Math.hypot(g.b.x, g.b.y)).toBeCloseTo(30);
      // Радиус в точку касания перпендикулярен касательной.
      expect((g.b.x - g.a.x) * g.b.x + (g.b.y - g.a.y) * g.b.y).toBeCloseTo(0);
    }
  });

  it('медиана, высота, вписанная и описанная окружности', () => {
    const { model, ctx, pageId } = triangle();
    clicks('median', ctx, [[0, 90], [0, 0], [120, 0]]);
    clicks('altitude', ctx, [[0, 0], [120, 0], [0, 90]]);
    clicks('incircle', ctx, [[60, 0.5]]);
    clicks('circumcircle', ctx, [[60, 0.5]]);
    const med = geom(model, ofType(model, pageId, figureType('median'))[0]!.id)!;
    const alt = geom(model, ofType(model, pageId, figureType('altitude'))[0]!.id)!;
    const inc = geom(model, ofType(model, pageId, figureType('incircle'))[0]!.id)!;
    const circ = geom(model, ofType(model, pageId, figureType('circumcircle'))[0]!.id)!;
    expect(med.kind === 'linear' && med.b).toEqual({ x: 60, y: 0 });
    // Высота из A на гипотенузу BC: длина = 120·90/150 = 72.
    expect(alt.kind === 'linear' && Math.hypot(alt.b.x - alt.a.x, alt.b.y - alt.a.y)).toBeCloseTo(72);
    expect(inc.kind === 'circle' && inc.r).toBeCloseTo(30);
    expect(circ.kind === 'circle' && circ.r).toBeCloseTo(75);
    // Нет новых точек: использованы вершины треугольника.
    expect(ofType(model, pageId, POINT_TYPE)).toHaveLength(3);
  });

  it('удаление вершины уносит всю цепочку построений', () => {
    const { model, ctx, pageId, A } = triangle();
    clicks('circumcenter', ctx, [[60, 0.5]]);
    const o = ofType(model, pageId, CPOINT_TYPE)[0]!;
    clicks('circle', ctx, [[60, 45], [0, 0]]);
    expect(model.dependentsOf([A.id]).length).toBeGreaterThanOrEqual(3);
    model.deleteObjects([A.id, ...model.dependentsOf([A.id])]);
    expect(model.getObject(o.id)).toBeUndefined();
    expect(ofType(model, pageId, figureType('circle'))).toHaveLength(0);
  });
});

describe('6.1b: преобразования', () => {
  it('осевая симметрия треугольника: вершины A′B′C′, образ следует за оригиналом', () => {
    const { model, ctx, pageId, tri, B } = triangle();
    clicks('line', ctx, [[200, -100], [200, 100]]);
    const axis = ofType(model, pageId, figureType('line'))[0]!;
    ctx.setSelection([]);
    const tool = registry.getTool('math.planimetry.reflect-line')!;
    tool.onActivate!(ctx);
    tool.onPointerDown!(ev(60, 0.5), ctx);
    tool.onPointerDown!(ev(200, 0), ctx);
    const imgs = ofType(model, pageId, figureType('polygon')).filter((o) => o.id !== tri.id);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.deps.map((d) => (model.getObject(d)!.props as CPointProps).label)).toEqual(['A′', 'B′', 'C′']);
    const b1 = byLabel(model, pageId, 'B′');
    expect(pos(model, b1.id)).toEqual({ x: 280, y: 0 });
    model.updateObjects([{ id: B.id, patch: { x: 150, y: 0 } }]);
    expect(pos(model, b1.id).x).toBeCloseTo(250);
    expect(axis.deps).toHaveLength(2);
  });

  it('поворот выделенного отрезка на 90°, гомотетия окружности с k = 2, перенос на вектор', () => {
    const { model, ctx, pageId, selected } = setup();
    clicks('segment', ctx, [[100, 0], [200, 0]]);
    const seg = selected()[0]!;
    // Выделение до выбора инструмента — источник; щелчок — центр поворота (новая точка).
    useBoard.getState().setToolOptions({ rotateAngle: 90 } as never, false);
    const rot = registry.getTool('math.planimetry.rotate')!;
    rot.onActivate!(ctx);
    rot.onPointerDown!(ev(0, 0), ctx);
    const segs = ofType(model, pageId, figureType('segment')).filter((o) => o.id !== seg);
    expect(segs).toHaveLength(1);
    const g = geom(model, segs[0]!.id)!;
    // Против часовой стрелки на экране (ось y вниз): (100, 0) → (0, −100).
    expect(g.kind === 'linear' && Math.round(g.a.x)).toBe(0);
    expect(g.kind === 'linear' && Math.round(g.a.y)).toBe(-100);

    clicks('circle', ctx, [[500, 0], [520, 0]]);
    const circle = selected()[0]!;
    useBoard.getState().setToolOptions({ homothetyK: 2 } as never, false);
    const hom = registry.getTool('math.planimetry.homothety')!;
    hom.onActivate!(ctx);
    hom.onPointerDown!(ev(500, 200), ctx);
    const circles = ofType(model, pageId, figureType('circle')).filter((o) => o.id !== circle);
    const cg = geom(model, circles[0]!.id)!;
    expect(cg.kind === 'circle' && cg.r).toBeCloseTo(40);

    clicks('vector', ctx, [[0, 300], [30, 340]]);
    ctx.setSelection([]);
    const tr = registry.getTool('math.planimetry.translate')!;
    tr.onActivate!(ctx);
    tr.onPointerDown!(ev(150, 0), ctx); // исходный отрезок
    tr.onPointerDown!(ev(15, 320), ctx); // вектор
    const moved = ofType(model, pageId, figureType('segment')).map((o) => geom(model, o.id)!).find((x) => x.kind === 'linear' && Math.round(x.a.x) === 130);
    expect(moved && moved.kind === 'linear' && Math.round(moved.a.y)).toBe(40);
  });

  it('образ построения (перпендикуляра) — фигура «образ»', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    clicks('perpendicular', ctx, [[50, 50], [20, 0]]);
    const perp = ofType(model, pageId, figureType('perpendicular'))[0]!;
    ctx.setSelection([perp.id]);
    const tool = registry.getTool('math.planimetry.reflect-point')!;
    tool.onActivate!(ctx);
    tool.onPointerDown!(ev(100, 50), ctx);
    const img = ofType(model, pageId, figureType('image'))[0]!;
    const g = geom(model, img.id)!;
    expect(g.kind === 'linear' && Math.round(g.a.x)).toBe(150);
  });
});

describe('6.1b: отметки и измерения', () => {
  it('отметка угла: величина и прямой угол', () => {
    const { model, ctx, pageId, B } = triangle();
    clicks('angle-mark', ctx, [[120, 0], [0, 0], [0, 90]]);
    const mark = ofType(model, pageId, ANGLE_TYPE)[0]!;
    const [a, b, c] = mark.deps.map((d) => pos(model, d));
    expect(angleArc(a!, b!, c!, false).deg).toBeCloseTo(90);
    model.updateObjects([{ id: B.id, patch: { x: 120, y: 90 } }]);
    const [a2, b2, c2] = mark.deps.map((d) => pos(model, d));
    // Угол между (120, 90) и (0, 90): cos = 0,6.
    expect(angleArc(a2!, b2!, c2!, false).deg).toBeCloseTo(53.13, 1);
    expect(angleArc(a2!, b2!, c2!, true).deg).toBeCloseTo(306.87, 1);
    expect(model.hitTest(pageId, { x: 10, y: 20 }, 3)).toContain(mark.id);
  });

  it('штрихи равенства на отрезке и инструмент «Размер»', () => {
    const { model, ctx, pageId } = setup();
    clicks('segment', ctx, [[0, 0], [100, 0]]);
    clicks('equal-ticks', ctx, [[30, 0]]);
    const ticks = ofType(model, pageId, TICKS_TYPE)[0]!;
    expect(ticks.deps).toEqual([ofType(model, pageId, figureType('segment'))[0]!.id]);
    const seg = ofType(model, pageId, figureType('segment'))[0]!;
    clicks('measure', ctx, [[70, 0]]);
    expect((model.getObject(seg.id)!.props as FigureProps).measure).toBe(true);
    const g = geom(model, seg.id)!;
    expect(g.kind !== 'point' && measureText(g)).toBe('5');
    expect(measureText({ kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }], closed: true })).toBe('S = 2');
    expect(fmt(2.345)).toBe('2,35');
  });
});

// =====================================================================
//  6.1c: чертёжные инструменты
// =====================================================================

const M0 = { shift: false, alt: false, ctrl: false };

describe('6.1c: линейка, транспортир, циркуль', () => {
  it('линейка: ставится щелчком, одна на странице, поворачивается ручкой, перо идёт вдоль края', () => {
    const { model, ctx, pageId } = setup();
    const place = registry.getTool(`${RULER_TYPE}-tool`)!;
    place.onPointerDown!(ev(0, 0), ctx);
    place.onPointerDown!(ev(100, 100), ctx);
    const rulers = ofType(model, pageId, RULER_TYPE);
    expect(rulers).toHaveLength(1);
    expect([rulers[0]!.x, rulers[0]!.y]).toEqual([100, 100]);
    // Поворот на 90°: ручку тянем вниз от нуля линейки.
    const mod = registry.getObjectModule(RULER_TYPE)!;
    const h = mod.getHandles(model.getObject(rulers[0]!.id)!, model.resolve)[0]!;
    const patch = mod.dragHandle!(model.getObject(rulers[0]!.id)!, h.id, { x: 100 - 28, y: 100 + 386 }, { ...M0, shift: true }, model.resolve)!;
    expect(patch.rotation).toBeCloseTo(Math.PI / 2);
    model.updateObjects([{ id: rulers[0]!.id, patch }]);
    // Край линейки теперь вертикален (x = 100, от y = 100 до 500); штрих рядом с ним — ровный.
    const pen = registry.getTool('core.pen')!;
    pen.onPointerDown!({ ...ev(105, 150), pressure: 0.5 }, ctx);
    for (let i = 1; i <= 10; i++) pen.onPointerMove!({ ...ev(105 + (i % 3) * 4, 150 + i * 20), pressure: 0.5 }, ctx);
    pen.onPointerUp!({ ...ev(108, 350), pressure: 0.5 }, ctx);
    const [stroke] = ofType(model, pageId, 'core.stroke');
    const xs = (stroke!.props as { points: number[] }).points.filter((_, i) => i % 3 === 0).map((x) => x + stroke!.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
    expect(Math.abs(xs[0]! - 100)).toBeLessThan(0.5);
  });

  it('транспортир: луч показывает угол по шкале с учётом поворота', () => {
    const { model, ctx, pageId } = setup();
    registry.getTool(`${PROTRACTOR_TYPE}-tool`)!.onPointerDown!(ev(0, 0), ctx);
    const [pr] = ofType(model, pageId, PROTRACTOR_TYPE);
    const mod = registry.getObjectModule(PROTRACTOR_TYPE)!;
    const ray = mod.dragHandle!(model.getObject(pr!.id)!, 'ray', { x: Math.cos(Math.PI / 6) * 100, y: -Math.sin(Math.PI / 6) * 100 }, M0, model.resolve)!;
    expect((ray.props as { ray: number }).ray).toBe(30);
    model.updateObjects([{ id: pr!.id, patch: { rotation: Math.PI / 2 } }]);
    // Повёрнут на 90° по часовой: направление «вправо» на экране — 90° по шкале.
    const ray2 = mod.dragHandle!(model.getObject(pr!.id)!, 'ray', { x: 100, y: 0 }, M0, model.resolve)!;
    expect((ray2.props as { ray: number }).ray).toBe(90);
  });

  it('циркуль: раствор по точке, полный оборот — окружность, полуоборот — дуга', () => {
    const { model, ctx, pageId } = setup();
    clicks('point', ctx, [[0, 0]]);
    const [center] = ofType(model, pageId, POINT_TYPE);
    registry.getTool(`${COMPASS_TYPE}-tool`)!.onPointerDown!(ev(0, 0), ctx);
    const [c] = ofType(model, pageId, COMPASS_TYPE);
    const mod = registry.getObjectModule(COMPASS_TYPE)!;
    const step = (handle: string, to: { x: number; y: number }) => {
      const patch = mod.dragHandle!(model.getObject(c!.id)!, handle, to, M0, model.resolve)!;
      model.updateObjects([{ id: c!.id, patch }], { merge: true });
    };
    step('pencil', { x: 60, y: 0 });
    expect((model.getObject(c!.id)!.props as { r: number }).r).toBe(60);
    // Полный оборот ручкой вращения (шагами по 30°).
    const knobAt = (deg: number) => {
      const o = model.getObject(c!.id)!;
      const k = mod.getHandles(o, model.resolve).find((h) => h.id === 'knob')!.position;
      const r = Math.hypot(k.x, k.y);
      const a = Math.atan2(k.y, k.x) + (deg * Math.PI) / 180;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    };
    for (let i = 0; i < 12; i++) step('knob', knobAt(-30));
    model.transact(() => mod.finishHandle!(model.getObject(c!.id)!, 'knob', ctx));
    const [circle] = ofType(model, pageId, figureType('circle'));
    expect(circle!.deps[0]).toBe(center!.id);
    const g = geom(model, circle!.id)!;
    expect(g.kind === 'circle' && g.r).toBeCloseTo(60);
    expect((model.getObject(c!.id)!.props as { drawn: number }).drawn).toBe(0);
    // Полуоборот — дуга с невидимыми концами.
    for (let i = 0; i < 6; i++) step('knob', knobAt(30));
    model.transact(() => mod.finishHandle!(model.getObject(c!.id)!, 'knob', ctx));
    const [arc] = ofType(model, pageId, figureType('arc'));
    const ag = geom(model, arc!.id)!;
    expect(ag.kind === 'arc' && ag.g.sweep).toBeCloseTo(Math.PI, 1);
    const ends = arc!.deps.slice(1).map((d) => model.getObject(d)!.props as PointProps);
    expect(ends.every((p) => p.ghost)).toBe(true);
    expect(model.hitTest(pageId, { x: model.getObject(arc!.deps[1]!)!.x, y: model.getObject(arc!.deps[1]!)!.y }, 2).some((id) => id === arc!.deps[1])).toBe(false);
  });
});
