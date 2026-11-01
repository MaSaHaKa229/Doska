import { noWriteHint, type AssetView, type Point, type SerializedBoardObject } from '@doska/shared';
import { imageDisplaySize, uploadFile } from '../../media/insert';
import { IMAGE_TYPE, type ImageProps } from '../../objects/image';
import { DEFAULT_TEXT_WIDTH, TEXT_TYPE, type TextProps } from '../../objects/text';
import { normalizeDoc, plainTextToDoc } from '../../text/schema';
import { measureTextHeight } from '../../text/render';
import type { BoardModel } from '../../collab/model';
import { useBoard, currentCamera } from '../../store/board';
import { fitRect, viewportRect, zoomAt, type Size } from '../../canvas/camera';
import { toast } from '../../store/toast';
import { pluralize } from '../../lib/format';
import { registry } from '../../plugins/registry';

/** Шаги масштаба кнопок «+»/«−» (проценты). */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 50];

/**
 * Команды доски: общие для горячих клавиш, кнопок панели и (на этапе 3.3)
 * палитры Ctrl+K. Права проверяются моделью; недоступное пропускается.
 */
export class BoardCommands {
  private pasteCount = 0;
  private lastPasted = '';
  /** Диалог импорта PDF (задаёт страница доски). */
  pdfHandler: ((asset: AssetView, name: string) => void) | null = null;

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

  /** Вставить объект плагина в центр экрана (палитра Ctrl+K). */
  insertAtCenter(objectType: string, props: Record<string, unknown>): void {
    const pageId = this.store.pageId;
    if (!pageId) return;
    const module = registry.getObjectModule(objectType);
    if (!module) {
      toast.error('Этот тип объекта недоступен');
      return;
    }
    const cam = currentCamera();
    const full = { ...(module.createProps() as Record<string, unknown>), ...props };
    const id = this.model.createObject(objectType, { pageId, x: cam.cx, y: cam.cy, props: full });
    if (id) this.store.setSelection([id]);
    else toast.info('Нет права добавлять объекты на эту страницу');
  }

  /**
   * Вставить файлы (буфер обмена, перетаскивание, выбор файла): картинки —
   * объектами в точке at (по умолчанию в центре экрана) лесенкой, PDF —
   * через диалог импорта страниц.
   */
  async insertFiles(files: File[], at: Point | null = null): Promise<void> {
    const s = this.store;
    const boardId = s.board?.id;
    if (!boardId || !s.pageId || !files.length) return;
    if (!s.caps?.write) {
      toast.info(noWriteHint(s.caps?.noWriteReason ?? 'read-only') ?? 'Нет права записи');
      return;
    }
    const cam = currentCamera();
    const center = at ?? { x: cam.cx, y: cam.cy };
    const view = viewportRect(cam, this.size());
    const max = Math.min(view.width, view.height) * 0.6;
    const created: string[] = [];
    const busy = files.length > 1 ? `Загрузка файлов: ${files.length}…` : `Загрузка «${files[0]!.name}»…`;
    toast.info(busy);
    for (const [i, file] of files.entries()) {
      const r = await uploadFile(boardId, file);
      if (!r) continue;
      if (r.kind === 'pdf') {
        this.pdfHandler?.(r.asset, r.name);
        continue;
      }
      const pageId = this.store.pageId;
      if (!pageId) return;
      const { asset } = r;
      const { w, h } = imageDisplaySize(asset.width ?? 100, asset.height ?? 100, cam.zoom, max);
      const shift = (i * 24) / cam.zoom;
      const id = this.model.createObject<ImageProps>(IMAGE_TYPE, {
        pageId,
        x: center.x - w / 2 + shift,
        y: center.y - h / 2 + shift,
        props: { assetId: asset.id, w, h, naturalW: asset.width ?? 100, naturalH: asset.height ?? 100, crop: null, alt: asset.originalName ?? undefined },
      });
      if (id) created.push(id);
      else toast.info('Нет права добавлять объекты на эту страницу');
    }
    if (created.length) this.store.setSelection(created);
  }

  /** Обычный текст из буфера → текстовый блок в центре экрана. */
  insertText(text: string): void {
    const pageId = this.store.pageId;
    if (!pageId || !text.trim()) return;
    if (!this.store.caps?.write) {
      toast.info(noWriteHint(this.store.caps?.noWriteReason ?? 'read-only') ?? 'Нет права записи');
      return;
    }
    const cam = currentCamera();
    const doc = normalizeDoc(plainTextToDoc(text));
    const w = (DEFAULT_TEXT_WIDTH * 1.4) / cam.zoom;
    const h = measureTextHeight(doc, w);
    const id = this.model.createObject<TextProps>(TEXT_TYPE, { pageId, x: cam.cx - w / 2, y: cam.cy - Math.min(h, 400 / cam.zoom) / 2, props: { doc, w, h, fill: 'none' } });
    if (id) this.store.setSelection([id]);
    else toast.info('Нет права добавлять объекты на эту страницу');
  }

  gotoPage(delta: 1 | -1): void {
    const pages = this.model.pages();
    const i = pages.findIndex((p) => p.id === this.store.pageId);
    const next = pages[i + delta];
    if (next) this.store.setPage(next.id, 'system');
  }
}
