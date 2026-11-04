import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { CONTOURS_TYPE, FIELD_TYPE, PLUGIN_ID, SURFACE_TYPE, contoursModule, fieldModule, surfaceModule } from './objects';

/** Объект щелчком: точка щелчка — левый верхний угол области. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'math',
    section: PLUGIN_ID,
    keywords: [...keywords, 'функция двух переменных', 'многие переменные'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const multivarTools: ToolModule<ReactNode>[] = [
  placeTool('surface', 'Поверхность z = f(x, y)', 'Mountain', SURFACE_TYPE, surfaceModule.createProps, ['поверхность', 'график функции двух переменных', 'седло', 'параболоид', 'касательная плоскость', 'частные производные', '3d']),
  placeTool('contours', 'Линии уровня и градиент', 'Layers', CONTOURS_TYPE, contoursModule.createProps, ['линии уровня', 'изолинии', 'градиент', 'частные производные', 'производная по направлению', 'экстремум']),
  placeTool('field', 'Векторное поле', 'Wind', FIELD_TYPE, fieldModule.createProps, ['векторное поле', 'линии тока', 'дивергенция', 'ротор', 'вихрь', 'источник', 'сток', 'div', 'rot']),
];
