import type { ReactNode } from 'react';
import { Text } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { axesAt } from '../analysis/editor';
import {
  GAUSS_TYPE,
  MATRIX_EDITOR,
  MATRIX_TYPE,
  OP_TYPE,
  PLUGIN_ID,
  TRANSFORM_TYPE,
  gaussModule,
  matrixModule,
  opModule,
  transformModule,
  type Op,
  type OpProps,
} from './objects';

const section = PLUGIN_ID;
const isMatrix = (o: BoardObject) => o.type === MATRIX_TYPE || o.type === OP_TYPE;

/** Габарит матрицы или результата на доске (по их модулям; поворота у них нет). */
function boundsOf(ctx: ToolContext, id: string): { x: number; y: number; width: number; height: number } | null {
  const o = ctx.resolve.getObject(id);
  if (!o) return null;
  const mod = o.type === MATRIX_TYPE ? matrixModule : o.type === OP_TYPE ? opModule : null;
  if (!mod) return null;
  const r = mod.getLocalBounds(o as never, ctx.resolve);
  return { x: o.x + r.x, y: o.y + r.y, width: r.width, height: r.height };
}

const TOOL_TITLES: Record<Op, string> = {
  add: 'Сумма матриц',
  sub: 'Разность матриц',
  mul: 'Произведение матриц',
  scale: 'Умножение матрицы на число',
  transpose: 'Транспонирование',
  det: 'Определитель',
  inverse: 'Обратная матрица',
  rank: 'Ранг матрицы',
};

interface Pick {
  picks: string[];
  cursor: Point | null;
}

function opTool(op: Op, icon: string, keywords: string[], count: 1 | 2): ToolModule<ReactNode> {
  const title = TOOL_TITLES[op];
  const hint = (n: number) => `${title}: выберите ${count === 2 ? (n === 0 ? 'первую матрицу' : 'вторую матрицу') : 'матрицу'}`;
  return {
    id: `${PLUGIN_ID}.${op}`,
    title,
    icon,
    group: 'math',
    section,
    keywords: [...keywords, 'матрица', 'линейная алгебра'],
    requiresWrite: true,
    cursor: 'pointer',
    options: op === 'scale' ? [{ kind: 'text', key: 'matrixK', label: 'k', maxLength: 24 }] : undefined,
    onActivate(ctx) {
      ctx.setPreview({ picks: [], cursor: null } satisfies Pick);
    },
    onPointerMove(e, ctx) {
      const p = ctx.getPreview<Pick>() ?? { picks: [], cursor: null };
      ctx.setPreview({ ...p, cursor: e.world });
    },
    onPointerDown(e, ctx) {
      const p = ctx.getPreview<Pick>() ?? { picks: [], cursor: null };
      const hit = ctx.hitTest(e.world, ctx.screenToWorld(6)).find(isMatrix);
      if (!hit) return;
      const picks = [...p.picks, hit.id];
      if (picks.length < count) {
        ctx.setPreview({ picks, cursor: e.world } satisfies Pick);
        return;
      }
      const last = boundsOf(ctx, picks[picks.length - 1]!);
      // Действие с двумя матрицами — справа от второй, с одной — под ней (справа обычно соседняя матрица).
      const at = !last ? e.world : count === 2 ? { x: last.x + last.width + 40, y: last.y } : { x: last.x, y: last.y + last.height + 24 };
      const k = String(ctx.getToolOptions<{ matrixK?: string }>().matrixK ?? '2') || '2';
      const props: OpProps = { op, k, color: 'accent-5' };
      const id = ctx.createObject<OpProps>(OP_TYPE, {
        x: at.x,
        y: at.y,
        props,
        deps: picks,
      });
      ctx.setPreview({ picks: [], cursor: e.world } satisfies Pick);
      if (id) {
        ctx.setSelection([id]);
        ctx.activateTool('core.select');
      }
    },
    onKeyDown(key, _m, ctx) {
      if (key === 'Escape' && ctx.getPreview<Pick>()?.picks.length) {
        ctx.setPreview({ picks: [], cursor: null } satisfies Pick);
        return true;
      }
      return false;
    },
    onDeactivate(ctx) {
      ctx.setPreview(null);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<Pick>();
      if (!p?.cursor) return null;
      const w = ctx.screenToWorld(1);
      return <Text x={p.cursor.x + 14 * w} y={p.cursor.y + 14 * w} text={hint(p.picks.length)} fontSize={13 * w} fill="#2a7de1" listening={false} />;
    },
  };
}

export const linalgTools: ToolModule<ReactNode>[] = [
  {
    id: `${PLUGIN_ID}.matrix`,
    title: 'Матрица',
    icon: 'Grid2x2',
    group: 'math',
    section,
    keywords: ['матрица', 'таблица чисел', 'система уравнений', 'линейная алгебра'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      ctx.activateTool('core.select');
      requestObjectEditor({ editor: MATRIX_EDITOR, id: null, at: e.world });
    },
  },
  opTool('add', 'Plus', ['сумма матриц', 'сложение'], 2),
  opTool('sub', 'Minus', ['разность матриц', 'вычитание'], 2),
  opTool('mul', 'X', ['произведение матриц', 'умножение матриц'], 2),
  opTool('scale', 'Asterisk', ['умножение матрицы на число'], 1),
  opTool('transpose', 'FlipHorizontal2', ['транспонирование', 'транспонированная матрица'], 1),
  opTool('det', 'SquareFunction', ['определитель', 'детерминант'], 1),
  opTool('inverse', 'Undo2', ['обратная матрица'], 1),
  opTool('rank', 'ListOrdered', ['ранг матрицы'], 1),
  {
    id: `${PLUGIN_ID}.gauss`,
    title: 'Метод Гаусса',
    icon: 'ListChecks',
    group: 'math',
    section,
    keywords: ['метод гаусса', 'гаусс жордан', 'решение системы', 'элементарные преобразования', 'ступенчатый вид'],
    requiresWrite: true,
    cursor: 'pointer',
    onPointerDown(e, ctx) {
      const hit = ctx.hitTest(e.world, ctx.screenToWorld(6)).find(isMatrix);
      if (!hit) return;
      const b = boundsOf(ctx, hit.id);
      const id = ctx.createObject(GAUSS_TYPE, {
        x: b?.x ?? e.world.x,
        y: (b ? b.y + b.height : e.world.y) + 40,
        props: gaussModule.createProps(),
        deps: [hit.id],
      });
      if (id) ctx.setSelection([id]);
      ctx.activateTool('core.select');
    },
  },
  {
    id: `${PLUGIN_ID}.transform`,
    title: 'Линейное преобразование',
    icon: 'Move3d',
    group: 'math',
    section,
    keywords: ['линейное преобразование', 'матрица преобразования', 'собственные векторы', 'определитель как площадь'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      let id = '';
      ctx.transact(() => {
        const { id: axes } = axesAt(ctx, e.world);
        if (axes)
          id = ctx.createObject(TRANSFORM_TYPE, {
            x: 0,
            y: 0,
            props: transformModule.createProps(),
            deps: [axes],
          });
      });
      if (id) ctx.setSelection([id]);
      ctx.activateTool('core.select');
    },
  },
];
