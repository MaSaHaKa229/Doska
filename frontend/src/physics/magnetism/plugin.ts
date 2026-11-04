import type { ReactNode } from 'react';
import { ArrowDownToLine, Cable, Magnet, MoveHorizontal, Orbit, RotateCw } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, magnetismModules } from './objects';
import { magnetismTools } from './tools';

registerIcons({ ArrowDownToLine, Cable, Magnet, MoveHorizontal, Orbit, RotateCw });

/**
 * Магнетизм и электромагнитная индукция (этап 7.4): поле прямого тока,
 * катушки и магнита; сила Лоренца (заряд по окружности) и сила Ампера —
 * по правилу левой руки; рамка в поле (поток, ЭДС индукции, графики) и
 * правило Ленца. Анимации — воспроизведением механики (7.2a), линии поля —
 * расчётом электростатики (7.3a).
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Магнетизм',
  dependsOn: ['physics.common', 'physics.mechanics', 'physics.electricity'],
  objects: magnetismModules,
  tools: magnetismTools,
};

export default plugin;
