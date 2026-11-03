import type { ReactNode } from 'react';
import { Box, Cone, Cuboid, Cylinder, Database, Globe, Hexagon, Pyramid, Rotate3d, Triangle } from 'lucide-react';
import type { BoardPlugin } from '@doska/shared';
import { registerIcons } from '../../ui/icons';
import { PLUGIN_ID, SCENE_EDITOR, stereoModules } from './objects';
import { stereoTools } from './tools';
import { StereoEditor } from './editor';

registerIcons({ Box, Cone, Cuboid, Cylinder, Database, Globe, Hexagon, Pyramid, Rotate3d, Triangle });

/**
 * Стереометрия (этап 6.4a): 3D-сцена — один объект доски, внутри которого
 * тела (многогранники и тела вращения). На доске — чертёж «как в учебнике»
 * (невидимые линии пунктиром, подписи вершин), двойной щелчок открывает
 * 3D-редактор (three.js) с вращением и правкой тел.
 */
const plugin: BoardPlugin<ReactNode> = {
  id: PLUGIN_ID,
  title: 'Стереометрия',
  objects: stereoModules,
  tools: stereoTools,
  editors: { [SCENE_EDITOR]: StereoEditor },
  // Ученик без права записи вращает сцену у себя (и следует за учителем).
  viewers: [SCENE_EDITOR],
};

export default plugin;
