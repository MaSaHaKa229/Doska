import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import { decodeClientControl, decodeServerControl, encodeControl, readFrameType } from './codec.js';
import { MessageType, awarenessStateSchema, EMPTY_AWARENESS, capabilitiesSchema } from './messages.js';
import { computeCapabilities } from '../permissions/capabilities.js';
import { DEFAULT_BOARD_SETTINGS } from '../board/settings.js';

const U = '11111111-1111-4111-8111-111111111111';

describe('кодек управляющих сообщений', () => {
  it('клиентское сообщение: кодирование и разбор', () => {
    const frame = encodeControl({ t: 'mode.set', mode: 'SELECTIVE' });
    expect(readFrameType(frame)).toBe(MessageType.Control);
    expect(decodeClientControl(frame)).toEqual({ ok: true, message: { t: 'mode.set', mode: 'SELECTIVE' } });
  });

  it('недопустимые сообщения отклоняются', () => {
    expect(decodeClientControl(encodeControl({ t: 'mode.set', mode: 'PARTY' } as never)).ok).toBe(false);
    expect(decodeClientControl(encodeControl({ t: 'chalk.set', userId: 'not-uuid', granted: true } as never)).ok).toBe(
      false,
    );
    expect(decodeClientControl(new Uint8Array([100, 3, 123, 123, 123])).ok).toBe(false);
    expect(decodeClientControl(new Uint8Array([])).ok).toBe(false);
    // Не управляющий кадр
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    expect(decodeClientControl(encoding.toUint8Array(enc))).toEqual({ ok: false, error: 'not-control' });
  });

  it('серверное сообщение с правами проходит схему', () => {
    const capabilities = computeCapabilities({
      user: { id: U, role: 'TEACHER' },
      board: { kind: 'LESSON', mode: 'LECTURE', ownerId: U, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
      memberRole: null,
      studentViaClass: false,
      teachesOwner: false,
      hasChalk: false,
    });
    // Схема протокола и тип BoardCapabilities должны совпадать полностью.
    expect(capabilitiesSchema.strict().safeParse(capabilities).success).toBe(true);
    const frame = encodeControl({ t: 'capabilities', capabilities });
    const res = decodeServerControl(frame);
    expect(res.ok).toBe(true);
  });

  it('awareness: лимиты на размер следа', () => {
    expect(awarenessStateSchema.safeParse(EMPTY_AWARENESS).success).toBe(true);
    const tooLong = { ...EMPTY_AWARENESS, laser: { pageId: 'page000001', points: new Array(5000).fill(0) } };
    expect(awarenessStateSchema.safeParse(tooLong).success).toBe(false);
  });
});
