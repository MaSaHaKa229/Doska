import type { ReactNode } from 'react';
import { Rect as KRect } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { mathReady, parseCurve } from './expr';
import { AXES_TYPE, CURVE_TYPE, NUMBERLINE_TYPE, PLUGIN_ID, SLIDER_TYPE, TABLE_TYPE, TRIG_TYPE, frameOf, type AxesProps, type CurveProps } from './plot';
import { axesModule, numberLineModule, sliderModule, tableModule, trigModule, type SliderProps, type TableProps } from './objects';

export const CURVE_EDITOR = 'analysis.curve';
const section = PLUGIN_ID;

/** Пределы осей под размер области: одна клетка-единица ≈ 40 единиц доски, ноль в центре. */
export function rangesFor(w: number, h: number): Pick<AxesProps, 'xMin' | 'xMax' | 'yMin' | 'yMax'> {
  const hx = Math.max(1, Math.round(w / 80));
  const hy = Math.max(1, Math.round(h / 80));
  return { xMin: -hx, xMax: hx, yMin: -hy, yMax: hy };
}

let axesStart: Point | null = null;

export const axesTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.axes`,
  title: 'Система координат',
  icon: 'Grid3x3',
  group: 'math',
  section,
  keywords: ['система координат', 'оси', 'координатная плоскость', 'axes'],
  requiresWrite: true,
  snapping: true,
  cursor: 'crosshair',
  onPointerDown(e, ctx) {
    axesStart = e.snapped;
    ctx.setPreview({ a: e.snapped, b: e.snapped });
  },
  onPointerMove(e, ctx) {
    if (axesStart) ctx.setPreview({ a: axesStart, b: e.snapped });
  },
  onPointerUp(e, ctx) {
    const a = axesStart;
    axesStart = null;
    ctx.setPreview(null);
    if (!a) return;
    // Протяжка — область заданного размера, щелчок — стандартная с центром в точке.
    let w = Math.abs(e.snapped.x - a.x);
    let h = Math.abs(e.snapped.y - a.y);
    let at = { x: Math.min(a.x, e.snapped.x), y: Math.min(a.y, e.snapped.y) };
    if (w < ctx.screenToWorld(40) || h < ctx.screenToWorld(40)) {
      const d = axesModule.createProps();
      w = d.w;
      h = d.h;
      at = { x: a.x - w / 2, y: a.y - h / 2 };
    }
    const props: AxesProps = { ...axesModule.createProps(), w, h, ...rangesFor(w, h) };
    const id = ctx.createObject<AxesProps>(AXES_TYPE, { x: at.x, y: at.y, props });
    if (id) ctx.setSelection([id]);
    ctx.activateTool('core.select');
  },
  renderOverlay(ctx) {
    const p = ctx.getPreview<{ a: Point; b: Point }>();
    if (!p) return null;
    return (
      <KRect
        x={Math.min(p.a.x, p.b.x)}
        y={Math.min(p.a.y, p.b.y)}
        width={Math.abs(p.b.x - p.a.x)}
        height={Math.abs(p.b.y - p.a.y)}
        stroke="#2a7de1"
        dash={[6, 4]}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={false}
      />
    );
  },
};

export const curveTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.curve`,
  title: 'График',
  icon: 'ChartSpline',
  group: 'math',
  section,
  hotkey: 'G',
  keywords: ['график', 'функция', 'построить график', 'уравнение', 'неравенство', 'парабола', 'синусоида', 'кривая', 'graph', 'plot'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    ctx.activateTool('core.select');
    // Щелчок по системе координат — график на ней; мимо — новые оси с центром в точке.
    requestObjectEditor({ editor: CURVE_EDITOR, id: null, at: e.world });
  },
};

const NAMES = ['a', 'b', 'c', 'k', 'm', 'n', 'p', 'q', 'd', 'h'];

/** Графики страницы, которым нужен параметр с этим именем и у которых нет такого слайдера. */
function curvesNeeding(ctx: ToolContext, name: string): BoardObject[] {
  if (!mathReady()) return [];
  return ctx.listObjects(CURVE_TYPE).filter((c) => {
    const parsed = parseCurve((c.props as unknown as CurveProps).text);
    if ('error' in parsed || !parsed.params.includes(name)) return false;
    return !c.deps.slice(1).some((d) => (ctx.resolve.getObject(d)?.props as { name?: unknown } | undefined)?.name === name);
  });
}

export const sliderTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.slider`,
  title: 'Слайдер',
  icon: 'SlidersHorizontal',
  group: 'math',
  section,
  keywords: ['слайдер', 'ползунок', 'параметр', 'бегунок', 'slider'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    const used = new Set(ctx.listObjects(SLIDER_TYPE).map((s) => (s.props as unknown as SliderProps).name));
    const name = NAMES.find((n) => !used.has(n)) ?? `a${used.size + 1}`;
    let id = '';
    ctx.transact(() => {
      id = ctx.createObject<SliderProps>(SLIDER_TYPE, { x: e.world.x, y: e.world.y, props: { ...sliderModule.createProps(), name } });
      // Графики, ждавшие этот параметр, получают слайдер в опоры.
      if (id) for (const c of curvesNeeding(ctx, name)) ctx.updateObject(c.id, { deps: [...c.deps, id] });
    });
    if (id) ctx.setSelection([id]);
    ctx.activateTool('core.select');
  },
};

export const tableTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.table`,
  title: 'Таблица значений',
  icon: 'Table2',
  group: 'math',
  section,
  keywords: ['таблица значений', 'значения функции', 'таблица'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    // График под курсором, иначе — последняя функция на странице; таблица — справа от его осей.
    const isFunction = (o: BoardObject) => {
      const p = mathReady() ? parseCurve((o.props as unknown as CurveProps).text) : null;
      return !!p && !('error' in p) && p.kind === 'function';
    };
    const curve = ctx.hitTest(e.world, ctx.screenToWorld(8)).find((o) => o.type === CURVE_TYPE) ?? ctx.listObjects(CURVE_TYPE).filter(isFunction).pop();
    const axes = curve ? ctx.resolve.getObject(curve.deps[0] ?? '') : undefined;
    if (!curve || !axes) return;
    const r = frameOf(axes).rect;
    const props: TableProps = tableModule.createProps();
    const id = ctx.createObject<TableProps>(TABLE_TYPE, { x: r.x + r.width + 24, y: r.y + 24, props, deps: [curve.id] });
    if (id) ctx.setSelection([id]);
    ctx.activateTool('core.select');
  },
};

function placeTool(id: string, title: string, icon: string, type: string, keywords: string[], props: () => object): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${id}`,
    title,
    icon,
    group: 'math',
    section,
    keywords,
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const oid = ctx.createObject(type, { x: e.world.x, y: e.world.y, props: props() });
      if (oid) ctx.setSelection([oid]);
      ctx.activateTool('core.select');
    },
  };
}

export const analysisTools = [
  axesTool,
  curveTool,
  sliderTool,
  tableTool,
  placeTool('numberline', 'Числовая прямая', 'MoveHorizontal', NUMBERLINE_TYPE, ['числовая прямая', 'промежуток', 'интервал', 'координатная прямая', 'решение неравенства'], () =>
    numberLineModule.createProps(),
  ),
  placeTool('trig', 'Тригонометрическая окружность', 'CircleGauge', TRIG_TYPE, ['тригонометрическая окружность', 'единичная окружность', 'синус', 'косинус', 'тангенс'], () =>
    trigModule.createProps(),
  ),
];
