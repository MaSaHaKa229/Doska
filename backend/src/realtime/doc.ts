import * as Y from 'yjs';
import {
  DEFAULT_BACKGROUND,
  DOC_ROOTS,
  DOC_SCHEMA_VERSION,
  generateKeyBetween,
  newEntityId,
  type PageRecord,
} from '@doska/shared';

/**
 * Начальное состояние Yjs-документа новой доски: метаданные и одна страница.
 * Создаётся сервером (clientID сервера), поэтому meta всегда валидна.
 */
export function createInitialDocState(ownerId: string, now = Date.now()): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap(DOC_ROOTS.meta);
    meta.set('schemaVersion', DOC_SCHEMA_VERSION);
    meta.set('createdAt', now);
    const page: PageRecord = {
      id: newEntityId(),
      title: 'Страница 1',
      order: generateKeyBetween(null, null),
      background: { ...DEFAULT_BACKGROUND },
      backgroundLocked: false,
      createdBy: ownerId,
      createdAt: now,
    };
    doc.getMap(DOC_ROOTS.pages).set(page.id, new Y.Map(Object.entries(page)));
  });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/**
 * Снимок полей Y.Map, включая только что удалённую карту.
 * Содержимое удалённых элементов остаётся доступным до сборки мусора в конце
 * транзакции, поэтому в обработчиках событий его можно прочитать и
 * восстановить объект (см. docs/SYNC_PROTOCOL.md, раздел 3).
 */
export function snapshotMap(map: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // _map — внутреннее поле Yjs: последний элемент для каждого ключа.
  const internal = (map as unknown as { _map: Map<string, { content: { getContent(): unknown[] }; deleted: boolean }> })._map;
  for (const [key, item] of internal) {
    const content = item.content.getContent();
    const value = content[content.length - 1];
    // Элементы, удалённые ДО этой транзакции (перезаписанные ключи), сюда не попадают:
    // в _map хранится только последний элемент ключа.
    if (value instanceof Y.AbstractType) continue;
    out[key] = value;
  }
  return out;
}

/** Поля Y.Map в виде объекта; вложенные Y-типы отмечаются (они запрещены). */
export function readFields(map: Y.Map<unknown>): { data: Record<string, unknown>; hasNestedTypes: boolean } {
  const data: Record<string, unknown> = {};
  let hasNestedTypes = false;
  for (const [k, v] of map.entries()) {
    if (v instanceof Y.AbstractType) hasNestedTypes = true;
    else data[k] = v;
  }
  return { data, hasNestedTypes };
}

export function countMap(doc: Y.Doc, root: string): number {
  return doc.getMap(root).size;
}
