import type { ReactNode } from 'react';
import { Atom, Crosshair, FlaskConical, Hexagon, Orbit, Radiation, Rainbow, Rocket, SunMedium } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { atomModules } from './atoms';
import { PLUGIN_ID, modernModules } from './objects';
import { modernTools } from './tools';

registerIcons({ Atom, Crosshair, FlaskConical, Hexagon, Orbit, Radiation, Rainbow, Rocket, SunMedium });

/**
 * Современная физика (этап 7.8a — относительность и кванты): замедление
 * времени и сокращение длины, энергия и сложение скоростей; фотоэффект
 * (уравнение Эйнштейна, красная граница, вольт-амперная характеристика);
 * фотон на шкале электромагнитных волн; волны де Бройля. Атом и ядро
 * (7.8b): модель Бора и спектр водорода, опыт Резерфорда, энергия связи,
 * радиоактивный распад, ядерные реакции с проверкой законов сохранения.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Современная физика',
  dependsOn: ['physics.common', 'physics.mechanics', 'physics.waves'],
  objects: [...modernModules, ...atomModules],
  tools: modernTools,
};

export default plugin;
