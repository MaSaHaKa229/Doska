import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { create, all } from 'mathjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type ActionContext, type BoardObject } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { differentiate, loadMath } from '../../math/analysis/expr';
import { compileLaw, sample, throwInfo, tickStep, velocity } from './kinematics';
import { PLAY0, playAction, timeAt } from './playback';
import { MOTION_TYPE, THROW_TYPE, motionGeom, motionModule, throwModule, type MotionProps, type ThrowProps } from './objects';

const math = create(all!, { number: 'number' });
const T = '11111111-1111-4111-8111-111111111111';
beforeAll(() => loadMath());

describe('кинематика', () => {
  it('закон движения по школьной записи; скорость разностью', () => {
    const law = compileLaw(math, '2t + 0,5t²', '0');
    if ('error' in law) throw new Error(law.error);
    expect(law.x(2)).toBeCloseTo(6);
    expect(velocity(law, 2).vx).toBeCloseTo(4, 6);
    expect(compileLaw(math, '2q', '0')).toEqual({ error: 'В записи x(t) — неизвестное имя (время — t)' });
    expect(compileLaw(math, '2t', '(')).toEqual({ error: 'Ошибка в записи y(t)' });
  });

  it('движение по окружности: |v| = ωR', () => {
    const law = compileLaw(math, '3cos(2t)', '3sin(2t)');
    if ('error' in law) throw new Error(law.error);
    const v = velocity(law, 0.7);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(6, 5);
    expect(sample(law, 3.14, 10)).toHaveLength(11);
  });

  it('бросок под углом 45° со скоростью 10 м/с: T, H, L по формулам', () => {
    const i = throwInfo({ v0: 10, angle: 45, h0: 0, g: 9.8 });
    expect(i.T).toBeCloseTo((2 * 10 * Math.SQRT1_2) / 9.8, 9);
    expect(i.H).toBeCloseTo(100 / 4 / 9.8, 9);
    expect(i.L).toBeCloseTo(100 / 9.8, 9);
    expect(i.law.y(i.T)).toBeCloseTo(0, 9);
  });

  it('горизонтальный бросок с высоты 20 м: T = √(2h/g)', () => {
    const i = throwInfo({ v0: 5, angle: 0, h0: 20, g: 10 });
    expect(i.T).toBeCloseTo(2, 9);
    expect(i.L).toBeCloseTo(10, 9);
    expect(i.H).toBe(20);
  });

  it('шаг делений оси — 1, 2, 5, 10…', () => {
    expect(tickStep(20)).toBe(2);
    expect(tickStep(50)).toBe(1);
    expect(tickStep(3)).toBe(20);
  });

  it('производная записи для графика скорости', () => {
    expect(differentiate('2 + 3*t', 't')).toBe('3');
    expect(differentiate('2*t + 0.5*t^2', 't')).toMatch(/^(2 \+ t|t \+ 2)$/);
  });
});

describe('воспроизведение', () => {
  it('время идёт от момента пуска со скоростью показа и останавливается в конце', () => {
    const p = { running: true, t0: 1, at: 1000 };
    expect(timeAt(p, 5, 1, 3000)).toBe(3);
    expect(timeAt(p, 5, 2, 2000)).toBe(3);
    expect(timeAt(p, 5, 1, 99_000)).toBe(5);
    expect(timeAt({ ...p, running: false }, 5, 1, 99_000)).toBe(1);
  });

  it('пуск, пауза на текущем времени, в конце — заново; «Сначала»', () => {
    const started = playAction('toggle', PLAY0, 5, 1, 1000)!;
    expect(started).toEqual({ running: true, t0: 0, at: 1000 });
    expect(playAction('toggle', started, 5, 1, 3500)).toEqual({ running: false, t0: 2.5, at: 3500 });
    expect(playAction('toggle', started, 5, 1, 60_000)).toEqual({ running: true, t0: 0, at: 60_000 });
    expect(playAction('reset', started, 5, 1, 4000)).toEqual({ running: false, t0: 0, at: 4000 });
  });
});

describe('объекты механики', () => {
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
    const ctx = (now: number): ActionContext => ({
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
      now,
    });
    return { model, pageId, ctx };
  }

  it('плагин: 2 объекта, 2 инструмента, кнопки на панели свойств', () => {
    expect(registry.listTools().filter((t) => t.id.startsWith('physics.mechanics.'))).toHaveLength(2);
    expect(motionModule.inspector!.filter((f) => f.kind === 'action').map((f) => f.key)).toEqual(['toggle', 'reset', 'graphs']);
  });

  it('кнопка «Пуск» пишет момент пуска, «Пуск» ещё раз — пауза на текущем времени', () => {
    const { model, pageId, ctx } = setup();
    const id = model.createObject(THROW_TYPE, { pageId, x: 0, y: 0, props: throwModule.createProps() })!;
    const get = () => model.getObject(id) as BoardObject<ThrowProps>;
    throwModule.runAction!(get(), 'toggle', ctx(10_000));
    expect(get().props.play).toEqual({ running: true, t0: 0, at: 10_000 });
    throwModule.runAction!(get(), 'toggle', ctx(11_000));
    expect(get().props.play).toEqual({ running: false, t0: 1, at: 11_000 });
  });

  it('«Графики» движения: x(t) и vₓ(t) на осях 6.2 справа от чертежа', () => {
    const { model, pageId, ctx } = setup();
    const id = model.createObject(MOTION_TYPE, { pageId, x: 0, y: 0, props: motionModule.createProps() })!;
    const o = model.getObject(id) as BoardObject<MotionProps>;
    expect(motionGeom(o.props)).not.toBeNull();
    model.transact(() => motionModule.runAction!(o, 'graphs', ctx(0)));
    const objs = model.pageObjects(pageId).map((k) => model.getObject(k)!);
    const curves = objs.filter((k) => k.type === 'math.analysis.curve').map((k) => (k.props as { text: string }).text);
    expect(curves).toEqual(['y = 2 + 3x', 'y = 3']);
    const axes = objs.filter((k) => k.type === 'math.analysis.axes');
    expect(axes.map((a) => (a.props as { yLabel: string }).yLabel)).toEqual(['x, м', 'v_x, м/с']);
    expect(axes.every((a) => a.x > o.x)).toBe(true);
    model.undo.undo();
    expect(model.pageObjects(pageId)).toEqual([id]);
  });

  it('«Графики» броска: y(t) и v_y(t)', () => {
    const { model, pageId, ctx } = setup();
    const id = model.createObject(THROW_TYPE, { pageId, x: 0, y: 0, props: { ...throwModule.createProps(), v0: 10, angle: 30 } })!;
    model.transact(() => throwModule.runAction!(model.getObject(id) as BoardObject<ThrowProps>, 'graphs', ctx(0)));
    const curves = model.pageObjects(pageId).map((k) => model.getObject(k)!).filter((k) => k.type === 'math.analysis.curve').map((k) => (k.props as { text: string }).text);
    expect(curves).toEqual(['y = 0 + 5x - 4.9x^2', 'y = 5 - 9.8x']);
  });
});
