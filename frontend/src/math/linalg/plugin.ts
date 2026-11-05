import type { ReactNode } from 'react';
import { Grid2x2, ListChecks, Minus, Move3d, SquareFunction, Undo2 } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { linalgModules, MATRIX_EDITOR, PLUGIN_ID } from './objects';
import { linalgTools } from './tools';
import { MatrixEditor } from './editor';

registerIcons({ Grid2x2, ListChecks, Minus, Move3d, SquareFunction, Undo2 });

/**
 * Линейная алгебра (этап 6.3b): матрица, действия с матрицами (точно, в
 * дробях; результат пересчитывается при правке исходных), метод Гаусса по
 * шагам с ответом для системы, линейное преобразование плоскости на осях.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Линейная алгебра',
  dependsOn: ['math.analysis'],
  objects: linalgModules,
  tools: linalgTools,
  editors: { [MATRIX_EDITOR]: MatrixEditor },
};

export default plugin;
