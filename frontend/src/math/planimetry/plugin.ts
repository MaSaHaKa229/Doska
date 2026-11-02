import type { ReactNode } from 'react';
import { ArrowRightFromLine, ChartPie, CircleDot, CircleSlash, Dot, Egg, Hexagon, MoveHorizontal, Pentagon, Rainbow, Slash, Waypoints } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { figureModules, pointModule, PLUGIN_ID } from './objects';
import { figureTools, pointTool } from './tools';

registerIcons({ ArrowRightFromLine, ChartPie, CircleDot, CircleSlash, Dot, Egg, Hexagon, MoveHorizontal, Pentagon, Rainbow, Slash, Waypoints });

/**
 * Планиметрия (этап 6.1a): точки и фигуры на точках — динамическая
 * геометрия. Фигура ссылается на точки через deps и перестраивается, когда
 * их двигают. Построения, преобразования и отметки — 6.1b, чертёжные
 * инструменты — 6.1c.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Планиметрия',
  objects: [pointModule, ...figureModules],
  tools: [pointTool, ...figureTools],
};

export default plugin;
