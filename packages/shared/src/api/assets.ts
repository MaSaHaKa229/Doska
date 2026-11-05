/**
 * Файлы (/api/boards/:id/assets, /api/assets/:id): картинки и PDF.
 * Тип определяет сервер по содержимому файла; метаданные картинок удаляются.
 */

export const ASSET_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const ASSET_MIMES = [...ASSET_IMAGE_MIMES, 'application/pdf'] as const;
export type AssetMimeType = (typeof ASSET_MIMES)[number];

export interface AssetView {
  id: string;
  kind: 'IMAGE' | 'PDF';
  mime: AssetMimeType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  /** Адрес содержимого (тот же сайт, нужен вход). */
  url: string;
}

export function assetUrl(id: string): string {
  return `/api/assets/${id}`;
}
