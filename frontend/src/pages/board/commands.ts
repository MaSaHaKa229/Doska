import type { SerializedBoardObject } from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import { useBoard, currentCamera } from '../../store/board';
import { fitRect, viewportRect, zoomAt, type Size } from '../../canvas/camera';
import { toast } from '../../store/toast';
import { pluralize } from '../../lib/format';

/** Шаги масштаба кнопок «+»/«−» (проценты). */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 50];

/**
 * Команды доски: общие для горячих клавиш, кнопок панели и (на этапе 3.3)
 * палитры Ctrl+K. Права проверяются моделью; недоступное пропускается.
 */
export class BoardCommands {
  private pasteCount = 0;
  private lastPasted = '';

  constructor(
    private readonly model: BoardModel,
    private readonly size: () => Size,
  ) {}

  private get store() {
    return useBoard.getState();
  }

  undo(): void {
    this.model.undo.undo();
  }

  redo(): void {
    this.model.undo.redo();
  }

  selectAll(): void {
    const pageId = this.store.pageId;
    if (!pageId) return;
    const roots = new Set(this.model.pageObjects(pageId).filter((id) => this.model.get(id)?.bounds).map((id) => this.model.rootOf(id)));
    this.store.setSelection([...roots]);
  }

  deleteSelection(): void {
    const sel = this.store.selection;
    if (!sel.length) return;
    const total = this.model.leaves(sel).length;
    const deleted = this.model.deleteObjects(sel);
    this.store.setSelection([]);
    if (deleted < total) toast.info('Часть объектов нельзя удалить: они заблокированы или принадлежат другим');
  }

  copyObjects(): SerializedBoardObject[] {
    return this.model.serialize(this.store.selection);
  }

  paste(objects: SerializedBoardObject[]): void {
    const pageId = this.store.pageId;
    if (!pageId || !objects.length) return;
    // Повторная вставка того же содержимого сдвигается лесенкой.
    const key = objects.map((o) => o.id).join();
    this.pasteCount = key === this.lastPasted ? this.pasteCount + 1 : 1;
    this.lastPasted = key;
    const minX = Math.min(...objects.map((o) => o.x));
    const minY = Math.min(...objects.map((o) => o.y));
    const view = viewportRect(currentCamera(), this.size());
    const step = 24 / currentCamera().zoom;
    const inView = minX > view.x && minX < view.x + view.width && minY > view.y && minY < view.y + view.height;
    const offset = inView
      ? { x: step * this.pasteCount, y: step * this.pasteCount }
      : { x: view.x + view.width / 3 - minX, y: view.y + view.height / 3 - minY };
    const created = this.model.paste(objects, pageId, offset);
    if (created.length) this.store.setSelection(created);
    else toast.info('Нет права добавлять объекты на эту страницу');
  }

  duplicate(): void {
    const objs = this.copyObjects();
    if (objs.length) this.paste(objs);
  }

  group(): void {
    const id = this.model.group(this.store.selection);
    if (id) this.store.setSelection([id]);
  }

  ungroup(): void {
    const next: string[] = [];
    for (const id of this.store.selection) {
      if (this.model.getObject(id)?.type === 'core.group') next.push(...this.model.ungroup(id));
      else next.push(id);
    }
    this.store.setSelection(next);
  }

  reorder(where: 'front' | 'back' | 'forward' | 'backward'): void {
    this.model.reorder(this.store.selection, where);
  }

  toggleLock(): void {
    const sel = this.store.selection;
    if (!sel.length || !this.store.caps?.moderate) return;
    const anyUnlocked = this.model.leaves(sel).some((id) => !this.model.getObject(id)?.locked);
    this.model.setLocked(sel, anyUnlocked);
    toast.info(
      anyUnlocked
        ? `Заблокировано: ${sel.length} ${pluralize(sel.length, 'объект', 'объекта', 'объектов')}`
        : 'Блокировка снята',
    );
  }

  nudge(dx: number, dy: number): void {
    const leaves = this.model.leaves(this.store.selection);
    this.model.updateObjects(
      leaves.map((id) => {
        const o = this.model.getObject(id)!;
        return { id, patch: { x: o.x + dx, y: o.y + dy } };
      }),
    );
  }

  zoomTo(zoom: number): void {
    const size = this.size();
    this.store.setCamera(zoomAt(currentCamera(), size, { x: size.width / 2, y: size.height / 2 }, zoom));
  }

  zoomStep(dir: 1 | -1): void {
    const z = currentCamera().zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) : [...ZOOM_STEPS].reverse().find((s) => s < z * 0.999);
    if (next) this.zoomTo(next);
  }

  /** Показать всё содержимое страницы (или выделение). */
  fit(selectionOnly = false): void {
    const pageId = this.store.pageId;
    if (!pageId) return;
    const rect = selectionOnly ? this.model.boundsOf(this.store.selection) : this.model.pageBounds(pageId);
    if (!rect) {
      this.store.setCamera({ cx: 0, cy: 0, zoom: 1 });
      return;
    }
    this.store.setCamera(fitRect(rect, this.size()));
  }

  gotoPage(delta: 1 | -1): void {
    const pages = this.model.pages();
    const i = pages.findIndex((p) => p.id === this.store.pageId);
    const next = pages[i + delta];
    if (next) this.store.setPage(next.id);
  }
}
