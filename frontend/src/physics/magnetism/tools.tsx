import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { AMPERE_TYPE, COIL_TYPE, LENZ_TYPE, LORENTZ_TYPE, MAGNET_TYPE, PLUGIN_ID, ROTOR_TYPE, WIRE_TYPE, ampereModule, coilModule, lenzModule, lorentzModule, magnetModule, rotorModule, wireModule } from './objects';

/** Объект щелчком: точка щелчка — опорная точка чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'physics',
    section: PLUGIN_ID,
    keywords: [...keywords, 'магнитное поле', 'магнетизм', 'физика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const magnetismTools: ToolModule<ReactNode>[] = [
  placeTool('wire', 'Прямой ток', 'CircleDot', WIRE_TYPE, wireModule.createProps, ['прямой ток', 'правило буравчика', 'линии магнитной индукции', 'ток на нас', 'ток от нас']),
  placeTool('coil', 'Катушка с током', 'Cable', COIL_TYPE, coilModule.createProps, ['катушка', 'соленоид', 'электромагнит', 'правило правой руки', 'полюса катушки']),
  placeTool('magnet', 'Постоянный магнит', 'Magnet', MAGNET_TYPE, magnetModule.createProps, ['магнит', 'полосовой магнит', 'северный полюс', 'южный полюс', 'линии поля']),
  placeTool('lorentz', 'Заряд в магнитном поле', 'Orbit', LORENTZ_TYPE, lorentzModule.createProps, ['сила лоренца', 'заряд в магнитном поле', 'движение по окружности', 'радиус траектории', 'правило левой руки', 'электрон', 'протон']),
  placeTool('ampere', 'Проводник в магнитном поле', 'ArrowDownToLine', AMPERE_TYPE, ampereModule.createProps, ['сила ампера', 'проводник с током', 'правило левой руки']),
  placeTool('rotor', 'Рамка в магнитном поле', 'RotateCw', ROTOR_TYPE, rotorModule.createProps, ['электромагнитная индукция', 'генератор', 'магнитный поток', 'эдс индукции', 'вращающаяся рамка', 'переменный ток']),
  placeTool('lenz', 'Правило Ленца', 'MoveHorizontal', LENZ_TYPE, lenzModule.createProps, ['правило ленца', 'индукционный ток', 'магнит и кольцо', 'электромагнитная индукция']),
];
