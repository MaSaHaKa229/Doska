import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point, RenderContext, ResolveContext } from '@doska/shared';
import { SURFACE_COLORS } from '../../objects/colors';
import { dashFor, toLocal } from '../../objects/util';
import { useBoard } from '../../store/board';
import { fmtNum, mathReady, niceStep, parseCurve, useMathReady } from './expr';
import {
  AXES_TYPE,
  CURVE_TYPE,
  NUMBERLINE_TYPE,
  SLIDER_TYPE,
  TABLE_TYPE,
  TRIG_TYPE,
  curveState,
  frameOf,
  paramsOf,
  type AxesProps,
  type CurveProps,
  type Frame,
} from './plot';

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const paper = (ctx: RenderContext) => SURFACE_COLORS[ctx.theme].paper;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
type Ctx2D = CanvasRenderingContext2D;
const raw = (c: Konva.Context) => (c as unknown as { _context: Ctx2D })._context;

/** Набор отдельных отрезков одной фигурой (x1, y1, x2, y2 подряд) — без соединительных линий. */
function Segments({ pts, stroke, opacity = 1 }: { pts: number[]; stroke: string; opacity?: number }) {
  return (
    <Shape
      sceneFunc={(c, shape) => {
        const g = raw(c);
        g.beginPath();
        for (let k = 0; k + 3 < pts.length; k += 4) {
          g.moveTo(pts[k]!, pts[k + 1]!);
          g.lineTo(pts[k + 2]!, pts[k + 3]!);
        }
        c.strokeShape(shape);
      }}
      stroke={stroke}
      strokeWidth={1}
      strokeScaleEnabled={false}
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

// =====================================================================
//  Система координат
// =====================================================================

export const axesPropsSchema = z
  .object({
    w: z.number().finite().min(80).max(5000),
    h: z.number().finite().min(80).max(5000),
    xMin: z.number().finite(),
    xMax: z.number().finite(),
    yMin: z.number().finite(),
    yMax: z.number().finite(),
    grid: z.boolean(),
    color: z.string().max(32),
  })
  .refine((p) => p.xMax > p.xMin && p.yMax > p.yMin, 'Пределы осей: максимум больше минимума');

/** Деления оси: шаг и значения в пределах (подписи не чаще ~50 единиц доски). */
export function ticks(min: number, max: number, size: number): { step: number; values: number[] } {
  const step = niceStep(((max - min) * 50) / size);
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) values.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { step, values };
}

function AxesShape({ o, ctx }: { o: BoardObject<AxesProps>; ctx: RenderContext }) {
  const p = o.props;
  const fr = frameOf({ ...o, x: 0, y: 0 });
  const color = ctx.resolveColor(p.color);
  const gridColor = SURFACE_COLORS[ctx.theme].gridStrong;
  const tx = ticks(p.xMin, p.xMax, p.w);
  const ty = ticks(p.yMin, p.yMax, p.h);
  // Ось на нуле, если он в пределах, иначе — у края.
  const x0 = fr.toWorld(Math.min(Math.max(0, p.xMin), p.xMax), 0).x;
  const y0 = fr.toWorld(0, Math.min(Math.max(0, p.yMin), p.yMax)).y;
  const els: ReactNode[] = [];
  if (p.grid) {
    const pts: number[] = [];
    for (const v of tx.values) {
      const x = fr.toWorld(v, 0).x;
      pts.push(x, 0, x, p.h);
    }
    for (const v of ty.values) {
      const y = fr.toWorld(0, v).y;
      pts.push(0, y, p.w, y);
    }
    els.push(<Segments key="grid" pts={pts} stroke={gridColor} />);
  }
  for (const v of tx.values) {
    if (v === 0) continue;
    const x = fr.toWorld(v, 0).x;
    els.push(<Line key={`tx${v}`} points={[x, y0 - 4, x, y0 + 4]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key={`lx${v}`} x={x - 20} y={Math.min(p.h - 14, y0 + 6)} width={40} align="center" text={fmtNum(v)} fontSize={11} fill={color} listening={false} />);
  }
  for (const v of ty.values) {
    if (v === 0) continue;
    const y = fr.toWorld(0, v).y;
    els.push(<Line key={`ty${v}`} points={[x0 - 4, y, x0 + 4, y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key={`ly${v}`} x={Math.max(0, x0 - 46)} y={y - 6} width={40} align="right" text={fmtNum(v)} fontSize={11} fill={color} listening={false} />);
  }
  return (
    <Group>
      <KRect width={p.w} height={p.h} fill={paper(ctx)} opacity={0.94} stroke={gridColor} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {els}
      <Arrow points={[0, y0, p.w, y0]} stroke={color} fill={color} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={8} pointerWidth={6} listening={false} />
      <Arrow points={[x0, p.h, x0, 0]} stroke={color} fill={color} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={8} pointerWidth={6} listening={false} />
      <Text x={p.w - 14} y={y0 - 20} text="x" fontSize={15} fontStyle="italic" fontFamily="Times New Roman, serif" fill={color} listening={false} />
      <Text x={x0 + 8} y={2} text="y" fontSize={15} fontStyle="italic" fontFamily="Times New Roman, serif" fill={color} listening={false} />
      {p.xMin < 0 && p.xMax > 0 && p.yMin < 0 && p.yMax > 0 && <Text x={x0 - 12} y={y0 + 4} text="0" fontSize={11} fill={color} listening={false} />}
    </Group>
  );
}

export const axesModule: ObjectModule<AxesProps, ReactNode> = {
  type: AXES_TYPE,
  title: 'Система координат',
  version: 1,
  propsSchema: axesPropsSchema as unknown as z.ZodType<AxesProps>,
  createProps: () => ({ w: 480, h: 360, xMin: -8, xMax: 8, yMin: -6, yMax: 6, grid: true, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<AxesProps>,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: o.props.h }),
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    return p.x >= -tol && p.y >= -tol && p.x <= o.props.w + tol && p.y <= o.props.h + tol;
  },
  getHandles: () => [],
  getSnapPoints: (o) => {
    const fr = frameOf(o);
    return o.props.xMin <= 0 && o.props.xMax >= 0 && o.props.yMin <= 0 && o.props.yMax >= 0 ? [{ kind: 'center', point: fr.toWorld(0, 0) }] : [];
  },
  render: (o, ctx) => <AxesShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const fr = frameOf(o);
    const z = fr.toWorld(0, 0);
    return `<rect x="${o.x}" y="${o.y}" width="${o.props.w}" height="${o.props.h}" fill="${paper(ctx)}" stroke="#ccc"/><line x1="${o.x}" y1="${z.y}" x2="${o.x + o.props.w}" y2="${z.y}" stroke="${c}"/><line x1="${z.x}" y1="${o.y}" x2="${z.x}" y2="${o.y + o.props.h}" stroke="${c}"/>`;
  },
  inspector: [
    { kind: 'number', key: 'xMin', label: 'x от', step: 1 },
    { kind: 'number', key: 'xMax', label: 'до', step: 1 },
    { kind: 'number', key: 'yMin', label: 'y от', step: 1 },
    { kind: 'number', key: 'yMax', label: 'до', step: 1 },
    { kind: 'toggle', key: 'grid', label: 'Сетка' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'free' },
  // Растяжение рамкой меняет размер области, пределы осей сохраняются.
  applyResize: (o, scaleX, scaleY) => ({
    scaleX: 1,
    scaleY: 1,
    props: { w: Math.max(80, o.props.w * Math.abs(scaleX)), h: Math.max(80, o.props.h * Math.abs(scaleY)) },
  }),
};

// =====================================================================
//  График
// =====================================================================

export const curvePropsSchema = z.object({
  text: z.string().max(300),
  color: z.string().max(32),
  width: z.number().finite().min(0.5).max(16),
  dash: z.enum(['solid', 'dashed', 'dotted']),
  showLabel: z.boolean(),
  tMin: z.number().finite(),
  tMax: z.number().finite(),
});

function drawPlot(c: Konva.Context, shape: Konva.Shape, lines: Point[][], segments: number[]) {
  const g = raw(c);
  g.beginPath();
  for (const l of lines) {
    g.moveTo(l[0]!.x, l[0]!.y);
    for (let i = 1; i < l.length; i++) g.lineTo(l[i]!.x, l[i]!.y);
  }
  for (let k = 0; k < segments.length; k += 4) {
    g.moveTo(segments[k]!, segments[k + 1]!);
    g.lineTo(segments[k + 2]!, segments[k + 3]!);
  }
  c.strokeShape(shape);
}

function CurveShape({ o, ctx }: { o: BoardObject<CurveProps>; ctx: RenderContext }) {
  useMathReady();
  useZoom();
  const st = curveState(o, ctx);
  if (!st.frame) return null;
  const r = st.frame.rect;
  const color = ctx.resolveColor(o.props.color);
  if (!st.ok) {
    return st.reason === 'Загрузка…' ? null : (
      <Text x={r.x + 8} y={r.y + 8} text={`${o.props.text}: ${st.reason}`} fontSize={13} fill={ctx.resolveColor('muted')} listening={false} />
    );
  }
  const { plot } = st;
  const cells = plot.cells;
  return (
    <Group clipX={r.x} clipY={r.y} clipWidth={r.width} clipHeight={r.height}>
      {cells.length > 0 && (
        <Shape
          sceneFunc={(c, shape) => {
            const g = raw(c);
            g.beginPath();
            for (let k = 0; k < cells.length; k += 4) g.rect(cells[k]!, cells[k + 1]!, cells[k + 2]! + 0.5, cells[k + 3]! + 0.5);
            c.fillShape(shape);
          }}
          fill={color}
          opacity={0.18}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <Shape
        sceneFunc={(c, shape) => drawPlot(c, shape, plot.lines, plot.segments)}
        stroke={color}
        strokeWidth={o.props.width}
        strokeScaleEnabled={false}
        dash={plot.dashedBoundary ? [8, 6] : dashFor(o.props.dash, o.props.width)}
        lineCap="round"
        lineJoin="round"
        listening={false}
        perfectDrawEnabled={false}
      />
      {o.props.showLabel && plot.labelAt && (
        // Подпись выровнена вправо к концу линии — не выходит за правый край осей.
        <Text x={Math.min(plot.labelAt.x, r.x + r.width - 6) - 304} width={300} y={Math.max(r.y + 2, plot.labelAt.y - 22)} text={st.parsed.caption} fontSize={14} fill={color} align="right" listening={false} wrap="none" />
      )}
    </Group>
  );
}

/** Расстояние до построенного графика (мировые единицы). */
function plotDistance(o: BoardObject<CurveProps>, ctx: ResolveContext, p: Point, tol: number): boolean {
  if (!mathReady()) return false;
  const st = curveState(o, ctx);
  if (!st.ok) return false;
  // Линия обрезана по области осей: за её пределами графика не видно.
  const r = st.frame.rect;
  if (p.x < r.x || p.y < r.y || p.x > r.x + r.width || p.y > r.y + r.height) return false;
  const near = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
    return Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)) <= tol;
  };
  for (const l of st.plot.lines) for (let i = 1; i < l.length; i++) if (near(l[i - 1]!.x, l[i - 1]!.y, l[i]!.x, l[i]!.y)) return true;
  const s = st.plot.segments;
  for (let k = 0; k < s.length; k += 4) if (near(s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!)) return true;
  const c = st.plot.cells;
  for (let k = 0; k < c.length; k += 4) if (p.x >= c[k]! && p.x <= c[k]! + c[k + 2]! && p.y >= c[k + 1]! && p.y <= c[k + 1]! + c[k + 3]!) return true;
  return false;
}

export const curveModule: ObjectModule<CurveProps, ReactNode> = {
  type: CURVE_TYPE,
  title: 'График',
  version: 1,
  propsSchema: curvePropsSchema,
  createProps: () => ({ text: 'y = x', color: 'accent-3', width: 2.5, dash: 'solid', showLabel: true, tMin: 0, tMax: Math.round(Math.PI * 2 * 1e4) / 1e4 }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<CurveProps>,
  getLocalBounds: (o, ctx) => {
    const axes = ctx.getObject(o.deps[0] ?? '');
    return axes?.type === AXES_TYPE ? frameOf(axes).rect : { x: 0, y: 0, width: 0, height: 0 };
  },
  hitTest: (o, p, tol, ctx) => plotDistance(o, ctx, p, tol + 3),
  // Выделяется по линии, а не по всей области осей.
  hitTestRect: () => false,
  getHandles: () => [],
  render: (o, ctx) => <CurveShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    if (!mathReady()) return '';
    const st = curveState(o, ctx);
    if (!st.ok) return '';
    const c = ctx.resolveColor(o.props.color);
    const d = st.plot.lines.map((l) => `M ${l.map((q) => `${q.x} ${q.y}`).join(' L ')}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${o.props.width}"/>`;
  },
  inspector: [
    { kind: 'color', key: 'color', label: 'Цвет' },
    { kind: 'stroke-width', key: 'width', label: 'Толщина' },
    { kind: 'line-style', key: 'dash', label: 'Линия' },
    { kind: 'toggle', key: 'showLabel', label: 'Подпись' },
    { kind: 'number', key: 'tMin', label: 't от', step: 0.1 },
    { kind: 'number', key: 'tMax', label: 'до', step: 0.1 },
  ],
  editor: 'analysis.curve',
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  // Перетаскивание графика двигает его систему координат, но не слайдеры.
  moveDeps: (o) => o.deps.slice(0, 1),
};

// =====================================================================
//  Слайдер параметра
// =====================================================================

export const sliderPropsSchema = z
  .object({
    /** Имя параметра: a, b, k… */
    name: z.string().regex(/^[a-zA-Zα-ω]\w{0,7}$/u, 'Имя — буква и, возможно, цифры'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    value: z.number().finite(),
    /** Длина дорожки (мировые единицы). */
    w: z.number().finite().min(60).max(2000),
    color: z.string().max(32),
  })
  .refine((p) => p.max > p.min, 'Максимум больше минимума');
export type SliderProps = z.infer<typeof sliderPropsSchema>;

const sliderX = (p: SliderProps) => ((Math.min(p.max, Math.max(p.min, p.value)) - p.min) / (p.max - p.min)) * p.w;

function SliderShape({ o, ctx }: { o: BoardObject<SliderProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const color = ctx.resolveColor(p.color);
  const x = sliderX(p);
  return (
    <Group>
      <Line points={[0, 0, p.w, 0]} stroke={ctx.resolveColor('muted')} strokeWidth={4} lineCap="round" strokeScaleEnabled={false} listening={false} />
      <Line points={[0, 0, x, 0]} stroke={color} strokeWidth={4} lineCap="round" strokeScaleEnabled={false} listening={false} />
      <Circle x={x} y={0} radius={8 / zoom} fill={color} stroke={paper(ctx)} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Text x={0} y={-30} text={`${p.name} = ${fmtNum(p.value)}`} fontSize={16} fontStyle="italic" fill={color} listening={false} />
      <Text x={-4} y={10} text={fmtNum(p.min)} fontSize={10} fill={ctx.resolveColor('muted')} listening={false} />
      <Text x={p.w - 36} y={10} width={40} align="right" text={fmtNum(p.max)} fontSize={10} fill={ctx.resolveColor('muted')} listening={false} />
    </Group>
  );
}

export const sliderModule: ObjectModule<SliderProps, ReactNode> = {
  type: SLIDER_TYPE,
  title: 'Слайдер',
  version: 1,
  propsSchema: sliderPropsSchema as unknown as z.ZodType<SliderProps>,
  createProps: () => ({ name: 'a', min: -5, max: 5, step: 0.1, value: 1, w: 200, color: 'accent-2' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<SliderProps>,
  getLocalBounds: (o) => ({ x: -10, y: -34, width: o.props.w + 20, height: 58 }),
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    return p.x >= -10 - tol && p.x <= o.props.w + 10 + tol && p.y >= -34 - tol && p.y <= 24 + tol;
  },
  getHandles: (o) => [{ id: 'value', kind: 'param', position: { x: o.x + sliderX(o.props), y: o.y }, label: `Значение ${o.props.name}`, snap: false }],
  dragHandle: (o, _h, to) => {
    const p = o.props;
    const raw = p.min + Math.min(1, Math.max(0, (to.x - o.x) / p.w)) * (p.max - p.min);
    const value = Math.round((Math.round((raw - p.min) / p.step) * p.step + p.min) * 1e9) / 1e9;
    return value === p.value ? null : { props: { value } };
  },
  render: (o, ctx) => <SliderShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) =>
    `<g transform="translate(${o.x} ${o.y})"><line x1="0" y1="0" x2="${o.props.w}" y2="0" stroke="${ctx.resolveColor('muted')}" stroke-width="4"/><circle cx="${sliderX(o.props)}" cy="0" r="8" fill="${ctx.resolveColor(o.props.color)}"/><text x="0" y="-14" font-size="16">${esc(`${o.props.name} = ${fmtNum(o.props.value)}`)}</text></g>`,
  inspector: [
    { kind: 'text', key: 'name', label: 'Имя', maxLength: 8 },
    { kind: 'number', key: 'value', label: 'Значение', step: 0.1 },
    { kind: 'number', key: 'min', label: 'от', step: 1 },
    { kind: 'number', key: 'max', label: 'до', step: 1 },
    { kind: 'number', key: 'step', label: 'шаг', min: 0.001, step: 0.1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Таблица значений
// =====================================================================

export const tablePropsSchema = z.object({
  from: z.number().finite(),
  step: z.number().finite().positive(),
  count: z.number().int().min(2).max(25),
  color: z.string().max(32),
});
export type TableProps = z.infer<typeof tablePropsSchema>;

const CELL_W = 70;
const CELL_H = 24;

/** Строки таблицы: x и y(x); null — не функция или нет данных. */
export function tableRows(o: BoardObject<TableProps>, ctx: ResolveContext): { x: number; y: number }[] | string {
  const curve = ctx.getObject(o.deps[0] ?? '');
  if (!curve || curve.type !== CURVE_TYPE) return 'нет графика';
  if (!mathReady()) return 'загрузка…';
  const parsed = parseCurve((curve.props as unknown as CurveProps).text);
  if ('error' in parsed) return parsed.error;
  if (parsed.kind !== 'function') return 'только для y = f(x)';
  const params = paramsOf(curve, ctx);
  return Array.from({ length: o.props.count }, (_, i) => {
    const x = Math.round((o.props.from + i * o.props.step) * 1e9) / 1e9;
    return { x, y: parsed.f({ ...params, x }) };
  });
}

function TableShape({ o, ctx }: { o: BoardObject<TableProps>; ctx: RenderContext }) {
  useMathReady();
  const color = ctx.resolveColor(o.props.color);
  const rows = tableRows(o, ctx);
  const curve = ctx.getObject(o.deps[0] ?? '');
  const title = curve ? (curve.props as unknown as CurveProps).text : '';
  if (typeof rows === 'string') return <Text text={`Таблица: ${rows}`} fontSize={13} fill={ctx.resolveColor('muted')} listening={false} />;
  const h = CELL_H * (rows.length + 1);
  const lines: number[] = [0, 0, CELL_W * 2, 0, CELL_W * 2, 0, CELL_W * 2, h, CELL_W * 2, h, 0, h, 0, h, 0, 0, CELL_W, 0, CELL_W, h];
  rows.forEach((_, i) => lines.push(0, CELL_H * (i + 1), CELL_W * 2, CELL_H * (i + 1)));
  return (
    <Group>
      <KRect width={CELL_W * 2} height={h} fill={paper(ctx)} opacity={0.94} listening={false} />
      <Segments pts={lines} stroke={color} />
      <Text x={0} y={-20} text={title} fontSize={12} fill={color} listening={false} />
      <Text x={0} y={6} width={CELL_W} align="center" text="x" fontSize={14} fontStyle="italic" fill={color} listening={false} />
      <Text x={CELL_W} y={6} width={CELL_W} align="center" text="y" fontSize={14} fontStyle="italic" fill={color} listening={false} />
      {rows.map((r, i) => (
        <Group key={i} y={CELL_H * (i + 1) + 6}>
          <Text x={0} width={CELL_W} align="center" text={fmtNum(r.x)} fontSize={13} fill={color} listening={false} />
          <Text x={CELL_W} width={CELL_W} align="center" text={fmtNum(r.y)} fontSize={13} fill={color} listening={false} />
        </Group>
      ))}
    </Group>
  );
}

export const tableModule: ObjectModule<TableProps, ReactNode> = {
  type: TABLE_TYPE,
  title: 'Таблица значений',
  version: 1,
  propsSchema: tablePropsSchema,
  createProps: () => ({ from: -3, step: 1, count: 7, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<TableProps>,
  getLocalBounds: (o) => ({ x: 0, y: -22, width: CELL_W * 2, height: CELL_H * (o.props.count + 1) + 22 }),
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    return p.x >= -tol && p.x <= CELL_W * 2 + tol && p.y >= -22 - tol && p.y <= CELL_H * (o.props.count + 1) + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <TableShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const rows = tableRows(o, ctx);
    if (typeof rows === 'string') return '';
    const c = ctx.resolveColor(o.props.color);
    return `<g transform="translate(${o.x} ${o.y})">${rows.map((r, i) => `<text x="8" y="${CELL_H * (i + 2) - 8}" font-size="13" fill="${c}">${fmtNum(r.x)}</text><text x="${CELL_W + 8}" y="${CELL_H * (i + 2) - 8}" font-size="13" fill="${c}">${fmtNum(r.y)}</text>`).join('')}</g>`;
  },
  inspector: [
    { kind: 'number', key: 'from', label: 'x от', step: 1 },
    { kind: 'number', key: 'step', label: 'шаг', min: 0.001, step: 0.5 },
    { kind: 'number', key: 'count', label: 'Строк', min: 2, max: 25, step: 1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Числовая прямая
// =====================================================================

export const numberLinePropsSchema = z
  .object({
    min: z.number().finite(),
    max: z.number().finite(),
    w: z.number().finite().min(120).max(4000),
    /** Множество: «[-2; 3) ∪ (5; +∞)», точки — «{1; 4}». */
    set: z.string().max(200),
    color: z.string().max(32),
  })
  .refine((p) => p.max > p.min, 'Максимум больше минимума');
export type NumberLineProps = z.infer<typeof numberLinePropsSchema>;

export interface Interval {
  from: number;
  to: number;
  fromClosed: boolean;
  toClosed: boolean;
}

const num = (s: string): number => {
  const t = s.replace(/\s/g, '').replace(',', '.').replace('−', '-');
  if (/^\+?∞$|^\+?inf$/i.test(t)) return Infinity;
  if (/^-∞$|^-inf$/i.test(t)) return -Infinity;
  return Number(t);
};

/** Разбор множества: промежутки и отдельные точки (точка — вырожденный отрезок). */
export function parseSet(src: string): Interval[] | { error: string } {
  const out: Interval[] = [];
  const parts = src.split(/∪|\bU\b|\bu\b/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const iv = /^([[(])\s*([^;]+);\s*([^\])]+)\s*([\])])$/.exec(part);
    if (iv) {
      const from = num(iv[2]!);
      const to = num(iv[3]!);
      if (Number.isNaN(from) || Number.isNaN(to) || from > to) return { error: `Не понял промежуток «${part}»` };
      out.push({ from, to, fromClosed: iv[1] === '[' && Number.isFinite(from), toClosed: iv[4] === ']' && Number.isFinite(to) });
      continue;
    }
    const pts = /^\{([^}]*)\}$/.exec(part);
    if (pts) {
      for (const s of pts[1]!.split(';')) {
        const v = num(s);
        if (!Number.isFinite(v)) return { error: `Не понял точку «${s.trim()}»` };
        out.push({ from: v, to: v, fromClosed: true, toClosed: true });
      }
      continue;
    }
    return { error: `Не понял «${part}»: промежуток [a; b), (a; +∞) или точки {1; 2}` };
  }
  return out;
}

function NumberLineShape({ o, ctx }: { o: BoardObject<NumberLineProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const color = ctx.resolveColor(p.color);
  const ink = ctx.resolveColor('ink');
  const X = (v: number) => ((Math.min(p.max, Math.max(p.min, v)) - p.min) / (p.max - p.min)) * p.w;
  const t = ticks(p.min, p.max, p.w);
  const set = parseSet(p.set);
  const els: ReactNode[] = [];
  for (const v of t.values) {
    els.push(<Line key={`t${v}`} points={[X(v), -5, X(v), 5]} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key={`l${v}`} x={X(v) - 20} y={10} width={40} align="center" text={fmtNum(v)} fontSize={12} fill={ink} listening={false} />);
  }
  if (Array.isArray(set)) {
    set.forEach((iv, i) => {
      const a = X(iv.from);
      const b = X(iv.to);
      if (iv.to > iv.from) {
        els.push(<Line key={`s${i}`} points={[a, -10, b, -10]} stroke={color} strokeWidth={5} strokeScaleEnabled={false} lineCap="butt" listening={false} />);
        els.push(<Line key={`h${i}`} points={[a, -10, a, 0, a, -10, b, -10, b, 0]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} opacity={0.5} listening={false} />);
      }
      const end = (v: number, closed: boolean, k: string) =>
        Number.isFinite(v) && v >= p.min && v <= p.max && (
          <Circle key={k} x={X(v)} y={0} radius={5 / zoom} fill={closed ? color : paper(ctx)} stroke={color} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
        );
      els.push(end(iv.from, iv.fromClosed, `a${i}`), iv.to !== iv.from ? end(iv.to, iv.toClosed, `b${i}`) : null);
    });
  }
  return (
    <Group>
      <Arrow points={[-10, 0, p.w + 16, 0]} stroke={ink} fill={ink} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={8} pointerWidth={6} listening={false} />
      {els}
      <Text x={0} y={-36} text={Array.isArray(set) ? p.set : `${p.set} — ${set.error}`} fontSize={14} fill={Array.isArray(set) ? color : ctx.resolveColor('accent-1')} listening={false} />
    </Group>
  );
}

export const numberLineModule: ObjectModule<NumberLineProps, ReactNode> = {
  type: NUMBERLINE_TYPE,
  title: 'Числовая прямая',
  version: 1,
  propsSchema: numberLinePropsSchema as unknown as z.ZodType<NumberLineProps>,
  createProps: () => ({ min: -5, max: 7, w: 480, set: '[-2; 3) ∪ (5; +∞)', color: 'accent-3' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<NumberLineProps>,
  getLocalBounds: (o) => ({ x: -12, y: -40, width: o.props.w + 32, height: 66 }),
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    return p.x >= -12 - tol && p.x <= o.props.w + 20 + tol && p.y >= -40 - tol && p.y <= 26 + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <NumberLineShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => `<g transform="translate(${o.x} ${o.y})"><line x1="0" y1="0" x2="${o.props.w}" y2="0" stroke="${ctx.resolveColor('ink')}"/><text x="0" y="-20" font-size="14">${esc(o.props.set)}</text></g>`,
  inspector: [
    { kind: 'text', key: 'set', label: 'Множество', maxLength: 200 },
    { kind: 'number', key: 'min', label: 'от', step: 1 },
    { kind: 'number', key: 'max', label: 'до', step: 1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Тригонометрическая окружность
// =====================================================================

export const trigPropsSchema = z.object({
  /** Радиус на доске (мировые единицы). */
  r: z.number().finite().min(60).max(1000),
  /** Угол α, градусы (против часовой стрелки). */
  angle: z.number().finite().min(-720).max(720),
  showSin: z.boolean(),
  showCos: z.boolean(),
  showTan: z.boolean(),
  /** Отметки π/6, π/4, π/3… */
  showMarks: z.boolean(),
  color: z.string().max(32),
});
export type TrigProps = z.infer<typeof trigPropsSchema>;

const MARKS: [number, string][] = [
  [0, '0'],
  [30, 'π/6'],
  [45, 'π/4'],
  [60, 'π/3'],
  [90, 'π/2'],
  [120, '2π/3'],
  [135, '3π/4'],
  [150, '5π/6'],
  [180, 'π'],
  [210, '7π/6'],
  [225, '5π/4'],
  [240, '4π/3'],
  [270, '3π/2'],
  [300, '5π/3'],
  [315, '7π/4'],
  [330, '11π/6'],
];

/** Значения тригонометрических функций угла (градусы), «—» если не определено. */
export function trigValues(deg: number): { sin: number; cos: number; tan: number } {
  const a = (deg * Math.PI) / 180;
  const s = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a);
  const c = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a);
  return { sin: s, cos: c, tan: c === 0 ? NaN : s / c };
}

const pt = (r: number, deg: number): Point => ({ x: r * Math.cos((deg * Math.PI) / 180), y: -r * Math.sin((deg * Math.PI) / 180) });

function TrigShape({ o, ctx }: { o: BoardObject<TrigProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const R = p.r;
  const ink = ctx.resolveColor('ink');
  const color = ctx.resolveColor(p.color);
  const v = trigValues(p.angle);
  const P = pt(R, p.angle);
  const els: ReactNode[] = [];
  if (p.showMarks) {
    for (const [d, label] of MARKS) {
      const q = pt(R, d);
      const l = pt(R + 22, d);
      els.push(<Circle key={`m${d}`} x={q.x} y={q.y} radius={2.5 / zoom} fill={ink} listening={false} />);
      els.push(<Text key={`t${d}`} x={l.x - 18} y={l.y - 7} width={36} align="center" text={label} fontSize={12} fill={ink} listening={false} />);
    }
  }
  const dash = [5 / zoom, 4 / zoom];
  if (p.showCos) {
    els.push(<Line key="cos" points={[0, 0, P.x, 0]} stroke="#2a7de1" strokeWidth={4} strokeScaleEnabled={false} listening={false} />);
    els.push(<Line key="cosp" points={[P.x, P.y, P.x, 0]} stroke="#2a7de1" strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key="cost" x={P.x / 2 - 40} y={10} width={80} align="center" text={`cos α = ${fmtNum(v.cos, 3)}`} fontSize={13} fill="#2a7de1" listening={false} />);
  }
  if (p.showSin) {
    els.push(<Line key="sin" points={[0, 0, 0, P.y]} stroke="#d13a3a" strokeWidth={4} strokeScaleEnabled={false} listening={false} />);
    els.push(<Line key="sinp" points={[P.x, P.y, 0, P.y]} stroke="#d13a3a" strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />);
    els.push(<Text key="sint" x={6} y={P.y / 2 - 7} text={`sin α = ${fmtNum(v.sin, 3)}`} fontSize={13} fill="#d13a3a" listening={false} />);
  }
  if (p.showTan) {
    // Линия тангенсов x = 1; точка — пересечение с продолжением радиуса.
    els.push(<Line key="tl" points={[R, -R * 2, R, R * 2]} stroke={ink} strokeWidth={1} opacity={0.5} strokeScaleEnabled={false} listening={false} />);
    if (Number.isFinite(v.tan) && Math.abs(v.tan) < 2) {
      const T = { x: R, y: -v.tan * R };
      els.push(<Line key="tr" points={[0, 0, T.x, T.y]} stroke="#1a9b55" strokeWidth={1} dash={dash} strokeScaleEnabled={false} listening={false} />);
      els.push(<Line key="tv" points={[R, 0, T.x, T.y]} stroke="#1a9b55" strokeWidth={4} strokeScaleEnabled={false} listening={false} />);
    }
    els.push(<Text key="tt" x={R + 8} y={-R - 20} text={`tg α = ${Number.isFinite(v.tan) ? fmtNum(v.tan, 3) : 'не определён'}`} fontSize={13} fill="#1a9b55" listening={false} />);
  }
  const arc = Array.from({ length: 41 }, (_, i) => pt(24, (p.angle * i) / 40)).flatMap((q) => [q.x, q.y]);
  return (
    <Group>
      <Circle radius={R} fill={paper(ctx)} opacity={0.9} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Arrow points={[-R - 24, 0, R + 34, 0]} stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} pointerLength={7} pointerWidth={5} listening={false} />
      <Arrow points={[0, R + 24, 0, -R - 34]} stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} pointerLength={7} pointerWidth={5} listening={false} />
      {els}
      <Line points={arc} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Line points={[0, 0, P.x, P.y]} stroke={color} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Circle x={P.x} y={P.y} radius={7 / zoom} fill={color} stroke={paper(ctx)} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Text x={-R - 10} y={-R - 34} text={`α = ${fmtNum(p.angle, 4)}°`} fontSize={15} fontStyle="bold" fill={color} listening={false} />
    </Group>
  );
}

export const trigModule: ObjectModule<TrigProps, ReactNode> = {
  type: TRIG_TYPE,
  title: 'Тригонометрическая окружность',
  version: 1,
  propsSchema: trigPropsSchema,
  createProps: () => ({ r: 140, angle: 30, showSin: true, showCos: true, showTan: false, showMarks: true, color: 'accent-6' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<TrigProps>,
  getLocalBounds: (o) => ({ x: -o.props.r - 50, y: -o.props.r - 44, width: o.props.r * 2 + 150, height: o.props.r * 2 + 80 }),
  hitTest: (o, point, tol) => Math.hypot(point.x - o.x, point.y - o.y) <= o.props.r + 30 + tol,
  getHandles: (o) => {
    const P = pt(o.props.r, o.props.angle);
    return [{ id: 'angle', kind: 'param', position: { x: o.x + P.x, y: o.y + P.y }, label: 'Угол α (Shift — шаг 15°)', snap: false }];
  },
  dragHandle: (o, _h, to, m) => {
    let deg = (Math.atan2(-(to.y - o.y), to.x - o.x) * 180) / Math.PI;
    // Угол продолжается от прежнего: можно пройти больше 360° и в минус.
    const prev = o.props.angle;
    deg += Math.round((prev - deg) / 360) * 360;
    // Прилипание к отмеченным углам (±3°) и Shift — шаг 15°.
    const snap = m.shift ? 15 : 0;
    if (snap) deg = Math.round(deg / snap) * snap;
    else {
      const near = MARKS.map(([d]) => d + Math.round((deg - d) / 360) * 360).find((d) => Math.abs(d - deg) < 3);
      if (near !== undefined) deg = near;
      else deg = Math.round(deg);
    }
    deg = Math.max(-720, Math.min(720, deg));
    return deg === prev ? null : { props: { angle: deg } };
  },
  getSnapPoints: (o) => [{ kind: 'center', point: { x: o.x, y: o.y } }],
  render: (o, ctx) => <TrigShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const P = pt(o.props.r, o.props.angle);
    return `<g transform="translate(${o.x} ${o.y})"><circle r="${o.props.r}" fill="none" stroke="${ctx.resolveColor('ink')}"/><line x1="0" y1="0" x2="${P.x}" y2="${P.y}" stroke="${ctx.resolveColor(o.props.color)}" stroke-width="2"/></g>`;
  },
  inspector: [
    { kind: 'number', key: 'angle', label: 'α, °', min: -720, max: 720, step: 1, slider: true },
    { kind: 'toggle', key: 'showSin', label: 'sin' },
    { kind: 'toggle', key: 'showCos', label: 'cos' },
    { kind: 'toggle', key: 'showTan', label: 'tg' },
    { kind: 'toggle', key: 'showMarks', label: 'Отметки' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

export const analysisModules = [axesModule, curveModule, sliderModule, tableModule, numberLineModule, trigModule];
export type { Frame };
