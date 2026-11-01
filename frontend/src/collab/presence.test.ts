import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { cursorVisible, groupParticipants, Presence, type Peer } from './presence';
import { clearLocalBoards, localDbName } from './session';

const user = (id: string, role: 'TEACHER' | 'STUDENT', fullName: string) => ({ id, role, fullName, color: '#123456' });
const peer = (clientId: number, u: ReturnType<typeof user>, pageId: string | null): Peer => ({
  clientId,
  user: u,
  cursor: pageId ? { pageId, x: 0, y: 0 } : null,
  selection: [],
  tool: null,
  editing: null,
  viewport: null,
  laser: null,
  drawing: null,
});

describe('участники', () => {
  it('несколько вкладок одного человека — одна строка, учителя первыми', () => {
    const t = user('t', 'TEACHER', 'Учитель');
    const a = user('a', 'STUDENT', 'Яковлев');
    const b = user('b', 'STUDENT', 'Абрамова');
    const list = groupParticipants([peer(1, a, 'p1'), peer(2, t, null), peer(3, b, 'p2'), peer(4, a, null)]);
    expect(list.map((p) => [p.user.fullName, p.connections, p.pageId])).toEqual([
      ['Учитель', 1, null],
      ['Абрамова', 1, 'p2'],
      ['Яковлев', 2, 'p1'],
    ]);
  });

  it('скрытые курсоры учеников: учитель видит всех, ученик — только учителей', () => {
    const s = peer(1, user('s', 'STUDENT', 'С'), 'p');
    const t = peer(2, user('t', 'TEACHER', 'Т'), 'p');
    expect(cursorVisible(s, 'student', true)).toBe(true);
    expect(cursorVisible(s, 'student', false)).toBe(false);
    expect(cursorVisible(t, 'student', false)).toBe(true);
    expect(cursorVisible(s, 'owner', false)).toBe(true);
  });
});

describe('Presence', () => {
  afterEach(() => vi.useRealTimers());

  it('курсор отправляется не чаще ~30 раз в секунду, последнее значение не теряется', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const presence = new Presence(awareness);
    let updates = 0;
    awareness.on('update', () => updates++);
    for (let i = 0; i < 20; i++) presence.setCursor({ pageId: 'p', x: i, y: 0 });
    expect(updates).toBe(1); // первое — сразу
    vi.advanceTimersByTime(40);
    expect(updates).toBe(2);
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor.x).toBe(19);
    presence.destroy();
    awareness.destroy();
  });

  it('чужие состояния без user (до подстановки сервером) не показываются', () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const presence = new Presence(awareness);
    const other = new Y.Doc();
    const otherAw = new awarenessProtocol.Awareness(other);
    otherAw.setLocalState({ cursor: null });
    awarenessProtocol.applyAwarenessUpdate(awareness, awarenessProtocol.encodeAwarenessUpdate(otherAw, [other.clientID]), 'remote');
    expect(presence.peers()).toEqual([]);
    otherAw.setLocalState({ user: user('x', 'STUDENT', 'Икс'), cursor: { pageId: 'p', x: 1, y: 2 } });
    awarenessProtocol.applyAwarenessUpdate(awareness, awarenessProtocol.encodeAwarenessUpdate(otherAw, [other.clientID]), 'remote');
    expect(presence.peers().map((p) => p.user.fullName)).toEqual(['Икс']);
    presence.destroy();
  });
});

describe('локальные копии досок', () => {
  it('при выходе удаляются только базы доски', async () => {
    const open = (name: string) =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => {
          r.result.close();
          resolve();
        };
      });
    await open(localDbName('b1', 'u1'));
    await open(localDbName('b2', 'u1'));
    await open('other-app');
    await clearLocalBoards();
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toEqual(['other-app']);
  });
});
