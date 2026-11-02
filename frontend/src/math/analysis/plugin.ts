import type { ReactNode } from 'react';
import { ChartSpline, CircleGauge, Grid3x3, MoveHorizontal, SlidersHorizontal, Table2 } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { analysisModules } from './objects';
import { analysisTools, CURVE_EDITOR } from './tools';
import { CurveEditor } from './editor';
import { PLUGIN_ID } from './plot';

registerIcons({ ChartSpline, CircleGauge, Grid3x3, MoveHorizontal, SlidersHorizontal, Table2 });

/**
 * Графики и анализ (этап 6.2a): система координат, графики функций,
 * параметрических, полярных и неявных кривых, неравенств; слайдеры
 * параметров, таблица значений, числовая прямая, тригонометрическая
 * окружность. Анализ на графике (касательная, площадь, суммы Римана,
 * Тейлор, Фурье) — 6.2b. math.js грузится отдельной частью при первом графике.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Графики и анализ',
  objects: analysisModules,
  tools: analysisTools,
  editors: { [CURVE_EDITOR]: CurveEditor },
};

export default plugin;
