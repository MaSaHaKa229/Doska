import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { INTERFERENCE_TYPE, SOUND_TYPE, STANDING_TYPE, WAVE_TYPE, interferenceModule, soundModule, standingModule, waveModule } from './wavemodules';
import { BEATS_TYPE, LC_TYPE, OSC_TYPE, PENDULUM_TYPE, PLUGIN_ID, beatsModule, lcModule, oscModule, pendulumModule } from './objects';

/** Объект щелчком: точка щелчка — опорная точка чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'physics',
    section: PLUGIN_ID,
    keywords: [...keywords, 'колебания', 'физика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const wavesTools: ToolModule<ReactNode>[] = [
  placeTool('pendulum', 'Математический маятник', 'Anchor', PENDULUM_TYPE, pendulumModule.createProps, ['маятник', 'математический маятник', 'период колебаний', 'нить', 'гармонические колебания']),
  placeTool('oscillator', 'Затухающие и вынужденные колебания', 'Activity', OSC_TYPE, oscModule.createProps, ['затухающие колебания', 'вынужденные колебания', 'резонанс', 'резонансная кривая', 'амплитуда']),
  placeTool('beats', 'Сложение колебаний', 'AudioWaveform', BEATS_TYPE, beatsModule.createProps, ['сложение колебаний', 'биения', 'суперпозиция']),
  placeTool('lc', 'Колебательный контур', 'Radio', LC_TYPE, lcModule.createProps, ['колебательный контур', 'lc-контур', 'формула томсона', 'электромагнитные колебания', 'энергия контура']),
  placeTool('wave', 'Бегущая волна', 'Waves', WAVE_TYPE, waveModule.createProps, ['волна', 'бегущая волна', 'поперечная волна', 'продольная волна', 'длина волны', 'скорость волны']),
  placeTool('standing', 'Стоячая волна', 'AudioLines', STANDING_TYPE, standingModule.createProps, ['стоячая волна', 'узлы', 'пучности', 'гармоники', 'струна']),
  placeTool('sound', 'Звук', 'Volume2', SOUND_TYPE, soundModule.createProps, ['звук', 'громкость', 'высота тона', 'частота звука', 'камертон', 'ультразвук', 'инфразвук']),
  placeTool('interference', 'Интерференция волн', 'Radar', INTERFERENCE_TYPE, interferenceModule.createProps, ['интерференция', 'когерентные источники', 'разность хода', 'максимум', 'минимум']),
];
