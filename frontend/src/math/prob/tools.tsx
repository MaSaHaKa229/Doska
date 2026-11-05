import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { DIST_TYPE, EXPERIMENT_TYPE, PLUGIN_ID, STATS_TYPE, TREE_TYPE, distModule, experimentModule, statsModule, treeModule } from './objects';

/** Объект щелчком: точка щелчка — левый верхний угол чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'math',
    section: PLUGIN_ID,
    keywords: [...keywords, 'вероятность', 'статистика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const probTools: ToolModule<ReactNode>[] = [
  placeTool('experiment', 'Опыт: частота и вероятность', 'Dices', EXPERIMENT_TYPE, experimentModule.createProps, ['опыт', 'монета', 'кубик', 'урна', 'частота', 'классическая вероятность', 'закон больших чисел', 'случайный эксперимент']),
  placeTool('tree', 'Дерево вероятностей', 'GitFork', TREE_TYPE, treeModule.createProps, ['дерево вероятностей', 'формула полной вероятности', 'формула байеса', 'гипотезы', 'условная вероятность']),
  placeTool('dist', 'Распределение случайной величины', 'ChartBar', DIST_TYPE, distModule.createProps, ['распределение', 'биномиальное', 'бернулли', 'нормальное', 'гаусс', 'пуассон', 'равномерное', 'матожидание', 'дисперсия', 'правило трёх сигм']),
  placeTool('stats', 'Статистика по данным', 'ChartPie', STATS_TYPE, statsModule.createProps, ['среднее', 'медиана', 'мода', 'размах', 'дисперсия', 'гистограмма', 'круговая диаграмма', 'столбчатая диаграмма', 'ящик с усами', 'квартили']),
];
