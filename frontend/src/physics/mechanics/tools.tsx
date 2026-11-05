import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { MOTION_EDITOR, PLUGIN_ID, THROW_TYPE, throwModule, type ThrowProps } from './objects';
import { COLLISION_TYPE, INCLINE_TYPE, LEVER_TYPE, PULLEY_TYPE, SPRING_TYPE, collisionModule, inclineModule, leverModule, pulleyModule, springModule } from './machines';

const section = PLUGIN_ID;

/** Объект щелчком: точка щелчка — опорная точка чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'physics',
    section,
    keywords: [...keywords, 'механика', 'физика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const mechanicsTools: ToolModule<ReactNode>[] = [
  {
    id: `${PLUGIN_ID}.motion`,
    title: 'Движение по закону',
    icon: 'Route',
    group: 'physics',
    section,
    keywords: ['закон движения', 'x(t)', 'кинематика', 'равномерное движение', 'равноускоренное движение', 'анимация', 'траектория', 'движение по окружности'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      ctx.activateTool('core.select');
      requestObjectEditor({ editor: MOTION_EDITOR, id: null, at: e.world });
    },
  },
  {
    id: `${PLUGIN_ID}.throw`,
    title: 'Бросок под углом',
    icon: 'Rocket',
    group: 'physics',
    section,
    keywords: ['бросок под углом', 'баллистика', 'дальность полёта', 'высота подъёма', 'горизонтальный бросок', 'кинематика', 'парабола'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      // Точка щелчка — начало координат (точка на земле под точкой броска).
      const id = ctx.createObject<ThrowProps>(THROW_TYPE, { x: e.world.x, y: e.world.y, props: throwModule.createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  },
  placeTool('incline', 'Наклонная плоскость', 'TriangleRight', INCLINE_TYPE, inclineModule.createProps, ['наклонная плоскость', 'брусок', 'трение', 'сила трения', 'реакция опоры', 'динамика', 'второй закон ньютона']),
  placeTool('pulley', 'Блок с грузами', 'Disc', PULLEY_TYPE, pulleyModule.createProps, ['блок', 'машина атвуда', 'нить', 'натяжение нити', 'два груза', 'динамика']),
  placeTool('spring', 'Пружинный маятник', 'Waves', SPRING_TYPE, springModule.createProps, ['пружина', 'пружинный маятник', 'закон гука', 'колебания', 'период', 'энергия']),
  placeTool('collision', 'Столкновение шаров', 'Merge', COLLISION_TYPE, collisionModule.createProps, ['столкновение', 'удар', 'упругий удар', 'неупругий удар', 'закон сохранения импульса', 'импульс', 'энергия']),
  placeTool('lever', 'Рычаг', 'Scale', LEVER_TYPE, leverModule.createProps, ['рычаг', 'момент силы', 'плечо силы', 'правило моментов', 'равновесие', 'статика']),
];
