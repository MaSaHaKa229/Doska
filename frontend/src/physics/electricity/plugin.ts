import type { ReactNode } from 'react';
import { Activity, BatteryFull, CircleMinus, CirclePlus, Columns2, Gauge, Lightbulb, RectangleHorizontal, SlidersHorizontal, Spline, ToggleLeft } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { CHARGES_EDITOR, PLUGIN_ID, electricityModules } from './objects';
import { ChargesEditor } from './editor';
import { CIRCUIT_EDITOR, CircuitEditor, circuitModule } from './circuits';
import { electricityTools } from './tools';

registerIcons({ Activity, BatteryFull, CircleMinus, CirclePlus, Columns2, Gauge, Lightbulb, RectangleHorizontal, SlidersHorizontal, Spline, ToggleLeft });

/**
 * Электричество (этап 7.3a — электростатика): система точечных зарядов
 * (силовые линии, эквипотенциали, силы Кулона, пробная точка с E и φ) и
 * плоский конденсатор (C, E, q, W). Цепи постоянного тока (7.3b): схема из
 * элементов на узлах сетки, расчёт методом узловых потенциалов, показания
 * приборов, лампы по мощности, ключи щелчком.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Электричество',
  dependsOn: ['physics.common'],
  sections: { [`${PLUGIN_ID}.circuits`]: 'Электрические цепи' },
  objects: [...electricityModules, circuitModule],
  tools: electricityTools,
  editors: { [CHARGES_EDITOR]: ChargesEditor, [CIRCUIT_EDITOR]: CircuitEditor },
};

export default plugin;
