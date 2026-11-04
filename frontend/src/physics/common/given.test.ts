import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { create, all } from 'mathjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardObject, type EditorContext } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { AXES_TYPE, CURVE_TYPE, type AxesProps } from '../../math/analysis/plot';
import { givenLayout, givenModule } from './given';
import { insertGraph, planGraph, type GraphPlan } from './graph';

const math = create(all!, { number: 'number' });
const T = '11111111-1111-4111-8111-111111111111';

describe('«Дано / Найти / Решение»', () => {
  it('столбцы: «Дано» с «Найти», СИ по строкам, решение и ответ с проверкой', () => {
    const L = givenLayout(givenModule.createProps(), math);
    expect(L.left).toEqual(['Дано:', 'm = 500 г', 'F = 2 Н', 'Найти:', 'a — ?']);
    expect(L.si).toEqual(['0,5 кг', null]);
    expect(L.right).toEqual(['Решение:', 'a = F/m', '', 'Ответ: a = 4 м/с²']);
    expect(L.answer?.ok).toBe(true);
    expect(L.sepAfter).toBe(2);
    expect(L.w2).toBeGreaterThan(0);
  });

  it('без math.js — те же строки, столбец СИ с запасом ширины; без единиц — без столбца СИ', () => {
    const L = givenLayout(givenModule.createProps(), null);
    expect(L.si).toEqual([null, null]);
    expect(L.answer).toBeNull();
    expect(L.w2).toBeGreaterThan(0);
    expect(givenLayout({ ...givenModule.createProps(), rows: [{ sym: 'n', value: '3', unit: '' }] }, math).w2).toBe(0);
  });
});

describe('график зависимости', () => {
  it('v(t) = 2 + 3t: подписи осей с единицами, запись для графика через x, пределы с нулём', () => {
    const p = planGraph(math, { ySym: 'v', yUnit: 'м/с', xSym: 't', xUnit: 'с', expr: '2 + 3t', from: '0', to: '10' }) as GraphPlan;
    expect(p.curve).toBe('y = 2 + 3x');
    expect([p.xLabel, p.yLabel]).toEqual(['t, с', 'v, м/с']);
    expect([p.xMin, p.xMax]).toEqual([0, 10]);
    expect(p.yMin).toBe(0);
    expect(p.yMax).toBeGreaterThanOrEqual(32);
    expect(p.latex).toBe('v(t) = 2 + 3t');
  });

  it('переменная заменяется только целым словом; ошибки по-русски', () => {
    const p = planGraph(math, { ySym: 'x', yUnit: 'м', xSym: 't', xUnit: 'с', expr: '2t + 0,5t²', from: '0', to: '4' }) as GraphPlan;
    expect(p.curve).toBe('y = 2x + 0.5x^2');
    expect(planGraph(math, { ySym: 'p', yUnit: 'кПа', xSym: 'V', xUnit: 'л', expr: '100/V', from: '1', to: '10' })).toMatchObject({ curve: 'y = 100/x' });
    expect(planGraph(math, { ySym: 'v', yUnit: '', xSym: 't', xUnit: '', expr: '2 + 3q', from: '0', to: '10' })).toEqual({ error: 'В записи — неизвестное имя (переменная — t)' });
    expect(planGraph(math, { ySym: 'v', yUnit: '', xSym: 't', xUnit: '', expr: '2t', from: '5', to: '1' })).toEqual({ error: 'Промежуток: «от» меньше «до»' });
    expect(planGraph(math, { ySym: 'v', yUnit: '', xSym: 'v', xUnit: '', expr: '2v', from: '0', to: '1' })).toEqual({ error: 'Величины по осям должны различаться' });
  });

  it('вставка: оси с подписями, график на них и подпись — одним шагом отмены', () => {
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
    const ctx = {
      userId: T,
      pageId,
      canWrite: true,
      resolve: model.resolve,
      createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
      updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
      deleteObjects: (ids) => void model.deleteObjects(ids),
      transact: (fn, opts) => model.transact(fn, opts),
      canModify: () => true,
      listObjects: () => [],
      setSelection: () => undefined,
      getToolOptions: <O,>() => ({}) as O,
    } as EditorContext;
    const plan = planGraph(math, { ySym: 'v', yUnit: 'м/с', xSym: 't', xUnit: 'с', expr: '2 + 3t', from: '0', to: '10' }) as GraphPlan;
    const axes = insertGraph(ctx, plan, { x: 300, y: 200 });
    const objs = model.pageObjects(pageId).map((id) => model.getObject(id)!) as BoardObject[];
    expect(objs.map((o) => o.type).sort()).toEqual([AXES_TYPE, CURVE_TYPE, 'core.formula'].sort());
    expect((model.getObject(axes)!.props as AxesProps).xLabel).toBe('t, с');
    expect(objs.find((o) => o.type === CURVE_TYPE)!.deps).toEqual([axes]);
    model.undo.undo();
    expect(model.pageObjects(pageId)).toHaveLength(0);
  });
});
