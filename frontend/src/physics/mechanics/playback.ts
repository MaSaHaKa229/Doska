import { useEffect, useState } from 'react';
import { z } from 'zod';

/**
 * Воспроизведение анимаций физики (этап 7.2a). Состояние хранится в props
 * объекта: идёт ли, время модели t0 на момент последнего изменения и
 * момент этого изменения at (Date.now() нажавшего). Каждый участник считает
 * текущее время сам — анимация у всех одинаковая, в документ во время
 * движения ничего не пишется. Часы участников не синхронизируются:
 * расхождение — на величину разницы их часов.
 */

export const playSchema = z.object({
  running: z.boolean(),
  t0: z.number().finite().min(0).max(1e6),
  at: z.number().finite(),
});
export type Play = z.infer<typeof playSchema>;

export const PLAY0: Play = { running: false, t0: 0, at: 0 };

/** Время модели (с) в момент now: не больше tEnd. */
export function timeAt(p: Play, tEnd: number, speed: number, now: number): number {
  const t = p.running ? p.t0 + (Math.max(0, now - p.at) / 1000) * speed : p.t0;
  return Math.max(0, Math.min(tEnd, t));
}

/** «Пуск / пауза» и «Сначала». В конце «Пуск» начинает заново. */
export function playAction(key: string, p: Play, tEnd: number, speed: number, now: number): Play | null {
  const t = timeAt(p, tEnd, speed, now);
  if (key === 'toggle') {
    if (p.running && t < tEnd) return { running: false, t0: t, at: now };
    return { running: true, t0: t >= tEnd ? 0 : t, at: now };
  }
  if (key === 'reset') return { running: false, t0: 0, at: now };
  return null;
}

/** Текущее время модели с перерисовкой каждый кадр, пока анимация идёт. */
export function usePlayTime(p: Play, tEnd: number, speed: number): number {
  const [now, setNow] = useState(() => Date.now());
  const t = timeAt(p, tEnd, speed, now);
  const live = p.running && t < tEnd;
  useEffect(() => {
    if (!live) {
      setNow(Date.now());
      return;
    }
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, p.at]);
  return t;
}
