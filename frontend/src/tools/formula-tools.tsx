import type { ReactNode } from 'react';
import type { Point, ToolModule } from '@doska/shared';

export const FORMULA_TOOL_ID = 'core.formula';
export const SOLUTION_TOOL_ID = 'core.solution';

/** Открыть редактор формулы или решения (страница доски слушает это событие). */
export const EDIT_OBJECT_EVENT = 'doska:edit-object';
export interface EditObjectDetail {
  editor: 'formula' | 'solution';
  /** Существующий объект или null — создать новый в точке at. */
  id: string | null;
  at: Point | null;
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
