import type { ReactNode } from 'react';
import { Box, Cone, Cuboid, Cylinder, Database, Globe, Hexagon, PanelsTopLeft, PenLine, Pyramid, Rotate3d, Triangle } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, SCENE_EDITOR, stereoModules } from './objects';
import { netModule } from './nets';
import { stereoTools } from './tools';
import { StereoEditor } from './editor';

registerIcons({ Box, Cone, Cuboid, Cylinder, Database, Globe, Hexagon, PanelsTopLeft, PenLine, Pyramid, Rotate3d, Triangle });

/**
 * Стереометрия (этапы 6.4a, 6.4b): 3D-сцена — один объект доски, внутри
 * которого тела (многогранники и тела вращения) и построения (точки,
 * отрезки, прямые, плоскости, сечения, расстояния и углы). На доске —
 * чертёж «как в учебнике» (невидимые линии пунктиром, подписи вершин),
 * двойной щелчок открывает 3D-редактор (three.js) с вращением, правкой тел
 * и построениями щелчком. Развёртка тела — отдельный объект; «Плоский
 * чертёж» переводит сцену в объекты планиметрии.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Стереометрия',
  // «Плоский чертёж» создаёт точки и отрезки планиметрии.
  dependsOn: ['math.planimetry'],
  objects: [...stereoModules, netModule],
  tools: stereoTools,
  editors: { [SCENE_EDITOR]: StereoEditor },
  // Ученик без права записи вращает сцену у себя (и следует за учителем).
  viewers: [SCENE_EDITOR],
};

export default plugin;
