import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { BASES_TYPE, COMB_TYPE, GRAPH_TYPE, LOGIC_TYPE, PLUGIN_ID, basesModule, combModule, graphModule, logicModule } from './objects';

/** Объект щелчком: точка щелчка — левый верхний угол чертежа. */
function placeTool(name: string, title: string, icon: string, type: string, createProps: () => unknown, keywords: string[]): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${name}`,
    title,
    icon,
    group: 'math',
    section: PLUGIN_ID,
    keywords: [...keywords, 'дискретная математика'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  };
}

export const discreteTools: ToolModule<ReactNode>[] = [
  placeTool('graph', 'Граф', 'Network', GRAPH_TYPE, graphModule.createProps, ['граф', 'вершины', 'рёбра', 'степень вершины', 'обход в ширину', 'обход в глубину', 'дейкстра', 'кратчайший путь', 'остовное дерево', 'эйлеров путь', 'связность']),
  placeTool('comb', 'Комбинаторика', 'Shuffle', COMB_TYPE, combModule.createProps, ['перестановки', 'размещения', 'сочетания', 'факториал', 'треугольник паскаля', 'бином ньютона']),
  placeTool('logic', 'Логика: таблица истинности', 'ToggleLeft', LOGIC_TYPE, logicModule.createProps, ['таблица истинности', 'логика', 'высказывание', 'конъюнкция', 'дизъюнкция', 'импликация', 'сднф', 'скнф', 'круги эйлера', 'диаграмма венна', 'множества']),
  placeTool('bases', 'Системы счисления', 'Binary', BASES_TYPE, basesModule.createProps, ['системы счисления', 'двоичная', 'шестнадцатеричная', 'перевод чисел', 'основание']),
];
