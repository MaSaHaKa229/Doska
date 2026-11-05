import type { ReactNode } from 'react';
import { ChartBar, ChartPie, Dices, GitFork } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, probModules } from './objects';
import { probTools } from './tools';

registerIcons({ ChartBar, ChartPie, Dices, GitFork });

/**
 * Вероятность и статистика (этап 6.5d): опыты с монетой, кубиком и урной
 * (частота стремится к вероятности; серия одна у всех — от зерна, показ —
 * общим механизмом воспроизведения `physics/mechanics/playback`), дерево
 * вероятностей с формулами полной вероятности и Байеса, распределения
 * (биномиальное, Пуассона, нормальное, равномерное) и статистика по данным.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Вероятность и статистика',
  dependsOn: ['math.analysis'],
  objects: probModules,
  tools: probTools,
};

export default plugin;
