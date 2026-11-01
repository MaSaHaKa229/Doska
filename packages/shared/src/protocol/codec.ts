import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  MessageType,
  clientControlSchema,
  serverControlSchema,
  type ClientControlMessage,
  type ServerControlMessage,
} from './messages.js';
import { LIMITS } from '../board/object.js';

/**
 * Кодирование управляющих сообщений (тип 100) в бинарные кадры.
 * Формат: varuint(100) · varString(JSON).
 */

export function encodeControl(message: ClientControlMessage | ServerControlMessage): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Control);
  encoding.writeVarString(encoder, JSON.stringify(message));
  return encoding.toUint8Array(encoder);
}

/** Тип кадра (первый varuint) или null для пустого/битого кадра. */
export function readFrameType(frame: Uint8Array): number | null {
  if (frame.byteLength === 0) return null;
  try {
    return decoding.readVarUint(decoding.createDecoder(frame));
  } catch {
    return null;
  }
}

export type DecodeResult<T> = { ok: true; message: T } | { ok: false; error: string };

function decodeControlJson(frame: Uint8Array): DecodeResult<unknown> {
  if (frame.byteLength > LIMITS.maxMessageBytes) return { ok: false, error: 'too-large' };
  try {
    const decoder = decoding.createDecoder(frame);
    const type = decoding.readVarUint(decoder);
    if (type !== MessageType.Control) return { ok: false, error: 'not-control' };
    const json = decoding.readVarString(decoder);
    if (decoding.hasContent(decoder)) return { ok: false, error: 'trailing-bytes' };
    return { ok: true, message: JSON.parse(json) as unknown };
  } catch {
    return { ok: false, error: 'malformed' };
  }
}

/** Разбор сообщения клиента на сервере (с полной zod-валидацией). */
export function decodeClientControl(frame: Uint8Array): DecodeResult<ClientControlMessage> {
  const raw = decodeControlJson(frame);
  if (!raw.ok) return raw;
  const parsed = clientControlSchema.safeParse(raw.message);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, error: 'invalid' };
}

/** Разбор сообщения сервера на клиенте. */
export function decodeServerControl(frame: Uint8Array): DecodeResult<ServerControlMessage> {
  const raw = decodeControlJson(frame);
  if (!raw.ok) return raw;
  const parsed = serverControlSchema.safeParse(raw.message);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, error: 'invalid' };
}
