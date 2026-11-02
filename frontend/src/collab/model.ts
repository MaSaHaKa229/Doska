import * as Y from 'yjs';
import {
  DEFAULT_BACKGROUND,
  DOC_ROOTS,
  LIMITS,
  boardObjectSchema,
  canCreateObject,
  canDeleteObject,
  canEditPage,
  canUpdateObjectField,
  compareOrder,
  createObjectBase,
  generateKeyBetween,
  generateNKeysBetween,
  newEntityId,
  pageSchema,
  transformRect,
  transformToMatrix,
  type Background,
  type BoardCapabilities,
  type BoardObject,
  type JsonValue,
  type ObjectLayer,
  type ObjectModule,
  type ObjectPatch,
  type PageRecord,
  type PluginRegistry,
  type Rect,
  type ResolveContext,
  type SerializedBoardObject,
} from '@doska/shared';
import { SpatialIndex } from '../canvas/spatial-index';

/** Origin локальных транзакций: только они попадают в историю отмены. */
export const LOCAL_ORIGIN = Symbol('local');

/** Глубина истории отмены (ТЗ: не менее 100 шагов). */
export const UNDO_DEPTH = 200;

export const LAYER_ORDER: Record<ObjectLayer, number> = { background: 0, content: 1, review: 2 };

/** Разобранный объект документа. */
export interface ObjectEntry {
  obj: BoardObject;
  /** Модуль типа; null — тип неизвестен этому клиенту (рисуется заглушкой). */
  module: ObjectModule<any, unknown> | null;
  /** props не прошли схему модуля. */
  broken: boolean;
  /** Мировой габарит (null — у объекта нет геометрии, например группа). */
  bounds: Rect | null;
}

export interface ModelOptions {
  userId: string;
  registry: PluginRegistry<unknown>;
  getCaps: () => BoardCapabilities;
  /** Владелец доски: его объекты — «учительские» для предварительной проверки прав. */
  ownerId: string;
  /**
   * Слой новых объектов, если он не задан явно. Учитель в работе ученика
   * пишет в слой review (пометки проверки), остальные — в content.
   */
  defaultLayer?: () => ObjectLayer;
}

type Listener = () => void;

const NO_COMPUTED = () => undefined;

/**
 * Модель доски поверх Y.Doc.
 *
 * Задачи:
 *  - разбор объектов через модули плагинов и кэш разобранных объектов;
 *  - индексы: объекты по страницам (в порядке отрисовки) и пространственный
 *    индекс габаритов по страницам (виртуализация, поиск под курсором);
 *  - точечные подписки: компонент объекта перерисовывается только при
 *    изменении своего объекта (useSyncExternalStore);
 *  - запись изменений одной транзакцией с LOCAL_ORIGIN (= один шаг отмены)
 *    с предварительной проверкой прав (окончательно права проверяет сервер);
 *  - отмена/повтор только собственных действий (Y.UndoManager с
 *    trackedOrigins = {LOCAL_ORIGIN}).
 */
export class BoardModel {
  readonly objectsMap: Y.Map<Y.Map<unknown>>;
  readonly pagesMap: Y.Map<Y.Map<unknown>>;
  readonly undo: Y.UndoManager;

  private readonly entries = new Map<string, ObjectEntry>();
  private readonly pageMembers = new Map<string, Set<string>>();
  private readonly pageIndex = new Map<string, SpatialIndex>();
  private readonly pageOrderCache = new Map<string, string[]>();
  private readonly children = new Map<string, Set<string>>();
  /** Динамическая геометрия: опорный объект → объекты, которые на него ссылаются (deps). */
  private readonly dependents = new Map<string, Set<string>>();
  /** Неограниченные объекты (прямая, луч) по страницам: видны при любой области. */
  private readonly unboundedIds = new Map<string, Set<string>>();
  private pagesCache: PageRecord[] | null = null;

  private readonly objectListeners = new Map<string, Set<Listener>>();
  private readonly pageListeners = new Map<string, Set<Listener>>();
  private readonly pagesListeners = new Set<Listener>();
  private readonly historyListeners = new Set<Listener>();
  private pageVersions = new Map<string, number>();
  private pagesVersion = 0;

  readonly resolve: ResolveContext;

  constructor(
    readonly doc: Y.Doc,
    private readonly opts: ModelOptions,
  ) {
    this.objectsMap = doc.getMap(DOC_ROOTS.objects) as Y.Map<Y.Map<unknown>>;
    this.pagesMap = doc.getMap(DOC_ROOTS.pages) as Y.Map<Y.Map<unknown>>;
    this.resolve = {
      getObject: (id) => this.entries.get(id)?.obj,
      getComputed: NO_COMPUTED,
      zoom: 1,
      theme: 'light',
    };
    // Уже имеющиеся объекты (документ из снимка или IndexedDB): разбор,
    // состав страниц, группы и габариты — так же, как при изменениях.
    this.applyChanges(new Set(this.objectsMap.keys()));

    this.objectsMap.observeDeep((events) => {
      const changed = new Set<string>();
      for (const e of events) {
        if (e.target === this.objectsMap) e.changes.keys.forEach((_c, key) => changed.add(key));
        else if (typeof e.path[0] === 'string') changed.add(e.path[0]);
      }
      this.applyChanges(changed);
    });
    this.pagesMap.observeDeep(() => {
      this.pagesCache = null;
      this.pagesVersion++;
      this.pagesListeners.forEach((l) => l());
    });

    this.undo = new Y.UndoManager([this.objectsMap, this.pagesMap], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 400,
    });
    this.undo.on('stack-item-added', () => {
      while (this.undo.undoStack.length > UNDO_DEPTH) this.undo.undoStack.shift();
      this.historyListeners.forEach((l) => l());
    });
    this.undo.on('stack-item-popped', () => this.historyListeners.forEach((l) => l()));
    this.undo.on('stack-cleared', () => this.historyListeners.forEach((l) => l()));
  }

  destroy(): void {
    this.undo.destroy();
  }

  get userId(): string {
    return this.opts.userId;
  }

  // ------------------------------------------------------------------
  //  Чтение
  // ------------------------------------------------------------------

  get(id: string): ObjectEntry | undefined {
    return this.entries.get(id);
  }

  getObject(id: string): BoardObject | undefined {
    return this.entries.get(id)?.obj;
  }

  /** Страницы в порядке вкладок. */
  pages(): PageRecord[] {
    if (!this.pagesCache) {
      const list: PageRecord[] = [];
      for (const [id, m] of this.pagesMap) {
        const parsed = pageSchema.safeParse(m.toJSON());
        if (parsed.success && parsed.data.id === id) list.push(parsed.data);
      }
      list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
      this.pagesCache = list;
    }
    return this.pagesCache;
  }

  page(id: string): PageRecord | undefined {
    return this.pages().find((p) => p.id === id);
  }

  /** id объектов страницы в порядке отрисовки (слой, затем z и id). */
  pageObjects(pageId: string): string[] {
    let cached = this.pageOrderCache.get(pageId);
    if (!cached) {
      const ids = [...(this.pageMembers.get(pageId) ?? [])];
      ids.sort((a, b) => {
        const oa = this.entries.get(a)!.obj;
        const ob = this.entries.get(b)!.obj;
        return LAYER_ORDER[oa.layer] - LAYER_ORDER[ob.layer] || compareOrder(oa, ob);
      });
      cached = ids;
      this.pageOrderCache.set(pageId, cached);
    }
    return cached;
  }

  /** Объекты страницы, пересекающие прямоугольник, в порядке отрисовки. */
  queryRect(pageId: string, rect: Rect): string[] {
    const index = this.pageIndex.get(pageId);
    if (!index) return [];
    const hits = new Set(index.search(rect));
    for (const id of this.unboundedIds.get(pageId) ?? []) hits.add(id);
    if (hits.size === 0) return [];
    return this.pageObjects(pageId).filter((id) => hits.has(id));
  }

  pageBounds(pageId: string): Rect | null {
    return this.pageIndex.get(pageId)?.bounds() ?? null;
  }

  /** Самый верхний объект страницы под точкой (с учётом формы через module.hitTest). */
  hitTest(pageId: string, point: { x: number; y: number }, tolerance: number): string[] {
    const candidates = this.queryRect(pageId, {
      x: point.x - tolerance,
      y: point.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    });
    const out: string[] = [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const e = this.entries.get(candidates[i]!)!;
      if (e.obj.hidden) continue;
      if (!e.module || e.broken) {
        out.push(e.obj.id); // заглушка выделяется по габариту
        continue;
      }
      if (e.module.hitTest(e.obj, point, tolerance, this.resolve)) out.push(e.obj.id);
    }
    // Точка динамической геометрии берётся раньше отрезка, проходящего через неё.
    const prio = (id: string) => this.entries.get(id)?.module?.hitPriority ?? 0;
    return out.map((id, i) => ({ id, i })).sort((a, b) => prio(b.id) - prio(a.id) || a.i - b.i).map((x) => x.id);
  }

  // ------------------------------------------------------------------
  //  Динамическая геометрия
  // ------------------------------------------------------------------

  /** Есть ли объекты, ссылающиеся на этот. */
  hasDependents(id: string): boolean {
    return (this.dependents.get(id)?.size ?? 0) > 0;
  }

  /** Все объекты, зависящие (транзитивно) от данных, кроме самих данных. */
  dependentsOf(ids: Iterable<string>): string[] {
    const start = new Set(ids);
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length) {
      const id = stack.pop()!;
      for (const d of this.dependents.get(id) ?? []) {
        if (seen.has(d) || start.has(d)) continue;
        seen.add(d);
        stack.push(d);
      }
    }
    return [...seen].filter((id) => this.entries.has(id));
  }

  /**
   * Что на самом деле двигается при перемещении объектов: обычный объект —
   * он сам, производный (отрезок, окружность) — его свободные опорные точки.
   */
  movableSet(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const e = this.entries.get(id);
      if (!e) return;
      if (e.module?.derived) e.obj.deps.forEach(visit);
      else out.add(id);
    };
    for (const id of ids) visit(id);
    return [...out];
  }

  /** Опорные объекты (транзитивно), без самих данных. */
  private depsClosure(ids: Iterable<string>): Set<string> {
    const start = new Set(ids);
    const out = new Set<string>();
    const stack = [...start];
    while (stack.length) {
      const id = stack.pop()!;
      for (const d of this.entries.get(id)?.obj.deps ?? []) {
        if (out.has(d) || start.has(d) || !this.entries.has(d)) continue;
        out.add(d);
        stack.push(d);
      }
    }
    return out;
  }

  /**
   * Порядок пересчёта зависимых объектов (топологическая сортировка: опоры
   * раньше построений). Циклы не создаются инструментами; на случай
   * испорченного документа обход их просто обрывает.
   */
  private refreshOrder(changed: Iterable<string>): string[] {
    const order: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (id: string) => {
      if (state.has(id)) return;
      state.set(id, 1);
      for (const d of this.dependents.get(id) ?? []) visit(d);
      state.set(id, 2);
      order.push(id);
    };
    for (const id of changed) visit(id);
    return order.reverse();
  }

  /**
   * Источники привязки рядом с точкой: характерные точки и кривые объектов
   * в квадрате ±radius (кроме exclude — например, перетаскиваемых объектов).
   */
  snapSources(pageId: string, point: { x: number; y: number }, radius: number, exclude: ReadonlySet<string> = new Set()) {
    const ids = this.queryRect(pageId, { x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 });
    const out: { id: string; points: ReturnType<NonNullable<ObjectModule['getSnapPoints']>>; curves: ReturnType<NonNullable<ObjectModule['getSnapCurves']>> }[] = [];
    for (const id of ids.slice(-40)) {
      if (exclude.has(id)) continue;
      const e = this.entries.get(id);
      if (!e?.module || e.broken || e.obj.hidden) continue;
      try {
        out.push({
          id,
          points: e.module.getSnapPoints?.(e.obj, this.resolve) ?? [],
          curves: e.module.getSnapCurves?.(e.obj, this.resolve) ?? [],
        });
      } catch {
        /* ошибка модуля не должна ломать привязки */
      }
    }
    return out;
  }

  /** Верхний предок по цепочке групп (что выделяется кликом). */
  rootOf(id: string): string {
    let cur = id;
    for (let guard = 0; guard < 64; guard++) {
      const g = this.entries.get(cur)?.obj.groupId;
      if (!g || !this.entries.has(g)) return cur;
      cur = g;
    }
    return cur;
  }

  /** Сам объект и все вложенные (для групп). */
  descendants(id: string, out = new Set<string>()): Set<string> {
    if (out.has(id)) return out;
    out.add(id);
    for (const c of this.children.get(id) ?? []) this.descendants(c, out);
    return out;
  }

  /** «Листья» (объекты с геометрией) для набора выделенных корней. */
  leaves(ids: Iterable<string>): string[] {
    const all = new Set<string>();
    for (const id of ids) this.descendants(id, all);
    return [...all].filter((id) => this.entries.get(id)?.bounds);
  }

  boundsOf(ids: Iterable<string>): Rect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of this.leaves(ids)) {
      const b = this.entries.get(id)!.bounds!;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  // ------------------------------------------------------------------
  //  Подписки
  // ------------------------------------------------------------------

  subscribeObject(id: string, l: Listener): () => void {
    let set = this.objectListeners.get(id);
    if (!set) this.objectListeners.set(id, (set = new Set()));
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) this.objectListeners.delete(id);
    };
  }

  /** Состав, порядок или габариты объектов страницы изменились. */
  subscribePage(pageId: string, l: Listener): () => void {
    let set = this.pageListeners.get(pageId);
    if (!set) this.pageListeners.set(pageId, (set = new Set()));
    set.add(l);
    return () => set!.delete(l);
  }

  pageVersion(pageId: string): number {
    return this.pageVersions.get(pageId) ?? 0;
  }

  subscribePages(l: Listener): () => void {
    this.pagesListeners.add(l);
    return () => this.pagesListeners.delete(l);
  }

  get pagesStamp(): number {
    return this.pagesVersion;
  }

  subscribeHistory(l: Listener): () => void {
    this.historyListeners.add(l);
    return () => this.historyListeners.delete(l);
  }

  // ------------------------------------------------------------------
  //  Синхронизация кэша с документом
  // ------------------------------------------------------------------

  private moduleFor(type: string) {
    return this.opts.registry.getObjectModule(type) ?? null;
  }

  /** Разобрать объект из Y.Map. Возвращает предыдущую запись. */
  private reparse(id: string): { before: ObjectEntry | undefined; after: ObjectEntry | undefined } {
    const before = this.entries.get(id);
    const ymap = this.objectsMap.get(id);
    if (!(ymap instanceof Y.Map)) {
      this.entries.delete(id);
      return { before, after: undefined };
    }
    const raw = boardObjectSchema.safeParse(ymap.toJSON());
    if (!raw.success) {
      this.entries.delete(id);
      return { before, after: undefined };
    }
    const module = this.moduleFor(raw.data.type);
    let obj: BoardObject = raw.data;
    let broken = false;
    if (module) {
      try {
        let props: unknown = raw.data.props;
        if (raw.data.v < module.version && module.migrate) props = module.migrate(raw.data.props, raw.data.v);
        const parsed = module.propsSchema.safeParse(props);
        if (parsed.success) obj = module.deserialize({ ...raw.data, props: parsed.data as Record<string, JsonValue> });
        else broken = true;
      } catch {
        broken = true;
      }
    }
    const after: ObjectEntry = { obj, module, broken, bounds: before?.bounds ?? null };
    this.entries.set(id, after);
    return { before, after };
  }

  private updateBounds(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    let local: Rect | null = null;
    if (e.obj.type === 'core.group') {
      local = null; // у группы нет своей геометрии
    } else if (e.module && !e.broken) {
      try {
        local = e.module.getLocalBounds(e.obj, this.resolve);
      } catch {
        local = null;
      }
    } else {
      const b = (e.obj.props as Record<string, unknown>).__bounds as Rect | undefined;
      local = b && typeof b.width === 'number' ? b : { x: 0, y: 0, width: 80, height: 40 };
    }
    e.bounds = local ? (e.module?.derived ? local : transformRect(transformToMatrix(e.obj), local)) : null;
    const index = this.indexFor(e.obj.pageId);
    if (e.bounds) index.set(id, e.bounds);
    else index.remove(id);
  }

  private indexFor(pageId: string): SpatialIndex {
    let index = this.pageIndex.get(pageId);
    if (!index) this.pageIndex.set(pageId, (index = new SpatialIndex()));
    return index;
  }

  private touchPage(pageId: string, dirty: Set<string>): void {
    this.pageOrderCache.delete(pageId);
    dirty.add(pageId);
  }

  private applyChanges(ids: Set<string>): void {
    const dirtyPages = new Set<string>();
    for (const id of ids) {
      const { before, after } = this.reparse(id);
      const b = before?.obj;
      const a = after?.obj;
      if (b && (!a || b.pageId !== a.pageId)) {
        this.pageMembers.get(b.pageId)?.delete(id);
        this.pageIndex.get(b.pageId)?.remove(id);
        this.touchPage(b.pageId, dirtyPages);
      }
      if (b?.groupId && b.groupId !== a?.groupId) this.children.get(b.groupId)?.delete(id);
      for (const d of b?.deps ?? []) this.dependents.get(d)?.delete(id);
      for (const d of a?.deps ?? []) {
        let set = this.dependents.get(d);
        if (!set) this.dependents.set(d, (set = new Set()));
        set.add(id);
      }
      if (b) this.unboundedIds.get(b.pageId)?.delete(id);
      if (a && after?.module?.unbounded && !after.broken) {
        let set = this.unboundedIds.get(a.pageId);
        if (!set) this.unboundedIds.set(a.pageId, (set = new Set()));
        set.add(id);
      }
      if (a) {
        let members = this.pageMembers.get(a.pageId);
        if (!members) this.pageMembers.set(a.pageId, (members = new Set()));
        members.add(id);
        if (a.groupId) {
          let set = this.children.get(a.groupId);
          if (!set) this.children.set(a.groupId, (set = new Set()));
          set.add(id);
        }
        this.updateBounds(id);
        // Габариты и порядок влияют на отрисовку страницы.
        this.touchPage(a.pageId, dirtyPages);
      } else {
        this.children.delete(id);
      }
      this.objectListeners.get(id)?.forEach((l) => l());
    }
    // Построения на изменённых объектах пересчитываются (локально, без записи
    // в документ): габарит, отрисовка, привязки. Изменённые производные
    // объекты — тоже: их опоры могли измениться в той же транзакции.
    const derivedChanged = [...ids].filter((id) => this.entries.get(id)?.module?.derived);
    const refresh = this.refreshOrder([...ids].filter((id) => this.dependents.get(id)?.size).concat(derivedChanged));
    for (const id of refresh) {
      const e = this.entries.get(id);
      if (!e) continue;
      if (!ids.has(id)) {
        // Новый объект записи — сигнал перерисовки для подписчиков.
        this.entries.set(id, { ...e });
      }
      if (!ids.has(id) || e.module?.derived) {
        this.updateBounds(id);
        this.touchPage(e.obj.pageId, dirtyPages);
        if (!ids.has(id)) this.objectListeners.get(id)?.forEach((l) => l());
      }
    }
    for (const p of dirtyPages) {
      this.pageVersions.set(p, (this.pageVersions.get(p) ?? 0) + 1);
      this.pageListeners.get(p)?.forEach((l) => l());
    }
  }

  // ------------------------------------------------------------------
  //  Права (предварительная проверка на клиенте)
  // ------------------------------------------------------------------

  private guardInfo(o: BoardObject) {
    return {
      createdBy: o.createdBy,
      locked: o.locked,
      layer: o.layer,
      pageId: o.pageId,
      authorIsModerator: o.createdBy === this.opts.ownerId,
    };
  }

  canModify(id: string, field = 'x'): boolean {
    const o = this.getObject(id);
    if (!o) return false;
    return canUpdateObjectField(this.opts.getCaps(), this.opts.userId, this.guardInfo(o), field, this.page(o.pageId)).ok;
  }

  canDelete(id: string): boolean {
    const o = this.getObject(id);
    if (!o) return false;
    return canDeleteObject(this.opts.getCaps(), this.opts.userId, this.guardInfo(o), this.page(o.pageId)).ok;
  }

  canCreateOn(pageId: string, layer: ObjectLayer = 'content'): boolean {
    return canCreateObject(
      this.opts.getCaps(),
      this.opts.userId,
      { createdBy: this.opts.userId, locked: false, layer, pageId, authorIsModerator: false },
      this.page(pageId),
    ).ok;
  }

  canEditPages(field?: keyof PageRecord): boolean {
    return canEditPage(this.opts.getCaps(), field).ok;
  }

  // ------------------------------------------------------------------
  //  Запись
  // ------------------------------------------------------------------

  /**
   * Транзакция = шаг отмены. По умолчанию каждое действие — отдельный шаг
   * (иначе быстрые последовательные действия склеились бы по captureTimeout).
   * merge: true — продолжение текущего жеста (перетаскивание ручки).
   * Вложенные вызовы присоединяются к внешней транзакции.
   */
  transact(fn: () => void, opts: { merge?: boolean } = {}): void {
    if (!opts.merge && !this.doc._transaction) this.undo.stopCapturing();
    this.doc.transact(fn, LOCAL_ORIGIN);
  }

  /**
   * Последний выданный верхний z-ключ по странице и слою: несколько объектов,
   * созданных в одной транзакции, ещё не видны в индексе, но должны лечь
   * друг над другом в порядке создания, а не получить одинаковый ключ.
   */
  private readonly issuedTopZ = new Map<string, string>();

  private issueTopZ(pageId: string, layer: ObjectLayer): string {
    const key = `${pageId}|${layer}`;
    const top = this.topZ(pageId, layer);
    const issued = this.issuedTopZ.get(key);
    const z = generateKeyBetween(issued && (!top || issued > top) ? issued : top, null);
    this.issuedTopZ.set(key, z);
    return z;
  }

  /** z-ключ над самым верхним объектом слоя страницы. */
  private bottomZ(pageId: string, layer: ObjectLayer): string | null {
    for (const id of this.pageObjects(pageId)) {
      const o = this.entries.get(id)!.obj;
      if (o.layer === layer) return o.z;
    }
    return null;
  }

  private topZ(pageId: string, layer: ObjectLayer): string | null {
    const ids = this.pageObjects(pageId);
    for (let i = ids.length - 1; i >= 0; i--) {
      const o = this.entries.get(ids[i]!)!.obj;
      if (o.layer === layer) return o.z;
    }
    return null;
  }

  createObject<P>(
    type: string,
    init: {
      pageId: string;
      x: number;
      y: number;
      props: P;
      deps?: string[];
      layer?: ObjectLayer;
      groupId?: string | null;
      z?: string;
      /** 'bottom' — под остальными объектами слоя (маркер). */
      placement?: 'top' | 'bottom';
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
    },
  ): string | null {
    const layer = init.layer ?? this.opts.defaultLayer?.() ?? 'content';
    if (!this.canCreateOn(init.pageId, layer)) return null;
    if (this.entries.size >= LIMITS.maxObjectsPerBoard) return null;
    const module = this.moduleFor(type);
    const id = newEntityId();
    const base = createObjectBase({
      id,
      type,
      pageId: init.pageId,
      z:
        init.z ??
        (init.placement === 'bottom'
          ? generateKeyBetween(null, this.bottomZ(init.pageId, layer))
          : this.issueTopZ(init.pageId, layer)),
      userId: this.opts.userId,
      now: Date.now(),
      v: module?.version ?? 1,
      layer,
      x: init.x,
      y: init.y,
    });
    const full = {
      ...base,
      rotation: init.rotation ?? base.rotation,
      scaleX: init.scaleX ?? base.scaleX,
      scaleY: init.scaleY ?? base.scaleY,
      deps: init.deps ?? [],
      groupId: init.groupId ?? null,
      props: init.props as Record<string, JsonValue>,
    };
    const record = module ? module.serialize(full as BoardObject) : full;
    this.transact(() => {
      this.objectsMap.set(id, new Y.Map(Object.entries(record)));
    });
    return id;
  }

  /** Изменить объекты (одна транзакция = один шаг отмены). Недоступные пропускаются. */
  updateObjects(patches: { id: string; patch: ObjectPatch<any> }[], opts: { merge?: boolean } = {}): number {
    let applied = 0;
    const now = Date.now();
    this.transact(() => {
      for (const { id, patch } of patches) {
        const ymap = this.objectsMap.get(id);
        const entry = this.entries.get(id);
        if (!ymap || !entry) continue;
        let changed = false;
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          if (!this.canModify(id, field)) continue;
          let next: unknown = value;
          if (field === 'props') {
            const merged = { ...(entry.obj.props as Record<string, unknown>), ...(value as Record<string, unknown>) };
            next = entry.module ? entry.module.serialize({ ...entry.obj, props: merged }).props : merged;
          }
          if (JSON.stringify(ymap.get(field)) === JSON.stringify(next)) continue;
          ymap.set(field, next as JsonValue);
          changed = true;
        }
        if (changed) {
          ymap.set('updatedBy', this.opts.userId);
          ymap.set('updatedAt', now);
          applied++;
        }
      }
    }, opts);
    return applied;
  }

  /** Удалить объекты (вместе с содержимым групп). Возвращает число удалённых. */
  deleteObjects(ids: Iterable<string>): number {
    const all = new Set<string>();
    for (const id of ids) this.descendants(id, all);
    // Точки, созданные инструментом вместе с построением (props.auto), уходят
    // вместе с ним, если на них больше ничего не опирается.
    for (let grew = true; grew; ) {
      grew = false;
      for (const d of this.depsClosure(all)) {
        if (all.has(d) || (this.entries.get(d)?.obj.props as { auto?: unknown } | undefined)?.auto !== true) continue;
        if ([...(this.dependents.get(d) ?? [])].every((x) => all.has(x) || !this.entries.has(x))) {
          all.add(d);
          grew = true;
        }
      }
    }
    const allowed = [...all].filter((id) => this.canDelete(id));
    if (!allowed.length) return 0;
    this.transact(() => {
      for (const id of allowed) this.objectsMap.delete(id);
    });
    return allowed.length;
  }

  /** Сгруппировать корни выделения. Возвращает id группы. */
  group(rootIds: string[]): string | null {
    const ids = rootIds.filter((id) => this.canModify(id, 'groupId'));
    if (ids.length < 2) return null;
    const first = this.getObject(ids[0]!)!;
    const pageId = first.pageId;
    if (ids.some((id) => this.getObject(id)!.pageId !== pageId)) return null;
    const parent = first.groupId;
    let groupId: string | null = null;
    this.transact(() => {
      groupId = this.createObject('core.group', { pageId, x: 0, y: 0, props: {}, groupId: parent });
      if (!groupId) return;
      for (const id of ids) this.objectsMap.get(id)?.set('groupId', groupId);
    });
    return groupId;
  }

  /** Разгруппировать: дети переходят в родительскую группу, группа удаляется. */
  ungroup(groupId: string): string[] {
    const g = this.getObject(groupId);
    if (!g || g.type !== 'core.group' || !this.canDelete(groupId)) return [];
    const kids = [...(this.children.get(groupId) ?? [])].filter((id) => this.canModify(id, 'groupId'));
    this.transact(() => {
      for (const id of kids) this.objectsMap.get(id)?.set('groupId', g.groupId);
      this.objectsMap.delete(groupId);
    });
    return kids;
  }

  /**
   * Порядок слоёв: на передний/задний план или на шаг. Меняются только z
   * перемещаемых объектов (дробные индексы, без перенумерации остальных).
   */
  reorder(rootIds: string[], where: 'front' | 'back' | 'forward' | 'backward'): void {
    const moving = new Set(this.leaves(rootIds).filter((id) => this.canModify(id, 'z')));
    if (!moving.size) return;
    const pageId = this.getObject([...moving][0]!)!.pageId;
    const layer = this.getObject([...moving][0]!)!.layer;
    const order = this.pageObjects(pageId).filter((id) => this.getObject(id)!.layer === layer);
    const sel = order.filter((id) => moving.has(id));
    const rest = order.filter((id) => !moving.has(id));
    let insertAt: number; // позиция в rest, перед которой вставить
    if (where === 'front') insertAt = rest.length;
    else if (where === 'back') insertAt = 0;
    else {
      const idxs = sel.map((id) => order.indexOf(id));
      if (where === 'forward') {
        const above = order.slice(Math.max(...idxs) + 1).find((id) => !moving.has(id));
        insertAt = above ? rest.indexOf(above) + 1 : rest.length;
      } else {
        const below = order.slice(0, Math.min(...idxs)).reverse().find((id) => !moving.has(id));
        insertAt = below ? rest.indexOf(below) : 0;
      }
    }
    const lo = insertAt > 0 ? this.getObject(rest[insertAt - 1]!)!.z : null;
    const hi = insertAt < rest.length ? this.getObject(rest[insertAt]!)!.z : null;
    let keys: string[];
    try {
      keys = generateNKeysBetween(lo, hi, sel.length);
    } catch {
      // Совпадающие соседние ключи (одновременная вставка) — ставим над lo.
      keys = generateNKeysBetween(lo, null, sel.length);
    }
    this.updateObjects(sel.map((id, i) => ({ id, patch: { z: keys[i]! } })));
  }

  setLocked(rootIds: string[], locked: boolean): void {
    this.updateObjects([...new Set(rootIds.flatMap((id) => [...this.descendants(id)]))].map((id) => ({ id, patch: { locked } })));
  }

  // ------------------------------------------------------------------
  //  Копирование и вставка
  // ------------------------------------------------------------------

  /** Объекты (с содержимым групп) в порядке отрисовки, как JSON. */
  serialize(rootIds: string[]): SerializedBoardObject[] {
    const all = new Set<string>();
    for (const id of rootIds) this.descendants(id, all);
    // Построение копируется вместе с опорами: отрезок — со своими концами.
    for (const d of this.depsClosure(all)) this.descendants(d, all);
    const out: SerializedBoardObject[] = [];
    const byPage = new Map<string, string[]>();
    for (const id of all) {
      const o = this.getObject(id);
      if (!o) continue;
      byPage.set(o.pageId, [...(byPage.get(o.pageId) ?? []), id]);
    }
    for (const [pageId, ids] of byPage) {
      const set = new Set(ids);
      const ordered = this.pageObjects(pageId).filter((id) => set.has(id));
      // Группы не в индексе страниц по габаритам, но в pageObjects есть.
      for (const id of ordered) {
        const e = this.entries.get(id)!;
        const raw = this.objectsMap.get(id)?.toJSON() as SerializedBoardObject | undefined;
        out.push(raw ?? (e.module ? e.module.serialize(e.obj) : (e.obj as SerializedBoardObject)));
      }
    }
    return out;
  }

  /**
   * Вставка объектов: новые id (ссылки в groupId и deps переписываются),
   * автор — текущий пользователь, сдвиг, поверх остальных объектов.
   */
  paste(objects: SerializedBoardObject[], pageId: string, offset: { x: number; y: number }): string[] {
    const valid = objects.filter((o) => boardObjectSchema.safeParse(o).success);
    if (!valid.length || !this.canCreateOn(pageId)) return [];
    const idMap = new Map(valid.map((o) => [o.id, newEntityId()]));
    const remap = (v: unknown): unknown => {
      if (typeof v === 'string') return idMap.get(v) ?? v;
      if (Array.isArray(v)) return v.map(remap);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
      return v;
    };
    const keys = generateNKeysBetween(this.topZ(pageId, 'content'), null, valid.length);
    const now = Date.now();
    const created: string[] = [];
    const isModerator = this.opts.getCaps().moderate;
    this.transact(() => {
      valid.forEach((o, i) => {
        const id = idMap.get(o.id)!;
        const layer: ObjectLayer = isModerator ? o.layer : 'content';
        const rec: SerializedBoardObject = {
          ...o,
          id,
          pageId,
          z: keys[i]!,
          layer,
          // У производной геометрии x, y не используются: сдвигаются её опоры.
          x: this.moduleFor(o.type)?.derived ? o.x : o.x + offset.x,
          y: this.moduleFor(o.type)?.derived ? o.y : o.y + offset.y,
          locked: isModerator ? o.locked : false,
          groupId: o.groupId ? (idMap.get(o.groupId) ?? null) : null,
          deps: o.deps.map((d) => idMap.get(d) ?? d),
          props: remap(o.props) as Record<string, JsonValue>,
          createdBy: this.opts.userId,
          createdAt: now,
          updatedBy: this.opts.userId,
          updatedAt: now,
        };
        this.objectsMap.set(id, new Y.Map(Object.entries(rec)));
        created.push(id);
      });
    });
    // Возвращаем корни (без групповых детей) — их удобно выделить.
    return created.filter((id) => {
      const g = this.objectsMap.get(id)?.get('groupId');
      return !g || !created.includes(g as string);
    });
  }

  // ------------------------------------------------------------------
  //  Страницы
  // ------------------------------------------------------------------

  addPage(title?: string, afterPageId?: string): string | null {
    return this.addPages([{ title }], afterPageId)[0] ?? null;
  }

  /**
   * Несколько страниц подряд после afterPageId (по умолчанию — в конец)
   * одной транзакцией — один шаг отмены. Фон — заданный или как у соседней
   * страницы (страница PDF не копируется); закрепить фон может только учитель.
   */
  addPages(
    specs: { title?: string; background?: Partial<Background>; backgroundLocked?: boolean }[],
    afterPageId?: string,
  ): string[] {
    if (!this.canEditPages() || !specs.length) return [];
    const pages = this.pages();
    const room = LIMITS.maxPagesPerBoard - pages.length;
    if (room <= 0) return [];
    const idx = afterPageId ? pages.findIndex((p) => p.id === afterPageId) : pages.length - 1;
    const prev = pages[idx];
    const hi = pages[idx + 1]?.order ?? null;
    let lo = prev?.order ?? null;
    const base = prev ? { ...prev.background, pdf: null } : { ...DEFAULT_BACKGROUND };
    const canLock = this.canEditPages('backgroundLocked');
    const ids: string[] = [];
    const now = Date.now();
    this.transact(() => {
      specs.slice(0, room).forEach((spec, i) => {
        const id = newEntityId();
        const order = generateKeyBetween(lo, hi);
        lo = order;
        const page: PageRecord = {
          id,
          title: (spec.title ?? `Страница ${pages.length + i + 1}`).slice(0, 100),
          order,
          background: { ...base, ...spec.background },
          backgroundLocked: !!spec.backgroundLocked && canLock,
          createdBy: this.opts.userId,
          createdAt: now,
        };
        this.pagesMap.set(id, new Y.Map(Object.entries(page)));
        ids.push(id);
      });
    });
    return ids;
  }

  renamePage(id: string, title: string): void {
    if (!this.canEditPages('title')) return;
    this.transact(() => this.pagesMap.get(id)?.set('title', title.trim().slice(0, 100) || 'Без названия'));
  }

  /** Перенести страницу так, чтобы она стояла перед beforeId (null — в конец). */
  movePage(id: string, beforeId: string | null): void {
    if (!this.canEditPages('order')) return;
    const pages = this.pages().filter((p) => p.id !== id);
    const idx = beforeId ? pages.findIndex((p) => p.id === beforeId) : pages.length;
    const lo = idx > 0 ? pages[idx - 1]!.order : null;
    const hi = idx < pages.length ? pages[idx]!.order : null;
    this.transact(() => this.pagesMap.get(id)?.set('order', generateKeyBetween(lo, hi)));
  }

  /** Удалить страницу со всеми объектами (последнюю удалить нельзя). */
  deletePage(id: string): boolean {
    if (!this.canEditPages() || this.pages().length <= 1) return false;
    const ids = [...(this.pageMembers.get(id) ?? [])];
    if (ids.some((o) => !this.canDelete(o))) return false;
    this.transact(() => {
      for (const o of ids) this.objectsMap.delete(o);
      this.pagesMap.delete(id);
    });
    return true;
  }

  setBackground(id: string, patch: Partial<Background>): void {
    if (!this.canEditPages('background')) return;
    const page = this.page(id);
    if (!page) return;
    this.transact(() => this.pagesMap.get(id)?.set('background', { ...page.background, ...patch }));
  }

  setBackgroundLocked(id: string, locked: boolean): void {
    if (!this.canEditPages('backgroundLocked')) return;
    this.transact(() => this.pagesMap.get(id)?.set('backgroundLocked', locked));
  }
}
