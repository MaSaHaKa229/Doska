import type { ReactNode } from 'react';
import { AudioLines, AudioWaveform, Radar, Radio, Volume2, Waves } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, wavesModules } from './objects';
import { wavesTools } from './tools';
import { waveModules } from './wavemodules';

registerIcons({ AudioLines, AudioWaveform, Radar, Radio, Volume2, Waves });

/**
 * Колебания и волны (этап 7.5a — колебания): математический маятник,
 * затухающие и вынужденные колебания с резонансной кривой, сложение
 * колебаний (биения), колебательный контур с энергиями. Волны (7.5b):
 * бегущая (поперечная и продольная), стоячая, звук (с прослушиванием),
 * интерференция от двух источников. Анимации и «Графики» — механики (7.2a).
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Колебания и волны',
  dependsOn: ['physics.common', 'physics.mechanics', 'physics.electricity'],
  objects: [...wavesModules, ...waveModules],
  tools: wavesTools,
};

export default plugin;
