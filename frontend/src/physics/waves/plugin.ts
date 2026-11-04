import type { ReactNode } from 'react';
import { AudioWaveform, Radio } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, wavesModules } from './objects';
import { wavesTools } from './tools';

registerIcons({ AudioWaveform, Radio });

/**
 * Колебания и волны (этап 7.5a — колебания): математический маятник,
 * затухающие и вынужденные колебания с резонансной кривой, сложение
 * колебаний (биения), колебательный контур с энергиями. Анимации и
 * «Графики» — механики (7.2a).
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Колебания и волны',
  dependsOn: ['physics.common', 'physics.mechanics', 'physics.electricity'],
  objects: wavesModules,
  tools: wavesTools,
};

export default plugin;
