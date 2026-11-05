import type { ReactNode } from 'react';
import { Disc, Merge, Rocket, Route, Scale, TriangleRight, Waves } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { MOTION_EDITOR, PLUGIN_ID, mechanicsModules } from './objects';
import { MotionEditor } from './editor';
import { dynamicsModules } from './machines';
import { mechanicsTools } from './tools';

registerIcons({ Disc, Merge, Rocket, Route, Scale, TriangleRight, Waves });

/**
 * Механика (этап 7.2a — кинематика): движение по закону x(t), y(t) и бросок
 * под углом к горизонту — анимации, общие у всех участников (кнопки «Пуск /
 * пауза», «Сначала» на панели свойств), траектория, скорость и её проекции,
 * графики x(t), v(t) на осях 6.2 (7.2a). Динамика и законы сохранения
 * (7.2b): наклонная плоскость, блок с грузами, пружинный маятник с
 * диаграммой энергий, столкновение шаров, рычаг.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Механика',
  dependsOn: ['physics.common'],
  objects: [...mechanicsModules, ...dynamicsModules],
  tools: mechanicsTools,
  editors: { [MOTION_EDITOR]: MotionEditor },
};

export default plugin;
