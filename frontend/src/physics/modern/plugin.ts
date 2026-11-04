import type { ReactNode } from 'react';
import { Atom, Rainbow, Rocket, SunMedium } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, modernModules } from './objects';
import { modernTools } from './tools';

registerIcons({ Atom, Rainbow, Rocket, SunMedium });

/**
 * Современная физика (этап 7.8a — относительность и кванты): замедление
 * времени и сокращение длины, энергия и сложение скоростей; фотоэффект
 * (уравнение Эйнштейна, красная граница, вольт-амперная характеристика);
 * фотон на шкале электромагнитных волн; волны де Бройля.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Современная физика',
  dependsOn: ['physics.common', 'physics.mechanics', 'physics.waves'],
  objects: modernModules,
  tools: modernTools,
};

export default plugin;
