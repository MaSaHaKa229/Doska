let ctx: AudioContext | null = null;

/**
 * Короткий негромкий сигнал (поднятая рука). Без файлов: два тона через
 * WebAudio. Если браузер не дал запустить звук (нет взаимодействия со
 * страницей, звук запрещён), сигнал просто не звучит — остаётся
 * визуальное уведомление.
 */
export function playChime(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    /* звук недоступен — достаточно уведомления на экране */
  }
}
