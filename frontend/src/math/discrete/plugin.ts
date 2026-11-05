import type { ReactNode } from 'react';
import { Binary, Network, Shuffle, ToggleLeft } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, discreteModules } from './objects';
import { discreteTools } from './tools';

registerIcons({ Binary, Network, Shuffle, ToggleLeft });

/**
 * Дискретная математика (этап 6.5e): граф с перетаскиваемыми вершинами и
 * рёбрами текстом (степени, связность, обходы, Дейкстра, остов, эйлеров
 * путь — по шагам), комбинаторика с перечислением вариантов и
 * треугольником Паскаля, таблица истинности с СДНФ, СКНФ и кругами
 * Эйлера — Венна, перевод между системами счисления с записью решения.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Дискретная математика',
  dependsOn: ['math.multivar'],
  objects: discreteModules,
  tools: discreteTools,
};

export default plugin;
