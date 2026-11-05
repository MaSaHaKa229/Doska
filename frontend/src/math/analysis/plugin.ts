import type { ReactNode } from 'react';
import {
  AreaChart,
  AudioWaveform,
  ChartArea,
  ChartColumn,
  ChartSpline,
  ChevronsUpDown,
  CircleGauge,
  CircleOff,
  Grid3x3,
  MapPin,
  MoveHorizontal,
  SlidersHorizontal,
  Spline,
  Table2,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { analysisModules } from './objects';
import { analysisTools, CURVE_EDITOR } from './tools';
import { CurveEditor } from './editor';
import { PLUGIN_ID } from './plot';
import { calculusModules } from './features';
import { calculusTools, SECTION_CALCULUS } from './calculus-tools';

registerIcons({
  AreaChart,
  AudioWaveform,
  ChartArea,
  ChartColumn,
  ChartSpline,
  ChevronsUpDown,
  CircleGauge,
  CircleOff,
  Grid3x3,
  MapPin,
  MoveHorizontal,
  SlidersHorizontal,
  Spline,
  Table2,
  Target,
  TrendingUp,
});

/**
 * Графики и анализ (этап 6.2a): система координат, графики функций,
 * параметрических, полярных и неявных кривых, неравенств; слайдеры
 * параметров, таблица значений, числовая прямая, тригонометрическая
 * окружность (6.2a); анализ на графике — особые точки, касательная и
 * секущая, площадь, суммы Римана, ε-δ, Тейлор, Фурье (6.2b). math.js
 * грузится отдельной частью при первом графике.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Графики и анализ',
  sections: { [SECTION_CALCULUS]: 'Анализ на графике' },
  objects: [...analysisModules, ...calculusModules],
  tools: [...analysisTools, ...calculusTools],
  editors: { [CURVE_EDITOR]: CurveEditor },
};

export default plugin;
