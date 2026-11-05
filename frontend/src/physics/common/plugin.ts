import type { ReactNode } from 'react';
import { Anchor, ArrowBigRight, ArrowRightFromLine, ArrowUpRight, Axis3d, ChartSpline, ChevronsRight, CircleDot, ClipboardList, Dot, Move, MoveRight, RectangleHorizontal, Ruler } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, sumModule, vectorModule } from './vectors';
import { physBodyModule, supportModule } from './bodies';
import { physAxesModule, scaleModule, SCALE_EDITOR } from './axes';
import { ScaleEditor } from './editor';
import { GIVEN_EDITOR, givenModule } from './given';
import { GivenEditor } from './given-editor';
import { GRAPH_EDITOR, GraphEditor } from './graph';
import { CONSTANTS } from './constants';
import { commonTools } from './tools';

registerIcons({ Anchor, ArrowBigRight, ArrowRightFromLine, ArrowUpRight, Axis3d, ChartSpline, ChevronsRight, CircleDot, ClipboardList, Dot, Move, MoveRight, RectangleHorizontal, Ruler });

/**
 * Физика: общие инструменты (этап 7.1a) — основа разделов физики.
 * Векторы величин (сила, скорость, ускорение, импульс, перемещение,
 * напряжённость) с подписями, значениями по масштабу и проекциями на оси;
 * сумма векторов; тела (брусок, шар, материальная точка) с точками
 * приложения сил; опоры со штриховкой и подвес; оси координат (в том числе
 * повёрнутые); масштаб «1 клетка — k единиц» (7.1a). Блок «Дано / Найти /
 * Решение» с переводом в СИ и проверкой размерности, физические постоянные
 * в Ctrl+K, графики зависимостей на осях 6.2 (7.1b).
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Физика: общее',
  // Графики зависимостей строятся на осях раздела 6.2.
  dependsOn: ['math.analysis'],
  objects: [vectorModule, sumModule, physBodyModule, supportModule, physAxesModule, scaleModule, givenModule],
  tools: commonTools,
  editors: { [SCALE_EDITOR]: ScaleEditor, [GIVEN_EDITOR]: GivenEditor, [GRAPH_EDITOR]: GraphEditor },
  // Физические постоянные в Ctrl+K: вставка формулой в центр экрана.
  commands: CONSTANTS.map((c) => ({
    id: `${PLUGIN_ID}.const.${c.key}`,
    title: `${c.title}: ${c.sym.replace('eps0', 'ε₀').replace('mu0', 'μ₀')}`,
    keywords: [...c.keywords, 'постоянная', 'константа', 'физика'],
    section: 'Физические постоянные',
    action: { kind: 'insert' as const, objectType: 'core.formula', props: { latex: c.latex, size: 28, color: 'ink' } },
  })),
};

export default plugin;
