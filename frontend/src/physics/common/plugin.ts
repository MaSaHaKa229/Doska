import type { ReactNode } from 'react';
import { Anchor, ArrowBigRight, ArrowRightFromLine, ArrowUpRight, Axis3d, ChevronsRight, CircleDot, Dot, Move, MoveRight, RectangleHorizontal, Ruler } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, sumModule, vectorModule } from './vectors';
import { physBodyModule, supportModule } from './bodies';
import { physAxesModule, scaleModule, SCALE_EDITOR } from './axes';
import { ScaleEditor } from './editor';
import { commonTools } from './tools';

registerIcons({ Anchor, ArrowBigRight, ArrowRightFromLine, ArrowUpRight, Axis3d, ChevronsRight, CircleDot, Dot, Move, MoveRight, RectangleHorizontal, Ruler });

/**
 * Физика: общие инструменты (этап 7.1a) — основа разделов физики.
 * Векторы величин (сила, скорость, ускорение, импульс, перемещение,
 * напряжённость) с подписями, значениями по масштабу и проекциями на оси;
 * сумма векторов; тела (брусок, шар, материальная точка) с точками
 * приложения сил; опоры со штриховкой и подвес; оси координат (в том числе
 * повёрнутые); масштаб «1 клетка — k единиц».
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Физика: общее',
  objects: [vectorModule, sumModule, physBodyModule, supportModule, physAxesModule, scaleModule],
  tools: commonTools,
  editors: { [SCALE_EDITOR]: ScaleEditor },
};

export default plugin;
