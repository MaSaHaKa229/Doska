import type { ReactNode } from 'react';
import type { Point, ToolModule } from '@doska/shared';

export const FORMULA_TOOL_ID = 'core.formula';
export const SOLUTION_TOOL_ID = 'core.solution';
export const CALC_TOOL_ID = 'core.calc';

/** Открыть редактор формулы или решения (страница доски слушает это событие). */
export const EDIT_OBJECT_EVENT = 'doska:edit-object';
export interface EditObjectDetail {
  /** Редактор: формула, решение, калькулятор или редактор плагина (BoardPlugin.editors). */
  editor: string;
  /** Существующий объект или null — создать новый в точке at. */
  id: string | null;
  at: Point | null;
  /** Начальная запись формулы (распознанная рукопись). */
  latex?: string;
  /** Кегль новой формулы. */
  size?: number;
  /** Объекты, которые новая формула заменяет (штрихи распознанной рукописи). */
  replaces?: string[];
}
export function requestObjectEditor(detail: EditObjectDetail): void {
  window.dispatchEvent(new CustomEvent<EditObjectDetail>(EDIT_OBJECT_EVENT, { detail }));
}

/** «Формула»: щелчок по доске открывает редактор MathLive, формула встаёт в точку щелчка. */
export const formulaTool: ToolModule<ReactNode> = {
  id: FORMULA_TOOL_ID,
  title: 'Формула',
  icon: 'Sigma',
  group: 'formulas',
  hotkey: 'F',
  keywords: ['формула', 'уравнение', 'latex', 'дробь', 'корень', 'интеграл', 'formula', 'math'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    ctx.activateTool('core.select');
    requestObjectEditor({ editor: 'formula', id: null, at: e.world });
  },
};

/** «Решение»: блок с пронумерованными шагами-формулами и проверкой переходов. */
export const solutionTool: ToolModule<ReactNode> = {
  id: SOLUTION_TOOL_ID,
  title: 'Решение',
  icon: 'ListOrdered',
  group: 'formulas',
  hotkey: 'Shift+F',
  keywords: ['решение', 'шаги', 'преобразования', 'выкладки', 'проверка', 'solution', 'steps'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    ctx.activateTool('core.select');
    requestObjectEditor({ editor: 'solution', id: null, at: e.world });
  },
};

/**
 * «Калькулятор»: кнопка (или C) сразу открывает панель калькулятора и
 * возвращает выделение. Считать может любой участник, ставить результат на
 * доску — только тот, у кого есть право записи.
 */
export const calcTool: ToolModule<ReactNode> = {
  id: CALC_TOOL_ID,
  title: 'Калькулятор',
  icon: 'Calculator',
  group: 'formulas',
  hotkey: 'C',
  keywords: ['калькулятор', 'вычислить', 'посчитать', 'единицы', 'перевод единиц', 'calculator'],
  requiresWrite: false,
  onActivate(ctx) {
    requestObjectEditor({ editor: 'calc', id: null, at: null });
    queueMicrotask(() => ctx.activateTool('core.select'));
  },
};

export const REFERENCE_TOOL_ID = 'core.reference';

/**
 * «Справочник формул»: панель с темами математики и физики, поиском и
 * вставкой формулы на доску. Открыть может любой участник, вставить — тот,
 * у кого есть право записи.
 */
export const referenceTool: ToolModule<ReactNode> = {
  id: REFERENCE_TOOL_ID,
  title: 'Справочник формул',
  icon: 'BookOpenText',
  group: 'formulas',
  keywords: ['справочник', 'формулы', 'шпаргалка', 'теорема', 'закон', 'reference'],
  requiresWrite: false,
  onActivate(ctx) {
    requestObjectEditor({ editor: 'reference', id: null, at: null });
    queueMicrotask(() => ctx.activateTool('core.select'));
  },
};
