import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { arcGeom, distToArc, ellipseGeom, polygonArea, regularPolygon } from './geometry';
import { POINT_TYPE, figureType, type FigureProps, type PointProps } from './objects';
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
    hitTest: (pt, tol) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o),
    setSelection: (ids) => (selection = ids),
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
