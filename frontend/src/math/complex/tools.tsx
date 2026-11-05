import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { PLANE_TYPE, PLUGIN_ID, REGION_TYPE, planeModule, regionModule } from './objects';

/** Объект щелчком: точка щелчка — левый верхний угол области. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'math',
    section: PLUGIN_ID,
    keywords: [...keywords, 'комплексные числа', 'комплексное число'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const complexTools: ToolModule<ReactNode>[] = [
  placeTool('plane', 'Комплексная плоскость', 'Compass', PLANE_TYPE, planeModule.createProps, ['комплексная плоскость', 'модуль', 'аргумент', 'тригонометрическая форма', 'показательная форма', 'формула муавра', 'корни из комплексного числа', 'сопряжённое', 'умножение комплексных чисел']),
  placeTool('region', 'Множество на комплексной плоскости', 'CircleDashed', REGION_TYPE, regionModule.createProps, ['множество точек', 'область', 'изобразить множество', '|z − a| < r', 'arg z', 'кольцо', 'сектор']),
];
