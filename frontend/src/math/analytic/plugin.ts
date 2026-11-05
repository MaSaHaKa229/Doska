import type { ReactNode } from 'react';
import { Locate, Plus } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { analyticModules, CONIC_EDITOR, LINE_EDITOR, PLUGIN_ID } from './objects';
import { analyticTools } from './tools';
import { ConicEditor, LineEditor } from './editor';

registerIcons({ Locate, Plus });

/**
 * Аналитическая геометрия (этап 6.3a) на системе координат раздела
 * «Графики и анализ»: прямая и кривая второго порядка по уравнению
 * (приведение к каноническому виду, фокусы, директрисы, асимптоты),
 * точки и векторы с координатами, действия с векторами, расстояние от
 * точки до прямой и угол между прямыми. Линейная алгебра — 6.3b.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Аналитическая геометрия',
  dependsOn: ['math.analysis'],
  objects: analyticModules,
  tools: analyticTools,
  editors: { [LINE_EDITOR]: LineEditor, [CONIC_EDITOR]: ConicEditor },
};

export default plugin;
