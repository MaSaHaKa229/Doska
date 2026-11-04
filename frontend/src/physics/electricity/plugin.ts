import type { ReactNode } from 'react';
import { CircleMinus, CirclePlus, Columns2 } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { CHARGES_EDITOR, PLUGIN_ID, electricityModules } from './objects';
import { ChargesEditor } from './editor';
import { electricityTools } from './tools';

registerIcons({ CircleMinus, CirclePlus, Columns2 });

/**
 * Электричество (этап 7.3a — электростатика): система точечных зарядов
 * (силовые линии, эквипотенциали, силы Кулона, пробная точка с E и φ) и
 * плоский конденсатор (C, E, q, W).
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Электричество',
  dependsOn: ['physics.common'],
  objects: electricityModules,
  tools: electricityTools,
  editors: { [CHARGES_EDITOR]: ChargesEditor },
};

export default plugin;
