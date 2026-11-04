import type { ReactNode } from 'react';
import { Activity, Navigation2, Orbit } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, diffeqModules } from './objects';
import { diffeqTools } from './tools';

registerIcons({ Activity, Navigation2, Orbit });

/**
 * Дифференциальные уравнения (этап 6.5b): поле направлений y′ = f(x, y) с
 * интегральными кривыми через перетаскиваемые точки (Эйлер и Рунге —
 * Кутта), фазовая плоскость системы с особыми точками и их типом,
 * линейное уравнение второго порядка с постоянными коэффициентами.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Дифференциальные уравнения',
  dependsOn: ['math.analysis', 'math.multivar'],
  objects: diffeqModules,
  tools: diffeqTools,
};

export default plugin;
