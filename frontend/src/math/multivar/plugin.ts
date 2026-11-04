import type { ReactNode } from 'react';
import { Layers, Mountain, Wind } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, multivarModules } from './objects';
import { multivarTools } from './tools';

registerIcons({ Layers, Mountain, Wind });

/**
 * Функции нескольких переменных и векторный анализ (этап 6.5a): поверхность
 * z = f(x, y) с поворотом, линиями уровня внизу и касательной плоскостью;
 * линии уровня с градиентом в точке; векторное поле с линиями тока,
 * дивергенцией и ротором. Вычисления — на math.js раздела «Графики и анализ».
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Функции нескольких переменных',
  dependsOn: ['math.analysis'],
  objects: multivarModules,
  tools: multivarTools,
};

export default plugin;
