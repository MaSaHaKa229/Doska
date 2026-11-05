import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type ToolContext } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { AXES_TYPE } from '../analysis/plot';
import { axesModule } from '../analysis/objects';
import { GAUSS_TYPE, MATRIX_TYPE, OP_TYPE, TRANSFORM_TYPE, gaussLayout, valueOf, type GaussProps, type MatrixProps } from './objects';
import { toStrings } from './linalg';

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
  const matrix = (name: string, rows: number, cols: number, cells: (number | string)[], x: number, y: number, augmented = false) =>
    model.createObject(MATRIX_TYPE, { pageId, x, y, props: { name, rows, cols, cells: cells.map(String), augmented, color: 'ink' } satisfies MatrixProps })!;
  const ev = (x: number, y: number) => ({ world: { x, y }, snapped: { x, y }, snap: null, pressure: 0.5, pointerType: 'mouse' as const, modifiers: { shift: false, alt: false, ctrl: false }, timeStamp: 0 });
  const all = (type: string) => model.pageObjects(pageId).map((id) => model.getObject(id)!).filter((o) => o.type === type);
  return { model, pageId, ctx, matrix, ev, all };
}

describe('6.3b: объекты', () => {
  it('произведение щелчками по двум матрицам — справа от второй, пересчёт при правке', () => {
    const { model, ctx, matrix, ev, all } = setup();
    const A = matrix('A', 2, 2, [1, 2, 3, 4], 0, 0);
    const B = matrix('B', 2, 2, [0, 1, 1, 0], 300, 0);
    const tool = registry.getTool('math.linalg.mul')!;
    tool.onActivate!(ctx);
    tool.onPointerDown!(ev(30, 20), ctx);
    tool.onPointerDown!(ev(330, 20), ctx);
    const [op] = all(OP_TYPE);
    expect(op!.deps).toEqual([A, B]);
    expect(op!.x).toBeGreaterThan(300 + 100);
    let v = valueOf(op!, model.resolve);
    expect('m' in v && v.name === 'A·B' && toStrings(v.m)).toEqual([['2', '1'], ['4', '3']]);
    model.updateObjects([{ id: B, patch: { props: { cells: ['1', '0', '0', '1'] } } }]);
    v = valueOf(model.getObject(op!.id)!, model.resolve);
    expect('m' in v && toStrings(v.m)).toEqual([['1', '2'], ['3', '4']]);
    // Удаление исходной матрицы уносит и результат (зависимость).
    expect(model.dependentsOf([A])).toEqual([op!.id]);
  });

  it('цепочка: определитель обратной; ошибка размеров', () => {
    const { model, ctx, matrix, ev, all } = setup();
    const A = matrix('A', 2, 2, [1, 2, 3, 4], 0, 0);
    const inv = model.createObject(OP_TYPE, { pageId: ctx.pageId, x: 0, y: 200, props: { op: 'inverse', k: '1', color: 'ink' }, deps: [A] })!;
    const d = model.createObject(OP_TYPE, { pageId: ctx.pageId, x: 0, y: 400, props: { op: 'det', k: '1', color: 'ink' }, deps: [inv] })!;
    const v = valueOf(model.getObject(d)!, model.resolve);
    expect('q' in v && [v.name, v.q.toString()]).toEqual(['det (A⁻¹)', '−1/2']);
    const C = matrix('C', 1, 3, [1, 2, 3], 0, 600);
    const tool = registry.getTool('math.linalg.add')!;
    tool.onActivate!(ctx);
    tool.onPointerDown!(ev(20, 20), ctx);
    tool.onPointerDown!(ev(20, 615), ctx);
    const sum = all(OP_TYPE).find((o) => (o.props as { op: string }).op === 'add')!;
    expect(valueOf(sum, model.resolve)).toMatchObject({ error: 'Размеры не совпадают: 2×2 и 1×3' });
    expect(C).toBeTruthy();
  });

  it('метод Гаусса для расширенной матрицы: шаги и ответ', () => {
    const { model, ctx, matrix, ev, all } = setup();
    matrix('S', 2, 3, [1, 1, 3, 2, -1, 0], 0, 0, true);
    registry.getTool('math.linalg.gauss')!.onPointerDown!(ev(30, 20), ctx);
    const [g] = all(GAUSS_TYPE);
    expect(g!.y).toBeGreaterThan(60);
    const L = gaussLayout(g as BoardObject<GaussProps>, model.resolve);
    expect(L.items).toHaveLength(3);
    expect(L.items[1]!.ops).toEqual(['R₂ − 2R₁ → R₂']);
    expect(L.answer).toBe('Единственное решение: x₁ = 1, x₂ = 2');
    expect(L.augAt).toBe(2);
  });

  it('линейное преобразование: ручки меняют столбцы, попадание по образу квадрата', () => {
    const { model, ctx, ev, all, pageId } = setup();
    model.createObject(AXES_TYPE, { pageId, x: 0, y: 0, props: axesModule.createProps() });
    registry.getTool('math.linalg.transform')!.onPointerDown!(ev(240, 180), ctx);
    const [t] = all(TRANSFORM_TYPE);
    // Сдвиг [[1, 1], [0, 1]]: образ точки (0,5; 0,5) квадрата — (1; 0,5) → (240 + 30, 180 − 15).
    expect(model.hitTest(pageId, { x: 270, y: 165 }, 2)).toContain(t!.id);
    expect(model.hitTest(pageId, { x: 300, y: 165 }, 2)).not.toContain(t!.id);
    const mod = registry.getObjectModule(TRANSFORM_TYPE)!;
    const patch = mod.dragHandle!(t!, 'i', { x: 240 + 2 * 30, y: 180 - 1 * 30 }, { shift: false, alt: false, ctrl: false }, model.resolve)!;
    expect(patch.props).toEqual({ a: 2, c: 1 });
  });
});
