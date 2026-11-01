import { boardObjectSchema, type SerializedBoardObject } from '@doska/shared';

/**
 * Буфер обмена объектов доски. Используется системный буфер (события
 * copy/cut/paste — без запроса разрешений), поэтому объекты можно
 * переносить между досками и вкладками. Формат: префикс + JSON.
 */
export const CLIPBOARD_PREFIX = 'doska-objects:v1:';
const MAX_CLIPBOARD_OBJECTS = 2000;

export function encodeClipboard(objects: SerializedBoardObject[]): string {
  return CLIPBOARD_PREFIX + JSON.stringify(objects);
}

export function decodeClipboard(text: string | null | undefined): SerializedBoardObject[] | null {
  if (!text || !text.startsWith(CLIPBOARD_PREFIX)) return null;
  try {
    const data = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as unknown;
    if (!Array.isArray(data) || data.length > MAX_CLIPBOARD_OBJECTS) return null;
    const valid = data.filter((o) => boardObjectSchema.safeParse(o).success) as SerializedBoardObject[];
    return valid.length ? valid : null;
  } catch {
    return null;
  }
}
