import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRightFromLine,
  Asterisk,
  ChartPie,
  ChevronLeft,
  Circle,
  CircleArrowOutUpRight,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CornerDownRight,
  Crosshair,
  Dot,
  Egg,
  Equal,
  FlipHorizontal2,
  GitCommitVertical,
  Hash,
  Hexagon,
  MoveHorizontal,
  MoveRight,
  Pentagon,
  Radius,
  Rainbow,
  RotateCcw,
  Ruler,
  Scaling,
  Slash,
  SplitSquareHorizontal,
  Waypoints,
  X,
} from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { angleModule, cpointModule, figureModules, pointModule, PLUGIN_ID, ticksModule } from './objects';
import { figureTools, pointTool } from './tools';
import { constructionTools, markTools, SECTION_CONSTRUCT, SECTION_MARKS, SECTION_TRANSFORM, transformTools } from './constructions';

registerIcons({
  ArrowDownToLine,
  ArrowRightFromLine,
  Asterisk,
  ChartPie,
  ChevronLeft,
  Circle,
  CircleArrowOutUpRight,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CornerDownRight,
  Crosshair,
  Dot,
  Egg,
  Equal,
  FlipHorizontal2,
  GitCommitVertical,
  Hash,
  Hexagon,
  MoveHorizontal,
  MoveRight,
  Pentagon,
  Radius,
  Rainbow,
  RotateCcw,
  Ruler,
  Scaling,
  Slash,
  SplitSquareHorizontal,
  Waypoints,
  X,
});

/**
 * Планиметрия: точки и фигуры на точках — динамическая геометрия (6.1a);
 * зависимые точки, построения, преобразования, отметки и измерения (6.1b).
 * Объект ссылается на опоры через deps и перестраивается, когда их двигают.
 * Чертёжные инструменты (линейка, транспортир, циркуль) — 6.1c.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Планиметрия',
  sections: {
    [SECTION_CONSTRUCT]: 'Построения',
    [SECTION_TRANSFORM]: 'Преобразования',
    [SECTION_MARKS]: 'Отметки и измерения',
  },
  objects: [pointModule, cpointModule, ...figureModules, angleModule, ticksModule],
  tools: [pointTool, ...figureTools, ...constructionTools, ...transformTools, ...markTools],
};

export default plugin;
