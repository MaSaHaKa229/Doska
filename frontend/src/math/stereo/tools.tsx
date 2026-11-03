import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { PLUGIN_ID, SCENE_EDITOR, SCENE_TYPE, sceneWith, type SceneProps } from './objects';
import { BODY_TITLES, type BodyKind } from './solids';

const section = PLUGIN_ID;

const ICONS: Record<BodyKind, string> = {
  cube: 'Box',
  box: 'Cuboid',
  prism: 'Hexagon',
  pyramid: 'Pyramid',
  frustum: 'Triangle',
  cylinder: 'Cylinder',
  cone: 'Cone',
  tcone: 'Database',
  sphere: 'Globe',
};

const KEYWORDS: Record<BodyKind, string[]> = {
  cube: ['куб', 'гексаэдр', 'abcda1b1c1d1'],
  box: ['параллелепипед', 'прямоугольный параллелепипед', 'кирпич', 'брусок'],
  prism: ['призма', 'треугольная призма', 'шестиугольная призма', 'наклонная призма'],
  pyramid: ['пирамида', 'четырёхугольная пирамида', 'тетраэдр', 'правильная пирамида'],
  frustum: ['усечённая пирамида', 'усеченная пирамида'],
  cylinder: ['цилиндр', 'тело вращения'],
  cone: ['конус', 'тело вращения'],
  tcone: ['усечённый конус', 'усеченный конус', 'ведро'],
  sphere: ['шар', 'сфера', 'тело вращения'],
};

/** Инструмент тела: щелчок ставит сцену с телом (центр — в точке щелчка). */
function bodyTool(kind: BodyKind, openEditor = false, title = BODY_TITLES[kind]): ToolModule<ReactNode> {
  return {
    id: openEditor ? `${PLUGIN_ID}.scene` : `${PLUGIN_ID}.${kind}`,
    title,
    icon: openEditor ? 'Rotate3d' : ICONS[kind],
    group: 'math',
    section,
    keywords: openEditor ? ['3d', '3д', 'трёхмерная сцена', 'объёмное тело', 'стереометрия', 'пространство'] : [...KEYWORDS[kind], 'стереометрия', '3d'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const props = sceneWith(kind);
      const id = ctx.createObject<SceneProps>(SCENE_TYPE, { x: e.world.x - props.w / 2, y: e.world.y - props.h / 2, props });
      ctx.activateTool('core.select');
      if (!id) return;
      ctx.setSelection([id]);
      if (openEditor) requestObjectEditor({ editor: SCENE_EDITOR, id, at: e.world });
    },
  };
}

export const stereoTools: ToolModule<ReactNode>[] = [
  bodyTool('cube', true, '3D-сцена'),
  ...(['cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'tcone', 'sphere'] as const).map((k) => bodyTool(k)),
];
