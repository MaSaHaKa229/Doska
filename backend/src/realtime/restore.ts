import * as Y from 'yjs';
import { DOC_ROOTS } from '@doska/shared';
import { SERVER_ORIGIN } from './guard.js';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Привести корневую карту (страницы или объекты) к состоянию target:
 * лишние записи удалить, недостающие создать, у совпадающих записать
 * только различающиеся поля. Возвращает число изменённых записей.
 */
function syncRoot(current: Y.Map<Y.Map<unknown>>, target: Y.Map<Y.Map<unknown>>): number {
  let changed = 0;
  for (const id of [...current.keys()]) {
    if (!target.has(id)) {
      current.delete(id);
      changed++;
    }
  }
  for (const [id, t] of target) {
    const fields = t.toJSON() as Record<string, unknown>;
    const c = current.get(id);
    if (!c) {
      current.set(id, new Y.Map(Object.entries(fields)));
      changed++;
      continue;
    }
    let diff = false;
    for (const key of [...c.keys()]) {
      if (!(key in fields)) {
        c.delete(key);
        diff = true;
      }
    }
    for (const [key, value] of Object.entries(fields)) {
      if (!same(c.get(key), value)) {
        c.set(key, value);
        diff = true;
      }
    }
    if (diff) changed++;
  }
  return changed;
}

/**
 * Восстановление версии семантической правкой (docs/SYNC_PROTOCOL.md,
 * раздел 12): документ не заменяется, история CRDT не ломается, у всех
 * клиентов изменения приходят как обычные обновления. Вызывать внутри
 * Room.applyServerChange. Метаданные документа (meta) не трогаются.
 */
export function restoreFromState(doc: Y.Doc, state: Uint8Array): { pages: number; objects: number } {
  const target = new Y.Doc();
  Y.applyUpdate(target, state);
  let result = { pages: 0, objects: 0 };
  doc.transact(() => {
    // Сначала страницы: объекты ссылаются на них.
    const pages = syncRoot(doc.getMap(DOC_ROOTS.pages), target.getMap(DOC_ROOTS.pages));
    const objects = syncRoot(doc.getMap(DOC_ROOTS.objects), target.getMap(DOC_ROOTS.objects));
    result = { pages, objects };
  }, SERVER_ORIGIN);
  target.destroy();
  return result;
}
