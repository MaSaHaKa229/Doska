import type { ReactNode } from 'react';
import { Arrow, Text } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule, ToolPointerEvent } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { axesAt } from '../analysis/editor';
import { frameOf } from '../analysis/plot';
import { axesModule } from '../analysis/objects';
import {
  APOINT_TYPE,
  CONIC_EDITOR,
  LINE_EDITOR,
  LINE_TYPE,
  MEASURE_TYPE,
  PLUGIN_ID,
  VECOP_TYPE,
  VECTOR_TYPE,
  apointModule,
  snapHalf,
  vectorModule,
  type APointProps,
  type MeasureProps,
  type VecOp,
  type VecOpProps,
  type VectorProps,
} from './objects';

const section = PLUGIN_ID;

/** Первое свободное имя на странице. */
function freeName(ctx: ToolContext, type: string, key: string, names: string[]): string {
  const used = new Set(ctx.listObjects(type).map((o) => String((o.props as Record<string, unknown>)[key] ?? '')));
  return names.find((n) => !used.has(n)) ?? `${names[0]}${used.size}`;
}

const editorTool = (id: string, title: string, icon: string, editor: string, keywords: string[]): ToolModule<ReactNode> => ({
  id: `${PLUGIN_ID}.${id}`,
  title,
  icon,
  group: 'math',
  section,
  keywords: [...keywords, 'аналитическая геометрия', 'уравнение'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    ctx.activateTool('core.select');
    requestObjectEditor({ editor, id: null, at: e.world });
  },
});

export const pointTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.point`,
  title: 'Точка по координатам',
  icon: 'Locate',
  group: 'math',
  section,
  keywords: ['точка с координатами', 'координаты точки', 'аналитическая геометрия'],
  requiresWrite: true,
  cursor: 'crosshair',
  onPointerDown(e, ctx) {
    let id = '';
    ctx.transact(() => {
      const { id: axes, rect } = axesAt(ctx, e.world);
      if (!axes) return;
      // Новые оси в этой транзакции ещё не прочитать — кадр по прямоугольнику и пределам по умолчанию.
      const a = ctx.resolve.getObject(axes) ?? ({ x: rect.x, y: rect.y, props: axesModule.createProps() } as unknown as BoardObject);
      const q = frameOf(a).toMath(e.world);
      const props: APointProps = { ...apointModule.createProps(), X: snapHalf(q.X), Y: snapHalf(q.Y), label: freeName(ctx, APOINT_TYPE, 'label', ['M', 'N', 'P', 'K', 'L', 'Q', 'R', 'S', 'T']) };
      id = ctx.createObject<APointProps>(APOINT_TYPE, { x: 0, y: 0, props, deps: [axes] });
    });
    if (id) ctx.setSelection([id]);
  },
};

interface Drag {
  axes: string;
  from: Point;
  to: Point;
}

/** «Вектор»: протяжка от начала к концу на системе координат. */
export const vectorTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.vector`,
  title: 'Вектор с координатами',
  icon: 'MoveUpRight',
  group: 'math',
  section,
  keywords: ['вектор', 'координаты вектора', 'длина вектора'],
  requiresWrite: true,
  cursor: 'crosshair',
  onPointerDown(e, ctx) {
    const axes = ctx.hitTest(e.world, 0).find((o) => o.type === 'math.analysis.axes') ?? ctx.listObjects('math.analysis.axes').find((a) => {
      const r = frameOf(a).rect;
      return e.world.x >= r.x && e.world.x <= r.x + r.width && e.world.y >= r.y && e.world.y <= r.y + r.height;
    });
    if (!axes) return;
    const fr = frameOf(axes);
    const q = fr.toMath(e.world);
    const p = { x: snapHalf(q.X), y: snapHalf(q.Y) };
    ctx.setPreview({ axes: axes.id, from: p, to: p } satisfies Drag);
  },
  onPointerMove(e, ctx) {
    const d = ctx.getPreview<Drag>();
    const axes = d ? ctx.resolve.getObject(d.axes) : undefined;
    if (!d || !axes) return;
    const q = frameOf(axes).toMath(e.world);
    ctx.setPreview({ ...d, to: { x: snapHalf(q.X), y: snapHalf(q.Y) } } satisfies Drag);
  },
  onPointerUp(_e, ctx) {
    const d = ctx.getPreview<Drag>();
    ctx.setPreview(null);
    if (!d || (d.from.x === d.to.x && d.from.y === d.to.y)) return;
    const props: VectorProps = {
      ...vectorModule.createProps(),
      X0: d.from.x,
      Y0: d.from.y,
      X: d.to.x - d.from.x + 0,
      Y: d.to.y - d.from.y + 0,
      name: freeName(ctx, VECTOR_TYPE, 'name', ['a', 'b', 'c', 'd', 'u', 'v', 'w', 'p', 'q']),
      color: ['accent-2', 'accent-1', 'accent-5', 'accent-7'][ctx.listObjects(VECTOR_TYPE).length % 4]!,
    };
    const id = ctx.createObject<VectorProps>(VECTOR_TYPE, { x: 0, y: 0, props, deps: [d.axes] });
    if (id) ctx.setSelection([id]);
  },
  renderOverlay(ctx) {
    const d = ctx.getPreview<Drag>();
    const axes = d ? ctx.resolve.getObject(d.axes) : undefined;
    if (!d || !axes) return null;
    const fr = frameOf(axes);
    const a = fr.toWorld(d.from.x, d.from.y);
    const b = fr.toWorld(d.to.x, d.to.y);
    const w = ctx.screenToWorld(1);
    return <Arrow points={[a.x, a.y, b.x, b.y]} stroke="#2a7de1" fill="#2a7de1" strokeWidth={2} strokeScaleEnabled={false} pointerLength={10 * w} pointerWidth={8 * w} dash={[6 * w, 4 * w]} listening={false} />;
  },
};

type Want = 'vector' | 'point' | 'line';
const WANT: Record<Want, { type: string; hint: string }> = {
  vector: { type: VECTOR_TYPE, hint: 'вектор' },
  point: { type: APOINT_TYPE, hint: 'точку с координатами' },
  line: { type: LINE_TYPE, hint: 'прямую по уравнению' },
};

interface PickPreview {
  picks: string[];
  cursor: Point | null;
}

/** Инструмент «выберите объекты по шагам» → объект с опорами [оси, выбранные…]. */
function pickTool(id: string, title: string, icon: string, keywords: string[], steps: Want[], create: (ctx: ToolContext, axes: string, picks: BoardObject[]) => string): ToolModule<ReactNode> {
  const hint = (n: number) => (n < steps.length ? `${title}: выберите ${WANT[steps[n]!].hint}` : '');
  return {
    id: `${PLUGIN_ID}.${id}`,
    title,
    icon,
    group: 'math',
    section,
    keywords: [...keywords, 'аналитическая геометрия'],
    requiresWrite: true,
    cursor: 'pointer',
    onActivate(ctx) {
      ctx.setPreview({ picks: [], cursor: null } satisfies PickPreview);
    },
    onPointerMove(e, ctx) {
      const p = ctx.getPreview<PickPreview>() ?? { picks: [], cursor: null };
      ctx.setPreview({ ...p, cursor: e.world });
    },
    onPointerDown(e: ToolPointerEvent, ctx) {
      const p = ctx.getPreview<PickPreview>() ?? { picks: [], cursor: null };
      const want = steps[p.picks.length];
      if (!want) return;
      const hit = ctx.hitTest(e.world, ctx.screenToWorld(8)).find((o) => o.type === WANT[want].type && !p.picks.includes(o.id));
      if (!hit) return;
      const picks = [...p.picks, hit.id];
      if (picks.length < steps.length) {
        ctx.setPreview({ picks, cursor: e.world } satisfies PickPreview);
        return;
      }
      const objs = picks.map((x) => ctx.resolve.getObject(x)!);
      const nid = create(ctx, objs[0]!.deps[0]!, objs);
      ctx.setPreview({ picks: [], cursor: e.world } satisfies PickPreview);
      if (nid) {
        ctx.setSelection([nid]);
        ctx.activateTool('core.select');
      }
    },
    onKeyDown(key, _m, ctx) {
      if (key === 'Escape' && ctx.getPreview<PickPreview>()?.picks.length) {
        ctx.setPreview({ picks: [], cursor: null } satisfies PickPreview);
        return true;
      }
      return false;
    },
    onDeactivate(ctx) {
      ctx.setPreview(null);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<PickPreview>();
      if (!p?.cursor) return null;
      const w = ctx.screenToWorld(1);
      return <Text x={p.cursor.x + 14 * w} y={p.cursor.y + 14 * w} text={hint(p.picks.length)} fontSize={13 * w} fill="#2a7de1" listening={false} />;
    },
  };
}

const vecop = (op: VecOp, title: string, icon: string, keywords: string[], two: boolean) =>
  pickTool(op === 'sum' ? 'vector-sum' : op === 'diff' ? 'vector-diff' : op === 'scale' ? 'vector-scale' : 'vector-dot', title, icon, keywords, two ? ['vector', 'vector'] : ['vector'], (ctx, axes, picks) => {
    const k = Number(ctx.getToolOptions<{ vectorK?: number }>().vectorK ?? 2) || 2;
    const props: VecOpProps = { op, k, rule: 'parallelogram', color: 'accent-5' };
    return ctx.createObject<VecOpProps>(VECOP_TYPE, { x: 0, y: 0, props, deps: [axes, ...picks.map((p) => p.id)] });
  });

const measure = (kind: 'dist' | 'angle', title: string, icon: string, keywords: string[], steps: Want[]) =>
  pickTool(kind === 'dist' ? 'distance' : 'line-angle', title, icon, keywords, steps, (ctx, axes, picks) => {
    const props: MeasureProps = { kind, color: 'accent-6' };
    return ctx.createObject<MeasureProps>(MEASURE_TYPE, { x: 0, y: 0, props, deps: [axes, ...picks.map((p) => p.id)] });
  });

export const analyticTools: ToolModule<ReactNode>[] = [
  editorTool('line', 'Прямая по уравнению', 'Slash', LINE_EDITOR, ['прямая', 'уравнение прямой', 'угловой коэффициент', 'нормальный вектор']),
  editorTool('conic', 'Кривая второго порядка', 'Egg', CONIC_EDITOR, ['кривая второго порядка', 'эллипс', 'гипербола', 'парабола', 'окружность', 'фокус', 'директриса', 'эксцентриситет']),
  pointTool,
  vectorTool,
  vecop('sum', 'Сумма векторов', 'Plus', ['сумма векторов', 'правило параллелограмма', 'правило треугольника'], true),
  vecop('diff', 'Разность векторов', 'Minus', ['разность векторов'], true),
  { ...vecop('scale', 'Умножение вектора на число', 'X', ['умножение вектора на число', 'коллинеарные векторы'], false), options: [{ kind: 'number', key: 'vectorK', label: 'k', step: 0.5 }] },
  vecop('dot', 'Скалярное произведение', 'Dot', ['скалярное произведение', 'угол между векторами'], true),
  measure('dist', 'Расстояние от точки до прямой', 'Ruler', ['расстояние от точки до прямой', 'перпендикуляр'], ['point', 'line']),
  measure('angle', 'Угол между прямыми', 'Radius', ['угол между прямыми', 'пересечение прямых'], ['line', 'line']),
];
