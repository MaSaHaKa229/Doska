import { z } from 'zod';

/** JSON-значение, допустимое в полях объектов Yjs-документа. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Максимальная глубина вложенности JSON в свойствах объектов. */
export const MAX_JSON_DEPTH = 16;

/**
 * Проверка «это чистый JSON с ограниченной глубиной и конечными числами».
 * Используется сервером для всех значений, пришедших в Yjs-обновлениях
 * (вложенные Y-типы внутри объектов запрещены — см. docs/BOARD_MODEL.md).
 */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value as Record<string, unknown>).every((v) => isJsonValue(v, depth + 1));
    }
    default:
      return false;
  }
}

/** Приблизительный размер JSON-значения в байтах UTF-8. */
export function jsonByteSize(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>((v) => isJsonValue(v), {
  message: 'Ожидалось JSON-значение',
});
