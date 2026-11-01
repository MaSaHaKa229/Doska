import type { AssetView, Point } from '@doska/shared';
import { assetsApi } from '../api/assets';
import { errorMessage } from '../api/http';
import { toast } from '../store/toast';
import { isImageFile, isPdfFile, prepareImage } from './prepareImage';

/** Открыть системный выбор файлов (картинки и PDF). */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,.pdf';
    // Поле должно быть в документе: иначе часть браузеров не сообщает о выборе.
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(input.files ? [...input.files] : []);
    // Окно закрыли без выбора (событие cancel есть не везде — тогда промис просто не разрешится).
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

/** Событие «вставить файлы» от инструмента панели (он не знает о командах доски). */
export const INSERT_FILES_EVENT = 'doska:insert-files';
export interface InsertFilesDetail {
  files: File[];
  at: Point | null;
}

export function requestInsertFiles(files: File[], at: Point | null): void {
  window.dispatchEvent(new CustomEvent<InsertFilesDetail>(INSERT_FILES_EVENT, { detail: { files, at } }));
}

/** Размер картинки на доске: натуральный на экране, но не больше max (мировые единицы). */
export function imageDisplaySize(naturalW: number, naturalH: number, zoom: number, max: number): { w: number; h: number } {
  let w = naturalW / zoom;
  let h = naturalH / zoom;
  const k = Math.min(1, max / Math.max(w, h));
  w *= k;
  h *= k;
  return { w, h };
}

export type UploadResult = { kind: 'image'; asset: AssetView } | { kind: 'pdf'; asset: AssetView; name: string } | null;

/** Подготовить и загрузить один файл; ошибки показываются пользователю. */
export async function uploadFile(boardId: string, file: File): Promise<UploadResult> {
  const pdf = isPdfFile(file);
  if (!pdf && !isImageFile(file)) {
    toast.error(`«${file.name}»: можно вставить картинку (PNG, JPEG, GIF, WebP, SVG) или PDF`);
    return null;
  }
  try {
    if (pdf) {
      const { asset } = await assetsApi.upload(boardId, file, file.name);
      return { kind: 'pdf', asset, name: file.name };
    }
    const prepared = await prepareImage(file);
    const { asset } = await assetsApi.upload(boardId, prepared.blob, prepared.name);
    return { kind: 'image', asset };
  } catch (err) {
    toast.error(`«${file.name}»: ${errorMessage(err) || 'не удалось загрузить'}`);
    return null;
  }
}
