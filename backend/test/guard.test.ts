import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  computeCapabilities,
  createObjectBase,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_BACKGROUND,
  type BoardMode,
} from '@doska/shared';
import { DocGuard, GuardError } from '../src/realtime/guard.js';
import { createInitialDocState } from '../src/realtime/doc.js';

const T = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333';

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

/** Сервер + клиенты: клиент вносит изменения, сервер проверяет, клиент получает компенсацию. */
function setup() {
  const server = new Y.Doc();
  Y.applyUpdate(server, createInitialDocState(T));
  const guard = new DocGuard(server);
  guard.moderatorIds = new Set([T]);
  const pageId = [...server.getMap('pages').keys()][0]!;
  const client = (userId: string) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
    return { userId, doc };
  };
  /** Отправить всё новое с клиента на сервер; вернуть нарушения и синхронизировать клиента обратно. */
  const push = (c: { userId: string; doc: Y.Doc }, mode: BoardMode = 'COLLABORATIVE') => {
    const update = Y.encodeStateAsUpdate(c.doc, Y.encodeStateVector(server));
    const violations = guard.applyClientUpdate(update, 'conn', { userId: c.userId, caps: caps(c.userId, mode) });
    Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(c.doc)));
    return violations;
  };
  const pull = (c: { doc: Y.Doc }) => Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(c.doc)));
  const addObject = (c: { userId: string; doc: Y.Doc }, id: string, over: Record<string, unknown> = {}) => {
    const obj = {
      ...createObjectBase({ id, type: 'core.stroke', pageId, z: 'a0', userId: c.userId, now: Date.now() }),
      props: { points: [0, 0, 0.5], color: 'ink' },
      ...over,
    };
    c.doc.getMap('objects').set(id, new Y.Map(Object.entries(obj)));
  };
  const obj = (d: Y.Doc, id: string) => (d.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.toJSON();
  return { server, guard, pageId, client, push, pull, addObject, obj };
}

describe('DocGuard: применить → проверить → компенсировать', () => {
  it('разрешённое создание принимается', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'objectAAA1');
    expect(t.push(s1)).toEqual([]);
    expect(t.obj(t.server, 'objectAAA1')).toMatchObject({ createdBy: S1 });
    expect(t.guard.objectCount).toBe(1);
  });

  it('режим «Лекция»: объект ученика удаляется у всех, клиент получает компенсацию', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'objectAAA1');
    expect(t.push(s1, 'LECTURE')).toEqual([{ reason: 'NO_WRITE', objectId: 'objectAAA1' }]);
    expect(t.obj(t.server, 'objectAAA1')).toBeUndefined();
    expect(t.obj(s1.doc, 'objectAAA1')).toBeUndefined();
    expect(t.guard.objectCount).toBe(0);
  });

  it('после компенсации следующие правки того же клиента принимаются (нет «дыр» в clock)', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'objectAAA1');
    t.push(s1, 'LECTURE');
    t.addObject(s1, 'objectBBB2');
    expect(t.push(s1)).toEqual([]);
    expect(t.obj(t.server, 'objectBBB2')).toBeDefined();
    expect(t.server.store.pendingStructs).toBeNull();
  });

  it('чужой автор, заблокированный объект и фоновый слой при создании', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'fakeauthor', { createdBy: T, updatedBy: T });
    t.addObject(s1, 'lockedobj1', { locked: true });
    t.addObject(s1, 'background', { layer: 'background' });
    const v = t.push(s1);
    expect(v.map((x) => x.reason).sort()).toEqual(['AUTHOR_MISMATCH', 'TEACHER_ONLY', 'TEACHER_ONLY']);
    expect(t.server.getMap('objects').size).toBe(0);
  });

  it('неверная структура объекта: лишние поля, неверные значения, вложенные Y-типы', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'extrafield', { evil: 1 });
    t.addObject(s1, 'badvalue01', { x: 'abc' });
    t.addObject(s1, 'nestedtype', { props: new Y.Map() });
    t.addObject(s1, 'idmismatch', { id: 'otherid123' });
    expect(t.push(s1)).toHaveLength(4);
    expect(t.server.getMap('objects').size).toBe(0);
  });

  it('изменение и удаление учительского заблокированного объекта отменяются', () => {
    const t = setup();
    const teacher = t.client(T);
    t.addObject(teacher, 'condition1', { locked: true });
    expect(t.push(teacher)).toEqual([]);
    const s1 = t.client(S1);
    (s1.doc.getMap('objects').get('condition1') as Y.Map<unknown>).set('x', 500);
    expect(t.push(s1)).toEqual([{ reason: 'LOCKED', objectId: 'condition1' }]);
    expect(t.obj(t.server, 'condition1')).toMatchObject({ x: 0 });
    expect(t.obj(s1.doc, 'condition1')).toMatchObject({ x: 0 });

    s1.doc.getMap('objects').delete('condition1');
    expect(t.push(s1)).toEqual([{ reason: 'LOCKED', objectId: 'condition1' }]);
    expect(t.obj(t.server, 'condition1')).toMatchObject({ locked: true, createdBy: T, x: 0 });
    expect(t.obj(s1.doc, 'condition1')).toMatchObject({ locked: true });
    // Учитель видит объект без изменений.
    t.pull(teacher);
    expect(t.obj(teacher.doc, 'condition1')).toMatchObject({ x: 0, locked: true });
  });

  it('ученик меняет свой объект, но не блокировку, автора и тип', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'ownobject1');
    t.push(s1);
    const m = s1.doc.getMap('objects').get('ownobject1') as Y.Map<unknown>;
    s1.doc.transact(() => {
      m.set('x', 42);
      m.set('locked', true);
      m.set('createdBy', S2);
      m.set('type', 'core.text');
    });
    const v = t.push(s1);
    expect(v.map((x) => x.reason).sort()).toEqual(['IMMUTABLE_FIELD', 'IMMUTABLE_FIELD', 'TEACHER_ONLY']);
    expect(t.obj(t.server, 'ownobject1')).toMatchObject({ x: 42, locked: false, createdBy: S1, type: 'core.stroke' });
  });

  it('чужие ученические объекты защищены, недопустимые значения полей отменяются', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'ownobject1');
    t.push(s1);
    const s2 = t.client(S2);
    (s2.doc.getMap('objects').get('ownobject1') as Y.Map<unknown>).set('x', 7);
    expect(t.push(s2)).toEqual([{ reason: 'NOT_OWNER', objectId: 'ownobject1' }]);

    // Получаем компенсацию правки второго ученика: иначе правка x первого
    // окажется одновременной с ней, и победителя выберет Yjs по clientID.
    t.pull(s1);
    const m = s1.doc.getMap('objects').get('ownobject1') as Y.Map<unknown>;
    s1.doc.transact(() => {
      m.set('x', Number.POSITIVE_INFINITY);
      m.set('props', new Y.Map());
      m.delete('y');
      m.set('pageId', 'nosuchpage');
    });
    expect(t.push(s1).map((x) => x.reason).sort()).toEqual(['INVALID_VALUE', 'INVALID_VALUE', 'INVALID_VALUE', 'PAGE_NOT_FOUND']);
    expect(t.obj(t.server, 'ownobject1')).toMatchObject({ x: 0, y: 0, pageId: t.pageId, props: { color: 'ink' } });
  });

  it('метаданные и страницы без прав не меняются', () => {
    const t = setup();
    const s1 = t.client(S1);
    s1.doc.getMap('meta').set('schemaVersion', 99);
    (s1.doc.getMap('pages').get(t.pageId) as Y.Map<unknown>).set('title', 'Моя');
    s1.doc.getMap('pages').set('newpage001', new Y.Map(Object.entries({
      id: 'newpage001', title: 'X', order: 'a1', background: DEFAULT_BACKGROUND, backgroundLocked: false, createdBy: S1, createdAt: 1,
    })));
    expect(t.push(s1).map((v) => v.reason).sort()).toEqual(['NO_PAGE_RIGHTS', 'NO_PAGE_RIGHTS', 'TEACHER_ONLY']);
    expect(t.server.getMap('meta').get('schemaVersion')).toBe(1);
    expect(t.server.getMap('pages').size).toBe(1);
    expect((t.server.getMap('pages').get(t.pageId) as Y.Map<unknown>).get('title')).toBe('Страница 1');
  });

  it('учитель удаляет страницу вместе с объектами; страница с оставшимися объектами восстанавливается', () => {
    const t = setup();
    const teacher = t.client(T);
    teacher.doc.getMap('pages').set('page000002', new Y.Map(Object.entries({
      id: 'page000002', title: '2', order: 'a1', background: DEFAULT_BACKGROUND, backgroundLocked: false, createdBy: T, createdAt: 1,
    })));
    t.addObject(teacher, 'onpage0002', { pageId: 'page000002' });
    expect(t.push(teacher)).toEqual([]);
    // Удаление страницы без удаления её объектов — страница возвращается.
    teacher.doc.getMap('pages').delete('page000002');
    expect(t.push(teacher)).toEqual([{ reason: 'NO_PAGE_RIGHTS', pageId: 'page000002' }]);
    expect(t.server.getMap('pages').has('page000002')).toBe(true);
    // Корректное удаление: страница и объекты в одной транзакции.
    teacher.doc.transact(() => {
      teacher.doc.getMap('pages').delete('page000002');
      teacher.doc.getMap('objects').delete('onpage0002');
    });
    expect(t.push(teacher)).toEqual([]);
    expect(t.server.getMap('pages').has('page000002')).toBe(false);
  });

  it('предварительная проверка: чужие корни документа', () => {
    const t = setup();
    const evil = new Y.Doc();
    evil.getMap('hack').set('a', 1);
    expect(() =>
      t.guard.applyClientUpdate(Y.encodeStateAsUpdate(evil), 'conn', { userId: T, caps: caps(T) }),
    ).toThrow(GuardError);
    const list = new Y.Doc();
    list.getArray('objects').push([1]);
    expect(() => t.guard.applyClientUpdate(Y.encodeStateAsUpdate(list), 'conn', { userId: T, caps: caps(T) })).toThrow(GuardError);
    expect(() => t.guard.applyClientUpdate(new Uint8Array([1, 2, 3]), 'conn', { userId: T, caps: caps(T) })).toThrow(GuardError);
  });

  it('обновление с недостающими зависимостями отклоняется', () => {
    const t = setup();
    const s1 = t.client(S1);
    t.addObject(s1, 'firstobj01');
    const sv = Y.encodeStateVector(s1.doc);
    t.addObject(s1, 'secondobj2');
    const onlySecond = Y.encodeStateAsUpdate(s1.doc, sv);
    expect(() => t.guard.applyClientUpdate(onlySecond, 'conn', { userId: S1, caps: caps(S1) })).toThrow(/отсутствующие/);
  });
});
