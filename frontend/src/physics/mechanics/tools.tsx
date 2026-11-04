import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { MOTION_EDITOR, PLUGIN_ID, THROW_TYPE, throwModule, type ThrowProps } from './objects';

const section = PLUGIN_ID;

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
];
