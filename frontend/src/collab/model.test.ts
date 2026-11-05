import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS, type BoardMode } from '@doska/shared';
import { BoardModel, LOCAL_ORIGIN, UNDO_DEPTH } from './model';
import { registry } from '../plugins/registry';
import { hitShape } from '../objects/shape';

const T = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

function caps(userId: string, mode: BoardMode = 'COLLABORATIVE') {
  return computeCapabilities({
    user: { id: userId, role: userId === T ? 'TEACHER' : 'STUDENT' },
    board: { kind: 'LESSON', mode, ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
    memberRole: null,
    studentViaClass: userId !== T,
    teachesOwner: false,
    hasChalk: false,
  });
}

function setup(userId = T, mode: BoardMode = 'COLLABORATIVE', doc = new Y.Doc()) {
  if (doc.getMap('pages').size === 0) {
    // Первая страница (на сервере её создаёт createInitialDocState) — до
    // создания тестируемой модели, чтобы не попасть в её историю отмены.
    const c = caps(T);
    const teacherModel = new BoardModel(doc, { userId: T, registry, getCaps: () => c, ownerId: T });
    teacherModel.addPage('Страница 1');
    teacherModel.destroy();
  }
  const model = new BoardModel(doc, { userId, registry, getCaps: () => caps(userId, mode), ownerId: T });
  return { model, doc, pageId: model.pages()[0]!.id };
}

const rect = (w = 100, h = 50) => ({ kind: 'rect' as const, w, h, stroke: 'ink', fill: 'none', strokeWidth: 2, dash: 'solid' as const });

describe('BoardModel', () => {
  it('создание, габариты, попадание', () => {
    const { model, pageId } = setup();
    const id = model.createObject('core.shape', { pageId, x: 10, y: 20, props: rect() })!;
    expect(model.pageObjects(pageId)).toEqual([id]);
    expect(model.get(id)!.bounds).toEqual({ x: 9, y: 19, width: 102, height: 52 });
    expect(model.hitTest(pageId, { x: 10, y: 40 }, 3)).toEqual([id]); // на контуре
    expect(model.hitTest(pageId, { x: 60, y: 45 }, 3)).toEqual([]); // внутри без заливки
    model.updateObjects([{ id, patch: { props: { fill: 'accent-2' } } }]);
    expect(model.hitTest(pageId, { x: 60, y: 45 }, 3)).toEqual([id]);
    expect(model.getObject(id)!.props).toMatchObject({ fill: 'accent-2', w: 100 });
  });

  it('попадание учитывает поворот и масштаб', () => {
    const { model, pageId } = setup();
    const id = model.createObject('core.shape', { pageId, x: 0, y: 0, props: { ...rect(100, 0), kind: 'line' as const } })!;
    model.updateObjects([{ id, patch: { rotation: Math.PI / 2, scaleX: 2 } }]);
    expect(model.hitTest(pageId, { x: 0, y: 150 }, 3)).toEqual([id]);
    expect(model.hitTest(pageId, { x: 150, y: 0 }, 3)).toEqual([]);
    expect(hitShape({ ...rect(), kind: 'ellipse', fill: 'ink' }, { x: 50, y: 25 }, 1)).toBe(true);
  });

  it('отмена отменяет только свои действия', () => {
    const { model, doc, pageId } = setup();
    const mine = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    // Изменение «от другого пользователя» (другой origin).
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const otherModel = new BoardModel(other, { userId: S, registry, getCaps: () => caps(S), ownerId: T });
    const theirs = otherModel.createObject('core.shape', { pageId, x: 300, y: 0, props: rect() })!;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), 'remote');
    expect(model.pageObjects(pageId)).toHaveLength(2);
    model.undo.undo();
    expect(model.getObject(mine)).toBeUndefined();
    expect(model.getObject(theirs)).toBeDefined();
    model.undo.redo();
    expect(model.getObject(mine)).toBeDefined();
  });

  it('история ограничена', () => {
    const { model, pageId } = setup();
    const id = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    for (let i = 0; i < UNDO_DEPTH + 30; i++) {
      model.undo.stopCapturing();
      model.updateObjects([{ id, patch: { x: i + 1 } }]);
    }
    expect(model.undo.undoStack.length).toBe(UNDO_DEPTH);
  });

  it('предварительная проверка прав: лекция, чужие объекты, блокировка', () => {
    const doc = new Y.Doc();
    const teacher = setup(T, 'COLLABORATIVE', doc);
    const tid = teacher.model.createObject('core.shape', { pageId: teacher.pageId, x: 0, y: 0, props: rect() })!;
    const student = new BoardModel(doc, { userId: S, registry, getCaps: () => caps(S), ownerId: T });
    expect(student.canModify(tid)).toBe(false); // учительский объект
    expect(student.updateObjects([{ id: tid, patch: { x: 5 } }])).toBe(0);
    const sid = student.createObject('core.shape', { pageId: teacher.pageId, x: 0, y: 0, props: rect() })!;
    expect(student.updateObjects([{ id: sid, patch: { x: 5 } }])).toBe(1);
    teacher.model.setLocked([sid], true);
    expect(student.canModify(sid)).toBe(false);
    const lecture = new BoardModel(doc, { userId: S, registry, getCaps: () => caps(S, 'LECTURE'), ownerId: T });
    expect(lecture.createObject('core.shape', { pageId: teacher.pageId, x: 0, y: 0, props: rect() })).toBeNull();
  });

  it('порядок слоёв', () => {
    const { model, pageId } = setup();
    const [a, b, c] = [0, 1, 2].map((i) => model.createObject('core.shape', { pageId, x: i, y: 0, props: rect() })!);
    expect(model.pageObjects(pageId)).toEqual([a, b, c]);
    model.reorder([a!], 'front');
    expect(model.pageObjects(pageId)).toEqual([b, c, a]);
    model.reorder([a!], 'backward');
    expect(model.pageObjects(pageId)).toEqual([b, a, c]);
    model.reorder([c!], 'back');
    expect(model.pageObjects(pageId)).toEqual([c, b, a]);
    model.reorder([c!], 'forward');
    expect(model.pageObjects(pageId)).toEqual([b, c, a]);
  });

  it('группировка, листья, удаление группы, разгруппировка', () => {
    const { model, pageId } = setup();
    const a = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    const b = model.createObject('core.shape', { pageId, x: 200, y: 0, props: rect() })!;
    const g = model.group([a, b])!;
    expect(model.rootOf(a)).toBe(g);
    expect(model.leaves([g]).sort()).toEqual([a, b].sort());
    expect(model.boundsOf([g])).toEqual({ x: -1, y: -1, width: 302, height: 52 });
    expect(model.ungroup(g).sort()).toEqual([a, b].sort());
    expect(model.getObject(g)).toBeUndefined();
    expect(model.rootOf(a)).toBe(a);
    const g2 = model.group([a, b])!;
    model.deleteObjects([g2]);
    expect(model.pageObjects(pageId)).toEqual([]);
  });

  it('копирование и вставка: новые id, ссылки на группу, сдвиг', () => {
    const { model, pageId } = setup();
    const a = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    const b = model.createObject('core.shape', { pageId, x: 200, y: 0, props: rect() })!;
    const g = model.group([a, b])!;
    const copied = model.serialize([g]);
    expect(copied).toHaveLength(3);
    const roots = model.paste(copied, pageId, { x: 10, y: 10 });
    expect(roots).toHaveLength(1);
    const newGroup = roots[0]!;
    expect(newGroup).not.toBe(g);
    const kids = model.leaves([newGroup]);
    expect(kids).toHaveLength(2);
    expect(kids.every((id) => model.getObject(id)!.groupId === newGroup)).toBe(true);
    expect(kids.map((id) => model.getObject(id)!.x).sort((x, y) => x - y)).toEqual([10, 210]);
    expect(model.pageObjects(pageId)).toHaveLength(6);
  });

  it('страницы: добавление, порядок, переименование, удаление с объектами', () => {
    const { model, pageId } = setup();
    const p2 = model.addPage('Вторая')!;
    const p3 = model.addPage('Третья')!;
    expect(model.pages().map((p) => p.title)).toEqual(['Страница 1', 'Вторая', 'Третья']);
    model.movePage(p3, pageId);
    expect(model.pages().map((p) => p.id)).toEqual([p3, pageId, p2]);
    model.renamePage(p2, '  Задачи  ');
    expect(model.page(p2)!.title).toBe('Задачи');
    model.createObject('core.shape', { pageId: p2, x: 0, y: 0, props: rect() });
    model.undo.stopCapturing(); // отдельный шаг отмены для удаления
    expect(model.deletePage(p2)).toBe(true);
    expect(model.pages()).toHaveLength(2);
    expect(model.pageObjects(p2)).toEqual([]);
    model.undo.undo();
    expect(model.pages()).toHaveLength(3);
    expect(model.pageObjects(p2)).toHaveLength(1);
  });

  it('виртуализация: поиск в видимой области', () => {
    const { model, pageId } = setup();
    model.transact(() => {
      for (let i = 0; i < 1000; i++) {
        model.createObject('core.shape', { pageId, x: (i % 40) * 150, y: Math.floor(i / 40) * 100, props: rect() });
      }
    });
    expect(model.pageObjects(pageId)).toHaveLength(1000);
    const visible = model.queryRect(pageId, { x: 0, y: 0, width: 800, height: 600 });
    expect(visible.length).toBeGreaterThan(20);
    expect(visible.length).toBeLessThan(100);
  });

  it('неизвестный тип объекта сохраняется и рисуется заглушкой', () => {
    const { model, doc, pageId } = setup();
    const id = 'unknownobj1';
    doc.transact(() => {
      model.objectsMap.set(
        id,
        new Y.Map(
          Object.entries({
            id, type: 'physics.future.thing', v: 1, pageId, z: 'a5', layer: 'content', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
            locked: false, hidden: false, groupId: null, deps: [], createdBy: T, createdAt: 1, updatedBy: T, updatedAt: 1, props: { secret: 42 },
          }),
        ),
      );
    }, LOCAL_ORIGIN);
    const e = model.get(id)!;
    expect(e.module).toBeNull();
    expect(e.bounds).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    expect((e.obj.props as { secret: number }).secret).toBe(42);
  });
});

describe('шаги отмены', () => {
  it('быстрые последовательные действия отменяются по одному, жест ручки — целиком', () => {
    const { model, pageId } = setup();
    const a = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    const b = model.createObject('core.shape', { pageId, x: 0, y: 0, props: rect() })!;
    model.undo.undo();
    expect(model.getObject(b)).toBeUndefined();
    expect(model.getObject(a)).toBeDefined();
    model.undo.stopCapturing();
    for (let i = 1; i <= 5; i++) model.updateObjects([{ id: a, patch: { x: i } }], { merge: true });
    model.undo.undo();
    expect(model.getObject(a)!.x).toBe(0);
  });
});
