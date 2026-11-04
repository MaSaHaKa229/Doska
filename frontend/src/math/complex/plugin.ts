import type { ReactNode } from 'react';
import { CircleDashed, Compass } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, complexModules } from './objects';
import { complexTools } from './tools';

registerIcons({ CircleDashed, Compass });

/**
 * Комплексные числа (этап 6.5c): комплексная плоскость с перетаскиваемыми
 * числами, тремя формами записи и действиями с построением (сумма,
 * разность, произведение, частное, сопряжение, степень, корни);
 * множества на плоскости по условию на z.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Комплексные числа',
  dependsOn: ['math.analysis', 'math.multivar'],
  objects: complexModules,
  tools: complexTools,
};

export default plugin;
