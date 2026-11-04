import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { DEBROGLIE_TYPE, PHOTOEFFECT_TYPE, PLUGIN_ID, RELATIVITY_TYPE, SPECTRUM_TYPE, debroglieModule, photoModule, relativityModule, spectrumModule } from './objects';

/** Объект щелчком: точка щелчка — опорная точка чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'physics',
    section: PLUGIN_ID,
    keywords: [...keywords, 'современная физика', 'физика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const modernTools: ToolModule<ReactNode>[] = [
  placeTool('relativity', 'Теория относительности', 'Rocket', RELATIVITY_TYPE, relativityModule.createProps, ['сто', 'теория относительности', 'замедление времени', 'сокращение длины', 'лоренц', 'e = mc²', 'энергия покоя', 'сложение скоростей']),
  placeTool('photoeffect', 'Фотоэффект', 'SunMedium', PHOTOEFFECT_TYPE, photoModule.createProps, ['фотоэффект', 'уравнение эйнштейна', 'работа выхода', 'красная граница', 'задерживающее напряжение', 'ток насыщения']),
  placeTool('spectrum', 'Фотон и шкала электромагнитных волн', 'Rainbow', SPECTRUM_TYPE, spectrumModule.createProps, ['фотон', 'энергия фотона', 'импульс фотона', 'шкала электромагнитных волн', 'спектр', 'рентген', 'ультрафиолет', 'инфракрасное']),
  placeTool('debroglie', 'Волны де Бройля', 'Atom', DEBROGLIE_TYPE, debroglieModule.createProps, ['де бройль', 'волны де бройля', 'корпускулярно-волновой дуализм', 'длина волны частицы', 'дифракция электронов']),
];
