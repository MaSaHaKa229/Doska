import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { PHASE_TYPE, PLUGIN_ID, SECOND_TYPE, SLOPE_TYPE, phaseModule, secondModule, slopeModule } from './objects';

/** Объект щелчком: точка щелчка — левый верхний угол области. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'math',
    section: PLUGIN_ID,
    keywords: [...keywords, 'дифференциальное уравнение', 'ду'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const diffeqTools: ToolModule<ReactNode>[] = [
  placeTool('slope', 'Поле направлений', 'Navigation2', SLOPE_TYPE, slopeModule.createProps, ['поле направлений', 'интегральная кривая', 'задача коши', 'метод эйлера', 'рунге — кутта', 'численное решение', 'первого порядка']),
  placeTool('phase', 'Фазовая плоскость', 'Orbit', PHASE_TYPE, phaseModule.createProps, ['фазовая плоскость', 'фазовый портрет', 'система ду', 'особая точка', 'седло', 'узел', 'фокус', 'центр', 'устойчивость']),
  placeTool('second', 'Уравнение y″ + py′ + qy = 0', 'Activity', SECOND_TYPE, secondModule.createProps, ['второго порядка', 'характеристическое уравнение', 'линейное однородное', 'колебания', 'затухание']),
];
