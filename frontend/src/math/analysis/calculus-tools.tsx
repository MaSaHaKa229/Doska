import type { ReactNode } from 'react';
import { Text } from 'react-konva';
import type { Point, ToolContext, ToolModule, ToolPointerEvent } from '@doska/shared';
import { niceStep } from './expr';
import { CURVE_TYPE, PLUGIN_ID } from './plot';
import { graphOf, type Graph } from './calculus';

export const SECTION_CALCULUS = `${PLUGIN_ID}.calculus`;

/** График функции под курсором. */
function graphAt(e: ToolPointerEvent, ctx: ToolContext): Graph | null {
  for (const o of ctx.hitTest(e.world, ctx.screenToWorld(8))) {
    if (o.type !== CURVE_TYPE) continue;
    const g = graphOf(o.id, ctx.resolve);
    if (g) return g;
  }
  return null;
}

interface Preview {
  first: string | null;
  cursor: Point | null;
  hint: string;
}

const round = (v: number, k = 100) => Math.round(v * k) / k;

/** Отрезок вокруг точки щелчка: ±«красивый» шаг, внутри области осей. */
function around(g: Graph, X: number): { a: number; b: number } {
  const fr = g.frame;
  const span = niceStep((fr.xMax - fr.xMin) / 8);
  const c = Math.round(X / span) * span;
  return { a: Math.max(fr.xMin, round(c - span)), b: Math.min(fr.xMax, round(c + span)) };
}

function graphTool(
  name: string,
  title: string,
  icon: string,
  keywords: string[],
  graphs: 1 | 2,
  init: (g: Graph, X: number) => object,
): ToolModule<ReactNode> {
  const type = `${PLUGIN_ID}.${name}`;
  const hint = (first: string | null) => (graphs === 2 && first ? `${title}: выберите второй график` : `${title}: щёлкните по графику функции`);
  return {
    id: type,
    title,
    icon,
    group: 'math',
    section: SECTION_CALCULUS,
    keywords: [...keywords, 'анализ', 'график'],
    requiresWrite: true,
    cursor: 'crosshair',
    onActivate(ctx) {
      ctx.setPreview({ first: null, cursor: null, hint: hint(null) } satisfies Preview);
    },
    onPointerMove(e, ctx) {
      const p = ctx.getPreview<Preview>();
      ctx.setPreview({ first: p?.first ?? null, cursor: e.world, hint: hint(p?.first ?? null) } satisfies Preview);
    },
    onPointerDown(e, ctx) {
      const g = graphAt(e, ctx);
      if (!g) return;
      const first = ctx.getPreview<Preview>()?.first ?? null;
      if (graphs === 2 && !first) {
        ctx.setPreview({ first: g.curve.id, cursor: e.world, hint: hint(g.curve.id) } satisfies Preview);
        return;
      }
      if (graphs === 2 && first === g.curve.id) return;
      const base = graphs === 2 ? graphOf(first!, ctx.resolve) : g;
      if (!base) return;
      const X = g.frame.toMath(e.world).X;
      const deps = graphs === 2 ? [first!, g.curve.id] : [g.curve.id];
      const id = ctx.createObject(type, { x: 0, y: 0, props: init(base, X), deps });
      ctx.setPreview({ first: null, cursor: e.world, hint: hint(null) } satisfies Preview);
      if (id) {
        ctx.setSelection([id]);
        ctx.activateTool('core.select');
      }
    },
    onKeyDown(key, _m, ctx) {
      if (key === 'Escape' && ctx.getPreview<Preview>()?.first) {
        ctx.setPreview({ first: null, cursor: null, hint: hint(null) } satisfies Preview);
        return true;
      }
      return false;
    },
    onDeactivate(ctx) {
      ctx.setPreview(null);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<Preview>();
      if (!p?.cursor) return null;
      const w = ctx.screenToWorld(1);
      return <Text x={p.cursor.x + 14 * w} y={p.cursor.y + 14 * w} text={p.hint} fontSize={13 * w} fill="#2a7de1" listening={false} />;
    },
  };
}

export const calculusTools = [
  graphTool('graph-point', 'Точка на графике', 'MapPin', ['точка на графике', 'координаты точки'], 1, (_g, X) => ({ x: round(X), color: 'accent-1' })),
  graphTool('roots', 'Нули функции', 'CircleOff', ['нули', 'корни', 'пересечение с осью x'], 1, () => ({ color: 'accent-1', labels: true })),
  graphTool('extrema', 'Экстремумы', 'ChevronsUpDown', ['экстремум', 'максимум', 'минимум', 'вершина параболы'], 1, () => ({ color: 'accent-2', labels: true })),
  graphTool('intersections', 'Точки пересечения графиков', 'X', ['пересечение графиков', 'решение уравнения графически'], 2, () => ({ color: 'accent-1', labels: true })),
  graphTool('tangent', 'Касательная к графику', 'TrendingUp', ['касательная', 'производная', 'угловой коэффициент'], 1, (_g, X) => ({ x: round(X), color: 'accent-5', showEq: true })),
  graphTool('secant', 'Секущая', 'Spline', ['секущая', 'средняя скорость', 'приращение'], 1, (g, X) => {
    const s = niceStep((g.frame.xMax - g.frame.xMin) / 6);
    return { x1: round(X), x2: round(Math.min(g.frame.xMax, X + s)), color: 'accent-7' };
  }),
  graphTool('area', 'Площадь под графиком', 'AreaChart', ['площадь', 'интеграл', 'криволинейная трапеция'], 1, (g, X) => ({ ...around(g, X), color: 'accent-3' })),
  graphTool('area-between', 'Площадь между графиками', 'ChartArea', ['площадь между графиками', 'интеграл разности'], 2, (g, X) => ({ ...around(g, X), color: 'accent-3' })),
  graphTool('riemann', 'Суммы Римана', 'ChartColumn', ['суммы римана', 'интегральная сумма', 'прямоугольники', 'трапеции'], 1, (g, X) => ({ ...around(g, X), n: 8, method: 'left', color: 'accent-2' })),
  graphTool('eps-delta', 'ε-δ', 'Target', ['эпсилон дельта', 'предел', 'определение предела', 'непрерывность'], 1, (g, X) => ({
    x0: round(X, 10),
    eps: round((g.frame.yMax - g.frame.yMin) / 20, 1000),
    delta: round((g.frame.xMax - g.frame.xMin) / 30, 1000),
    color: 'accent-6',
  })),
  graphTool('taylor', 'Многочлен Тейлора', 'Sigma', ['тейлор', 'маклорен', 'разложение в ряд', 'приближение'], 1, (_g, X) => ({ x0: round(X, 10), n: 3, color: 'accent-1' })),
  graphTool('fourier', 'Ряд Фурье', 'AudioWaveform', ['фурье', 'тригонометрический ряд', 'гармоники'], 1, () => ({ a: -3.1416, b: 3.1416, n: 5, color: 'accent-5' })),
];
