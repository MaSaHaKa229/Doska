import * as Y from 'yjs';
import {
  ALLOWED_DOC_ROOTS,
  DOC_ROOTS,
  LIMITS,
  OBJECT_LAYERS,
  boardObjectSchema,
  canCreateObject,
  canCreatePage,
  canDeleteObject,
  canEditMeta,
  canEditPage,
  canUpdateObjectField,
  isJsonValue,
  isKnownObjectField,
  jsonByteSize,
  objectFieldSchemas,
  pageSchema,
  type BoardCapabilities,
  type DenyReason,
  type JsonValue,
  type ObjectGuardInfo,
  type ObjectLayer,
  type PageRecord,
} from '@doska/shared';
import { readFields, snapshotMap } from './doc.js';

/**
 * Серверная проверка Yjs-обновлений: «применить → проверить → компенсировать».
 *
 * Почему не «отклонить обновление»: в Yjs clock каждого клиента растёт
 * последовательно, и выброшенное обновление оставило бы «дыру» — все
 * следующие правки клиента сервер не смог бы применить. Поэтому сервер
 * применяет обновление, разбирает изменения (наблюдатели observeDeep дают
 * список изменённых ключей со старыми значениями), проверяет каждое правилами
 * из @doska/shared/permissions и всё запрещённое сразу отменяет обратной
 * правкой от своего имени. Остальные клиенты получают обновление вместе с
 * компенсацией одним пакетом, поэтому запрещённое изменение у них не
 * появляется даже на мгновение. Подробно — docs/SYNC_PROTOCOL.md, раздел 3.
 *
 * Сложность проверки — O(число изменённых полей): наблюдатель корня objects
 * получает события только по затронутым объектам, а права сверяются с
 * индексом objectId → (автор, блокировка, слой, страница), который
 * обновляется после каждой транзакции.
 */

export const SERVER_ORIGIN = Symbol('doska-server');

export interface GuardActor {
  userId: string;
  caps: BoardCapabilities;
}

export interface Violation {
  reason: DenyReason;
  objectId?: string;
  pageId?: string;
}

type Root = 'objects' | 'pages' | 'meta';

type Action =
  | { t: 'removeEntry'; root: 'objects' | 'pages'; id: string }
  | { t: 'restoreEntry'; root: 'objects' | 'pages'; id: string; snapshot: Record<string, unknown> }
  | { t: 'setField'; root: Root; id: string | null; field: string; value: unknown }
  | { t: 'deleteField'; root: Root; id: string | null; field: string };

interface IndexedObject {
  createdBy: string;
  locked: boolean;
  layer: ObjectLayer;
  pageId: string;
}

interface ActiveCheck {
  actor: GuardActor;
  actions: Action[];
  violations: Violation[];
  /** Объекты, созданные/заменённые в этой транзакции (поля проверены целиком). */
  createdObjects: Set<string>;
  /** Страницы, созданные в этой транзакции. */
  createdPages: Set<string>;
  /** Страницы, удаление которых разрешено (проверим, что на них не осталось объектов). */
  deletedPages: Map<string, Record<string, unknown>>;
}

export class GuardError extends Error {}

const MAX_CREATED_AT_SKEW_MS = 60_000;

export class DocGuard {
  readonly objects: Y.Map<unknown>;
  readonly pages: Y.Map<unknown>;
  readonly meta: Y.Map<unknown>;
  /** id учителей доски: их объекты ученик может трогать только при editTeacherObjects. */
  moderatorIds = new Set<string>();

  private readonly index = new Map<string, IndexedObject>();
  private readonly pageIndex = new Map<string, { backgroundLocked: boolean }>();
  private active: ActiveCheck | null = null;

  constructor(private readonly doc: Y.Doc) {
    this.objects = doc.getMap(DOC_ROOTS.objects);
    this.pages = doc.getMap(DOC_ROOTS.pages);
    this.meta = doc.getMap(DOC_ROOTS.meta);
    this.rebuildIndex();

    this.objects.observeDeep((events, tr) => {
      if (this.active && tr.origin !== SERVER_ORIGIN) this.checkObjectEvents(events);
    });
    this.pages.observeDeep((events, tr) => {
      if (this.active && tr.origin !== SERVER_ORIGIN) this.checkPageEvents(events);
    });
    this.meta.observe((event, tr) => {
      if (this.active && tr.origin !== SERVER_ORIGIN) this.checkMetaEvent(event);
    });
    // Индексы отражают состояние ПОСЛЕ каждой транзакции (и клиентской, и серверной).
    doc.on('afterTransaction', (tr: Y.Transaction) => this.updateIndexes(tr));
  }

  get objectCount(): number {
    return this.index.size;
  }

  get pageCount(): number {
    return this.pageIndex.size;
  }

  /** Информация об объекте для проверок (используется и серверными командами). */
  objectInfo(id: string): ObjectGuardInfo | undefined {
    const o = this.index.get(id);
    return o ? { ...o, authorIsModerator: this.moderatorIds.has(o.createdBy) } : undefined;
  }

  /** id всех объектов с фильтром по индексу (для серверных команд очистки). */
  findObjects(pred: (info: ObjectGuardInfo, id: string) => boolean): string[] {
    const out: string[] = [];
    for (const [id, o] of this.index) {
      if (pred({ ...o, authorIsModerator: this.moderatorIds.has(o.createdBy) }, id)) out.push(id);
    }
    return out;
  }

  /**
   * Предварительная проверка структуры обновления до применения.
   * Отклоняет (бросает GuardError): корни вне meta/pages/objects и элементы,
   * ссылающиеся на отсутствующие у сервера структуры. Корректный клиент
   * таких обновлений не создаёт — соединение закрывается.
   */
  precheck(update: Uint8Array): void {
    let decoded: ReturnType<typeof Y.decodeUpdate>;
    try {
      decoded = Y.decodeUpdate(update);
    } catch {
      throw new GuardError('Не удалось разобрать обновление');
    }
    for (const s of decoded.structs) {
      if (s instanceof Y.Item) {
        const parent = s.parent as unknown;
        if (typeof parent === 'string') {
          if (!ALLOWED_DOC_ROOTS.has(parent)) throw new GuardError(`Недопустимый корень документа «${parent}»`);
          // Корни — карты: элементы без ключа (элементы списка) недопустимы.
          if (s.parentSub === null) throw new GuardError('Недопустимая структура корня документа');
        }
      }
    }
    const sv = Y.encodeStateVector(this.doc);
    const serverSv = Y.decodeStateVector(sv);
    const meta = Y.parseUpdateMeta(update);
    for (const [client, clock] of meta.from) {
      if (clock > (serverSv.get(client) ?? 0)) {
        throw new GuardError('Обновление ссылается на отсутствующие изменения');
      }
    }
  }

  /**
   * Применить обновление клиента с проверкой прав. Возвращает нарушения
   * (запрещённые изменения уже отменены серверной транзакцией).
   */
  applyClientUpdate(update: Uint8Array, origin: unknown, actor: GuardActor): Violation[] {
    this.precheck(update);
    const check: ActiveCheck = {
      actor,
      actions: [],
      violations: [],
      createdObjects: new Set(),
      createdPages: new Set(),
      deletedPages: new Map(),
    };
    this.active = check;
    try {
      Y.applyUpdate(this.doc, update, origin);
    } finally {
      this.active = null;
    }
    this.postChecks(check);
    if (check.actions.length) {
      this.doc.transact(() => this.compensate(check.actions), SERVER_ORIGIN);
    }
    return check.violations;
  }

  // ------------------------------------------------------------------
  //  Проверки объектов
  // ------------------------------------------------------------------

  private deny(reason: DenyReason, ids: { objectId?: string; pageId?: string }, action: Action): void {
    this.active!.violations.push({ reason, ...ids });
    this.active!.actions.push(action);
  }

  private pageInfo(pageId: string): Pick<PageRecord, 'backgroundLocked'> | undefined {
    const before = this.pageIndex.get(pageId);
    if (before) return before;
    // Страница создана в этой же транзакции.
    const p = this.pages.get(pageId);
    if (p instanceof Y.Map) return { backgroundLocked: p.get('backgroundLocked') === true };
    return undefined;
  }

  private checkObjectEvents(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const check = this.active!;
    // 1. Уровень корня: создание, замена и удаление объектов.
    for (const e of events) {
      if (e.target !== this.objects) continue;
      for (const [id, change] of e.changes.keys) {
        if (change.action === 'add') {
          check.createdObjects.add(id);
          this.validateNewObject(id);
        } else if (change.action === 'delete') {
          this.validateObjectDelete(id, change.oldValue);
        } else {
          // update: ключ перезаписан новым Y.Map = удаление старого + создание нового.
          check.createdObjects.add(id);
          if (this.validateObjectDelete(id, change.oldValue)) this.validateNewObject(id);
        }
      }
    }
    // 2. Изменения полей существующих объектов.
    for (const e of events) {
      if (e.target === this.objects) continue;
      const id = e.path[0];
      if (typeof id !== 'string' || check.createdObjects.has(id)) continue;
      if (e.path.length !== 1) {
        // Изменения внутри вложенного Y-типа: такие типы запрещены и
        // отменяются на уровне поля объекта (событие path.length === 1).
        continue;
      }
      for (const [field, change] of (e as Y.YMapEvent<unknown>).changes.keys) {
        this.validateObjectField(id, field, change.action, change.oldValue);
      }
    }
  }

  private validateNewObject(id: string): void {
    const { actor } = this.active!;
    const value = this.objects.get(id);
    const remove: Action = { t: 'removeEntry', root: 'objects', id };
    if (!(value instanceof Y.Map)) return this.deny('INVALID_VALUE', { objectId: id }, remove);

    const { data, hasNestedTypes } = readFields(value);
    if (hasNestedTypes || data.id !== id) return this.deny('INVALID_VALUE', { objectId: id }, remove);
    const parsed = boardObjectSchema.safeParse(data);
    if (!parsed.success) return this.deny('INVALID_VALUE', { objectId: id }, remove);
    const obj = parsed.data;
    if (jsonByteSize(obj.props as JsonValue) > LIMITS.maxPropsBytes) return this.deny('LIMIT_EXCEEDED', { objectId: id }, remove);
    if (this.index.size + this.active!.createdObjects.size > LIMITS.maxObjectsPerBoard + 1) {
      return this.deny('LIMIT_EXCEEDED', { objectId: id }, remove);
    }
    const decision = canCreateObject(
      actor.caps,
      actor.userId,
      { createdBy: obj.createdBy, locked: obj.locked, layer: obj.layer, pageId: obj.pageId, authorIsModerator: this.moderatorIds.has(obj.createdBy) },
      this.pageInfo(obj.pageId),
    );
    if (!decision.ok) return this.deny(decision.reason, { objectId: id }, remove);
    if (obj.updatedBy !== actor.userId) {
      this.active!.actions.push({ t: 'setField', root: 'objects', id, field: 'updatedBy', value: actor.userId });
    }
    // Время создания — по часам клиента (офлайн-правки), но не из будущего.
    const now = Date.now();
    if (obj.createdAt > now + MAX_CREATED_AT_SKEW_MS) {
      this.active!.actions.push({ t: 'setField', root: 'objects', id, field: 'createdAt', value: now });
      this.active!.actions.push({ t: 'setField', root: 'objects', id, field: 'updatedAt', value: now });
    }
  }

  /** true — удаление разрешено. */
  private validateObjectDelete(id: string, oldValue: unknown): boolean {
    const { actor } = this.active!;
    const info = this.objectInfo(id);
    if (!info) return true; // объект не был принят ранее (создан и удалён в одном пакете)
    const decision = canDeleteObject(actor.caps, actor.userId, info, this.pageInfo(info.pageId));
    if (decision.ok) return true;
    const snapshot = oldValue instanceof Y.Map ? snapshotMap(oldValue) : null;
    if (snapshot) this.deny(decision.reason, { objectId: id }, { t: 'restoreEntry', root: 'objects', id, snapshot });
    return false;
  }

  private validateObjectField(id: string, field: string, action: 'add' | 'update' | 'delete', oldValue: unknown): void {
    const { actor } = this.active!;
    const info = this.objectInfo(id);
    if (!info) return;
    const revert: Action =
      action === 'add'
        ? { t: 'deleteField', root: 'objects', id, field }
        : { t: 'setField', root: 'objects', id, field, value: oldValue };
    const ids = { objectId: id };

    const decision = canUpdateObjectField(actor.caps, actor.userId, info, field, this.pageInfo(info.pageId));
    if (!decision.ok) return this.deny(decision.reason, ids, revert);
    if (action === 'delete') return this.deny('INVALID_VALUE', ids, revert); // базовые поля обязательны

    const map = this.objects.get(id);
    const value = map instanceof Y.Map ? map.get(field) : undefined;
    if (value instanceof Y.AbstractType || !isKnownObjectField(field)) return this.deny('INVALID_VALUE', ids, revert);
    if (!objectFieldSchemas[field].safeParse(value).success) return this.deny('INVALID_VALUE', ids, revert);
    if (field === 'props' && jsonByteSize(value as JsonValue) > LIMITS.maxPropsBytes) return this.deny('LIMIT_EXCEEDED', ids, revert);
    if (field === 'updatedBy' && value !== actor.userId) return this.deny('AUTHOR_MISMATCH', ids, revert);
    if (field === 'pageId') {
      const target = this.pageInfo(value as string);
      if (!target) return this.deny('PAGE_NOT_FOUND', ids, revert);
      if (info.layer === 'background' && target.backgroundLocked && !actor.caps.moderate) {
        return this.deny('BACKGROUND_LOCKED', ids, revert);
      }
    }
  }

  // ------------------------------------------------------------------
  //  Проверки страниц и метаданных
  // ------------------------------------------------------------------

  private checkPageEvents(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const check = this.active!;
    const { actor } = check;
    for (const e of events) {
      if (e.target !== this.pages) continue;
      for (const [id, change] of e.changes.keys) {
        const oldSnapshot = change.oldValue instanceof Y.Map ? snapshotMap(change.oldValue) : null;
        if (change.action === 'delete' || change.action === 'update') {
          const d = canEditPage(actor.caps);
          if (!d.ok) {
            if (oldSnapshot) this.deny(d.reason, { pageId: id }, { t: 'restoreEntry', root: 'pages', id, snapshot: oldSnapshot });
            check.createdPages.add(id);
            continue;
          }
          if (change.action === 'delete') {
            if (oldSnapshot) check.deletedPages.set(id, oldSnapshot);
            continue;
          }
        }
        // add или разрешённая замена: проверяем новую страницу целиком.
        check.createdPages.add(id);
        const value = this.pages.get(id);
        const remove: Action = oldSnapshot
          ? { t: 'restoreEntry', root: 'pages', id, snapshot: oldSnapshot }
          : { t: 'removeEntry', root: 'pages', id };
        if (!(value instanceof Y.Map)) {
          this.deny('INVALID_VALUE', { pageId: id }, remove);
          continue;
        }
        const { data, hasNestedTypes } = readFields(value);
        const parsed = pageSchema.safeParse(data);
        if (hasNestedTypes || !parsed.success || parsed.data.id !== id) {
          this.deny('INVALID_VALUE', { pageId: id }, remove);
          continue;
        }
        if (this.pageIndex.size + 1 > LIMITS.maxPagesPerBoard && !this.pageIndex.has(id)) {
          this.deny('LIMIT_EXCEEDED', { pageId: id }, remove);
          continue;
        }
        const d = canCreatePage(actor.caps, actor.userId, parsed.data);
        if (!d.ok) this.deny(d.reason, { pageId: id }, remove);
      }
    }
    for (const e of events) {
      if (e.target === this.pages) continue;
      const id = e.path[0];
      if (typeof id !== 'string' || check.createdPages.has(id) || e.path.length !== 1) continue;
      for (const [field, change] of (e as Y.YMapEvent<unknown>).changes.keys) {
        const revert: Action =
          change.action === 'add'
            ? { t: 'deleteField', root: 'pages', id, field }
            : { t: 'setField', root: 'pages', id, field, value: change.oldValue };
        const shape = (pageSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>)[field];
        if (!shape) {
          this.deny('INVALID_VALUE', { pageId: id }, revert);
          continue;
        }
        const d = canEditPage(actor.caps, field as keyof PageRecord);
        if (!d.ok) {
          this.deny(d.reason, { pageId: id }, revert);
          continue;
        }
        const map = this.pages.get(id);
        const value = map instanceof Y.Map ? map.get(field) : undefined;
        if (change.action === 'delete' || value instanceof Y.AbstractType || !shape.safeParse(value).success) {
          this.deny('INVALID_VALUE', { pageId: id }, revert);
        }
      }
    }
  }

  private checkMetaEvent(event: Y.YMapEvent<unknown>): void {
    for (const [field, change] of event.changes.keys) {
      const d = canEditMeta();
      if (d.ok) continue;
      this.deny(
        d.reason,
        {},
        change.action === 'add'
          ? { t: 'deleteField', root: 'meta', id: null, field }
          : { t: 'setField', root: 'meta', id: null, field, value: change.oldValue },
      );
    }
  }

  /**
   * Проверки, требующие полной картины транзакции:
   *  - объекты, созданные на странице, создание которой отменяется, — тоже отменить;
   *  - удалённая страница, на которой остались объекты (их удаление
   *    запрещено или не было выполнено), — восстанавливается.
   */
  private postChecks(check: ActiveCheck): void {
    const removedPages = new Set(
      check.actions.filter((a): a is Extract<Action, { t: 'removeEntry' }> => a.t === 'removeEntry' && a.root === 'pages').map((a) => a.id),
    );
    const restoredObjects = new Set(
      check.actions.filter((a) => a.t === 'restoreEntry' && a.root === 'objects').map((a) => (a as { id: string }).id),
    );
    const removedObjects = new Set(
      check.actions.filter((a) => a.t === 'removeEntry' && a.root === 'objects').map((a) => (a as { id: string }).id),
    );
    if (removedPages.size) {
      for (const id of check.createdObjects) {
        const m = this.objects.get(id);
        if (!removedObjects.has(id) && m instanceof Y.Map && removedPages.has(m.get('pageId') as string)) {
          check.actions.push({ t: 'removeEntry', root: 'objects', id });
          check.violations.push({ reason: 'PAGE_NOT_FOUND', objectId: id });
        }
      }
    }
    for (const [pageId, snapshot] of check.deletedPages) {
      let orphaned = restoredObjects.size > 0 && [...restoredObjects].some((id) => this.index.get(id)?.pageId === pageId);
      if (!orphaned) {
        for (const [, value] of this.objects) {
          if (value instanceof Y.Map && value.get('pageId') === pageId) {
            orphaned = true;
            break;
          }
        }
      }
      if (orphaned) {
        check.actions.push({ t: 'restoreEntry', root: 'pages', id: pageId, snapshot });
        check.violations.push({ reason: 'NO_PAGE_RIGHTS', pageId });
      }
    }
  }

  // ------------------------------------------------------------------
  //  Компенсация и индексы
  // ------------------------------------------------------------------

  private rootMap(root: Root): Y.Map<unknown> {
    return root === 'objects' ? this.objects : root === 'pages' ? this.pages : this.meta;
  }

  private compensate(actions: Action[]): void {
    const removed = new Set<string>();
    for (const a of actions) if (a.t === 'removeEntry') removed.add(`${a.root}:${a.id}`);
    for (const a of actions) {
      switch (a.t) {
        case 'removeEntry':
          this.rootMap(a.root).delete(a.id);
          break;
        case 'restoreEntry':
          this.rootMap(a.root).set(a.id, new Y.Map(Object.entries(a.snapshot)));
          break;
        case 'setField':
        case 'deleteField': {
          if (a.id !== null && removed.has(`${a.root}:${a.id}`)) break;
          const target = a.id === null ? this.rootMap(a.root) : this.rootMap(a.root).get(a.id);
          if (!(target instanceof Y.Map)) break;
          if (a.t === 'deleteField') target.delete(a.field);
          else if (a.value === undefined) target.delete(a.field);
          else target.set(a.field, isJsonValue(a.value) ? a.value : null);
          break;
        }
      }
    }
  }

  private rebuildIndex(): void {
    this.index.clear();
    this.pageIndex.clear();
    for (const [id, value] of this.objects) this.indexObject(id, value);
    for (const [id, value] of this.pages) this.indexPage(id, value);
  }

  private indexObject(id: string, value: unknown): void {
    if (!(value instanceof Y.Map)) {
      this.index.delete(id);
      return;
    }
    const layer = value.get('layer');
    this.index.set(id, {
      createdBy: String(value.get('createdBy') ?? ''),
      locked: value.get('locked') === true,
      layer: (OBJECT_LAYERS as readonly unknown[]).includes(layer) ? (layer as ObjectLayer) : 'content',
      pageId: String(value.get('pageId') ?? ''),
    });
  }

  private indexPage(id: string, value: unknown): void {
    if (!(value instanceof Y.Map)) {
      this.pageIndex.delete(id);
      return;
    }
    this.pageIndex.set(id, { backgroundLocked: value.get('backgroundLocked') === true });
  }

  private updateIndexes(tr: Y.Transaction): void {
    const touchedObjects = new Set<string>();
    const touchedPages = new Set<string>();
    const objectsRoot: unknown = this.objects;
    const pagesRoot: unknown = this.pages;
    for (const [type, keys] of tr.changed) {
      if (type === objectsRoot) keys.forEach((k) => k && touchedObjects.add(k));
      else if (type === pagesRoot) keys.forEach((k) => k && touchedPages.add(k));
      else {
        const parentSub = type._item?.parentSub;
        const parent = type._item?.parent as unknown;
        if (parentSub && parent === objectsRoot) touchedObjects.add(parentSub);
        if (parentSub && parent === pagesRoot) touchedPages.add(parentSub);
      }
    }
    for (const id of touchedObjects) this.indexObject(id, this.objects.get(id));
    for (const id of touchedPages) this.indexPage(id, this.pages.get(id));
  }
}
