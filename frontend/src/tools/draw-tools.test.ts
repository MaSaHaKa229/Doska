import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext, type ToolPointerEvent } from '@doska/shared';
import { BoardModel } from '../collab/model';
import { registry } from '../plugins/registry';
import { useBoard } from '../store/board';
import { ERASER_TOOL_ID, MARKER_TOOL_ID, PEN_TOOL_ID, RECOGNIZE_HOLD_MS } from './draw-tools';
import type { StrokeProps } from '../objects/stroke/stroke';

const T = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

function caps(userId: string) {
  return computeCapabilities({
    user: { id: userId, role: userId === T ? 'TEACHER' : 'STUDENT' },
    board: { kind: 'LESSON', mode: 'COLLABORATIVE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
    memberRole: null,
    studentViaClass: userId !== T,
    teachesOwner: false,
    hasChalk: false,
  });
}

/** Контекст инструмента поверх модели — как в BoardStage, при масштабе zoom. */
function setup(userId = T, doc = new Y.Doc(), zoom = 1) {
  if (doc.getMap('pages').size === 0) {
    const t = new BoardModel(doc, { userId: T, registry, getCaps: () => caps(T), ownerId: T });
    t.addPage('Страница 1');
    t.destroy();
  }
  const model = new BoardModel(doc, { userId, registry, getCaps: () => caps(userId), ownerId: T });
  const pageId = model.pages()[0]!.id;
  let preview: unknown = null;
  const drawings: unknown[] = [];
  const ctx: ToolContext = {
    userId,
    pageId,
    canWrite: true,
    resolve: model.resolve,
    createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
    updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
    deleteObjects: (ids) => void model.deleteObjects(ids),
    transact: (fn, opts) => model.transact(fn, opts),
    canModify: (id) => model.canModify(id, 'props'),
    canDelete: (id) => model.canDelete(id),
    publishDrawing: (d) => drawings.push(d),
    hitTest: (pt, tol) => model.hitTest(pageId, pt, tol).map((id) => model.getObject(id)).filter((o): o is BoardObject => !!o),
    setSelection: () => undefined,
    setPreview: (p) => (preview = p),
    getPreview: <P,>() => preview as P | null,
    activateTool: () => undefined,
    getToolOptions: <O,>() => useBoard.getState().toolOptions as O,
    screenToWorld: (px) => px / zoom,
  };
  return { model, ctx, pageId, drawings, getPreview: () => preview };
}

const ev = (x: number, y: number, pressure = 0.5): ToolPointerEvent => ({
  world: { x, y },
  snapped: { x, y },
  snap: null,
  pressure,
  pointerType: 'pen',
  modifiers: { shift: false, alt: false, ctrl: false },
  timeStamp: 0,
});

function drag(tool: string, ctx: ToolContext, pts: [number, number][], holdMs = 0) {
  const t = registry.getTool(tool)!;
  t.onPointerDown!(ev(...pts[0]!), ctx);
  for (const p of pts.slice(1)) t.onPointerMove!(ev(...p), ctx);
  if (holdMs) vi.advanceTimersByTime(holdMs);
  t.onPointerUp!(ev(...pts[pts.length - 1]!), ctx);
}

const strokes = (m: BoardModel, pageId: string) =>
  m.pageObjects(pageId).map((id) => m.getObject(id)!).filter((o) => o.type === 'core.stroke') as BoardObject<StrokeProps>[];

describe('перо и маркер', () => {
  afterEach(() => {
    useBoard.getState().reset();
    vi.useRealTimers();
  });

  it('перо: штрих с нажатием в локальных координатах, толщина — в мировых единицах', () => {
    const { model, ctx, pageId, drawings } = setup(T, new Y.Doc(), 2);
    useBoard.getState().setToolOptions({ penWidth: 4, recognizeShapes: false }, false);
    drag(PEN_TOOL_ID, ctx, Array.from({ length: 30 }, (_, i) => [100 + i * 4, 50 + Math.sin(i / 3) * 20] as [number, number]));
    const [s] = strokes(model, pageId);
    expect(s).toBeDefined();
    expect(s!.props).toMatchObject({ kind: 'pen', pressure: true, opacity: 1, width: 2, color: 'ink' });
    expect(s!.x).toBeCloseTo(100, 0);
    expect(Math.min(...s!.props.points.filter((_, i) => i % 3 === 0))).toBe(0);
    expect(drawings.at(-1)).toBeNull(); // другие участники больше не видят недорисованный штрих
    expect(drawings.some((d) => d && (d as { points: number[] }).points.length > 3)).toBe(true);
  });

  it('маркер ложится под уже нарисованное', () => {
    const { model, ctx, pageId } = setup();
    useBoard.getState().setToolOptions({ recognizeShapes: false }, false);
    drag(PEN_TOOL_ID, ctx, [[0, 0], [50, 10], [100, 0]]);
    drag(MARKER_TOOL_ID, ctx, [[0, 5], [50, 5], [100, 5]]);
    const order = strokes(model, pageId).map((o) => o.props.kind);
    expect(order).toEqual(['marker', 'pen']);
    expect(strokes(model, pageId)[0]!.props).toMatchObject({ opacity: 0.35, pressure: false });
  });

  it('задержка пера превращает штрих в фигуру (повёрнутый прямоугольник — с поворотом), одним шагом отмены', () => {
    vi.useFakeTimers();
    const { model, ctx, pageId } = setup();
    const a = Math.PI / 6;
    const rot = (x: number, y: number): [number, number] => [300 + x * Math.cos(a) - y * Math.sin(a), 200 + x * Math.sin(a) + y * Math.cos(a)];
    const side = (x0: number, y0: number, x1: number, y1: number) => Array.from({ length: 15 }, (_, i) => rot(x0 + ((x1 - x0) * i) / 15, y0 + ((y1 - y0) * i) / 15));
    const pts = [...side(0, 0, 200, 0), ...side(200, 0, 200, 100), ...side(200, 100, 0, 100), ...side(0, 100, 0, 0), rot(0, 0)];
    drag(PEN_TOOL_ID, ctx, pts, RECOGNIZE_HOLD_MS + 50);
    const objs = model.pageObjects(pageId).map((id) => model.getObject(id)!);
    expect(objs).toHaveLength(1);
    expect(objs[0]!.type).toBe('core.shape');
    expect(objs[0]!.props).toMatchObject({ kind: 'rect' });
    expect(objs[0]!.rotation).toBeCloseTo(a, 1);
    model.undo.undo();
    expect(model.pageObjects(pageId)).toHaveLength(0);
  });

  it('без задержки фигура не распознаётся', () => {
    vi.useFakeTimers();
    const { model, ctx, pageId } = setup();
    drag(PEN_TOOL_ID, ctx, Array.from({ length: 30 }, (_, i) => [i * 10, 0] as [number, number]));
    expect(model.getObject(model.pageObjects(pageId)[0]!)!.type).toBe('core.stroke');
  });
});

describe('ластик', () => {
  afterEach(() => useBoard.getState().reset());

  it('по объектам: стирает задетое целиком, весь жест — один шаг отмены, чужое учительское не трогает', () => {
    const doc = new Y.Doc();
    const teacher = setup(T, doc);
    useBoard.getState().setToolOptions({ recognizeShapes: false }, false);
    drag(PEN_TOOL_ID, teacher.ctx, [[0, 100], [200, 100]]);
    const student = setup(S, doc);
    drag(PEN_TOOL_ID, student.ctx, [[0, 0], [200, 0]]);
    drag(PEN_TOOL_ID, student.ctx, [[0, 50], [200, 50]]);
    useBoard.getState().setToolOptions({ eraserMode: 'stroke', eraserSize: 20 }, false);
    // Вертикальный жест через все три линии.
    drag(ERASER_TOOL_ID, student.ctx, [[100, -20], [100, 30], [100, 70], [100, 120]]);
    const left = strokes(student.model, student.pageId);
    expect(left).toHaveLength(1);
    expect(left[0]!.createdBy).toBe(T);
    student.model.undo.undo();
    expect(strokes(student.model, student.pageId)).toHaveLength(3);
  });

  it('части штрихов: разрезает линию, первая часть остаётся тем же объектом', () => {
    const { model, ctx, pageId } = setup();
    useBoard.getState().setToolOptions({ recognizeShapes: false, eraserMode: 'pixel', eraserSize: 20 }, false);
    drag(PEN_TOOL_ID, ctx, [[0, 0], [100, 0], [200, 0]]);
    const id = strokes(model, pageId)[0]!.id;
    drag(ERASER_TOOL_ID, ctx, [[100, -30], [100, 30]]);
    const after = strokes(model, pageId);
    expect(after).toHaveLength(2);
    expect(after.some((o) => o.id === id)).toBe(true);
    const xs = after.map((o) => o.x + Math.max(...o.props.points.filter((_, i) => i % 3 === 0)));
    expect(Math.min(...xs)).toBeLessThan(91);
    // Фигуры попиксельный ластик не трогает.
    ctx.createObject('core.shape', { x: 50, y: 200, props: { kind: 'rect', w: 100, h: 50, stroke: 'ink', fill: 'none', strokeWidth: 2, dash: 'solid' } });
    drag(ERASER_TOOL_ID, ctx, [[50, 190], [50, 260]]);
    expect(model.pageObjects(pageId).map((i) => model.getObject(i)!.type)).toContain('core.shape');
  });
});
