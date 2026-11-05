import type { ReactNode } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type { InspectorField, Point, ToolContext, ToolModule, ToolPointerEvent } from '@doska/shared';
import { arcPoints, dist, ellipsePoints, polar } from './geometry';
import { CPOINT_TYPE, geomOfId, isPointType } from './eval';
import { FIGURES, PLUGIN_ID, POINT_TYPE, figureType, pointModule, type FigureDef, type FigureProps, type FigureShape, type PointProps } from './objects';

/** Пункт построения: существующая точка или новая (создаётся при завершении). */
type Pick = { id: string; at: Point } | { id: null; at: Point };

interface Preview {
  picks: Pick[];
  cursor: Point | null;
  name: string;
  n: number;
}

export interface ToolOptionsView {
  stroke: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  polygonSides?: number;
}

export const STYLE_OPTIONS: InspectorField[] = [
  { kind: 'color', key: 'stroke', label: 'Цвет' },
  { kind: 'stroke-width', key: 'strokeWidth', label: 'Толщина' },
  { kind: 'line-style', key: 'dash', label: 'Линия' },
];

// ---------------------------------------------------------------------
//  Подписи точек
// ---------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SUB = '₀₁₂₃₄₅₆₇₈₉';

/** Подписи A…Z, затем A₁…Z₁, A₂… — первые свободные на странице. */
export function nextLabels(used: Iterable<string>, count: number): string[] {
  const taken = new Set(used);
  const out: string[] = [];
  for (let round = 0; out.length < count && round < 1000; round++) {
    const suffix = round === 0 ? '' : String(round).replace(/\d/g, (d) => SUB[Number(d)]!);
    for (const l of LETTERS) {
      const name = l + suffix;
      if (!taken.has(name)) {
        out.push(name);
        taken.add(name);
        if (out.length === count) break;
      }
    }
  }
  return out;
}

export function usedLabels(ctx: ToolContext): string[] {
  return [...ctx.listObjects(POINT_TYPE), ...ctx.listObjects(CPOINT_TYPE)].map((o) => String((o.props as PointProps).label ?? ''));
}

/** Точка под курсором (свободная или зависимая): привязка к точке (refId) или попадание. */
export function existingPoint(e: ToolPointerEvent, ctx: ToolContext): string | null {
  const ref = e.snap?.refId ? ctx.resolve.getObject(e.snap.refId) : undefined;
  if (ref && isPointType(ref.type) && geomOfId(ref.id, ctx.resolve)) return ref.id;
  const hit = ctx.hitTest(e.world, ctx.screenToWorld(8)).find((o) => isPointType(o.type));
  return hit?.id ?? null;
}

/** Положение точки-объекта. */
export function pointPos(id: string, ctx: ToolContext): Point | null {
  const g = geomOfId(id, ctx.resolve);
  return g?.kind === 'point' ? g.p : null;
}

function pickAt(e: ToolPointerEvent, ctx: ToolContext): Pick {
  const id = existingPoint(e, ctx);
  const at = id ? pointPos(id, ctx) : null;
  return id && at ? { id, at } : { id: null, at: e.snapped };
}

/**
 * Создать недостающие точки и фигуру одной транзакцией (один шаг отмены).
 * Возвращает id фигуры.
 */
function commit(ctx: ToolContext, def: FigureDef | null, picks: Pick[]): string {
  const opts = ctx.getToolOptions<ToolOptionsView>();
  let figureId = '';
  ctx.transact(() => {
    const fresh = picks.filter((p) => !p.id).length;
    const labels = nextLabels(usedLabels(ctx), fresh);
    const ids: string[] = [];
    for (const p of picks) {
      if (p.id) {
        ids.push(p.id);
        continue;
      }
      const props: PointProps = { ...pointModule.createProps(), label: labels.shift() ?? '', color: opts.stroke, auto: !!def };
      const id = ctx.createObject<PointProps>(POINT_TYPE, { x: p.at.x, y: p.at.y, props });
      if (!id) return;
      ids.push(id);
    }
    if (!def) {
      figureId = ids[0] ?? '';
      return;
    }
    const props: FigureProps = {
      color: opts.stroke,
      width: opts.strokeWidth,
      dash: opts.dash,
      label: '',
      fill: false,
      fb: picks.flatMap((p) => [p.at.x, p.at.y]),
      ...(def.name === 'regular-polygon' ? { n: sidesOf(ctx) } : {}),
    };
    figureId = ctx.createObject<FigureProps>(figureType(def.name), { x: 0, y: 0, props, deps: ids });
  });
  return figureId;
}

const sidesOf = (ctx: ToolContext) => Math.min(24, Math.max(3, Math.round(Number(ctx.getToolOptions<ToolOptionsView>().polygonSides) || 6)));

// ---------------------------------------------------------------------
//  Предпросмотр
// ---------------------------------------------------------------------

function ghostShape(def: FigureDef, pts: Point[], n: number): FigureShape | null {
  const need = def.points ?? def.minPoints ?? 2;
  if (pts.length < Math.min(need, 2)) return null;
  if (def.points && pts.length < def.points) {
    // Не хватает точек: дуга и эллипс показываются как окружность по двум первым.
    if (pts.length === 2 && (def.name === 'arc' || def.name === 'sector' || def.name === 'circle-segment' || def.name === 'ellipse')) {
      return { kind: 'circle', c: pts[0]!, r: dist(pts[0]!, pts[1]!) };
    }
    return null;
  }
  return def.evaluate(
    pts.map((p) => ({ kind: 'point' as const, p })),
    { color: 'ink', width: 2, dash: 'solid', label: '', fill: false, fb: [], n },
  );
}

function ghostPoints(s: FigureShape, far: number): { pts: Point[]; closed: boolean } {
  switch (s.kind) {
    case 'linear': {
      const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      const l = Math.hypot(d.x, d.y) || 1;
      const u = { x: d.x / l, y: d.y / l };
      if (s.mode === 'line') return { pts: [{ x: s.a.x - u.x * far, y: s.a.y - u.y * far }, { x: s.a.x + u.x * far, y: s.a.y + u.y * far }], closed: false };
      if (s.mode === 'ray') return { pts: [s.a, { x: s.a.x + u.x * far, y: s.a.y + u.y * far }], closed: false };
      return { pts: [s.a, s.b], closed: false };
    }
    case 'poly':
      return { pts: s.pts, closed: s.closed };
    case 'circle':
      return { pts: Array.from({ length: 72 }, (_, i) => polar(s.c, s.r, (Math.PI * 2 * i) / 72)), closed: true };
    case 'arc': {
      const a = arcPoints(s.g);
      return s.mode === 'sector' ? { pts: [s.g.center, ...a], closed: true } : { pts: a, closed: s.mode === 'segment' };
    }
    case 'ellipse':
      return { pts: ellipsePoints(s.g), closed: true };
  }
}

function renderPreview(ctx: ToolContext): ReactNode {
  const p = ctx.getPreview<Preview>();
  if (!p) return null;
  const def = FIGURES.find((f) => f.name === p.name) ?? null;
  const pts = [...p.picks.map((x) => x.at), ...(p.cursor ? [p.cursor] : [])];
  const w = ctx.screenToWorld(1);
  const color = '#2a7de1';
  const s = def ? ghostShape(def, pts, p.n) : null;
  const g = s ? ghostPoints(s, w * 4000) : null;
  return (
    <Group listening={false}>
      {g && <Line points={g.pts.flatMap((q) => [q.x, q.y])} closed={g.closed} stroke={color} strokeWidth={2} strokeScaleEnabled={false} dash={[6 * w, 4 * w]} listening={false} />}
      {!s && def && pts.length > 1 && <Line points={pts.flatMap((q) => [q.x, q.y])} stroke={color} strokeWidth={2} strokeScaleEnabled={false} dash={[6 * w, 4 * w]} listening={false} />}
      {p.picks.map((q, i) => (
        <Circle key={i} x={q.at.x} y={q.at.y} radius={4 * w} fill={color} listening={false} />
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------
//  Инструменты
// ---------------------------------------------------------------------

export const section = PLUGIN_ID;

export const pointTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.point`,
  title: 'Точка',
  icon: 'Dot',
  group: 'math',
  section,
  hotkey: 'Shift+P',
  keywords: ['точка', 'планиметрия', 'геометрия', 'point'],
  requiresWrite: true,
  snapping: true,
  cursor: 'crosshair',
  options: [{ kind: 'color', key: 'stroke', label: 'Цвет' }],
  onPointerUp(e, ctx) {
    const existing = existingPoint(e, ctx);
    if (existing) {
      ctx.setSelection([existing]);
      return;
    }
    const id = commit(ctx, null, [{ id: null, at: e.snapped }]);
    if (id) ctx.setSelection([id]);
  },
};

const ICONS: Record<string, string> = {
  segment: 'Slash',
  ray: 'ArrowRightFromLine',
  line: 'MoveHorizontal',
  vector: 'MoveUpRight',
  polyline: 'Waypoints',
  polygon: 'Pentagon',
  'regular-polygon': 'Hexagon',
  circle: 'CircleDot',
  arc: 'Rainbow',
  sector: 'ChartPie',
  'circle-segment': 'CircleSlash',
  ellipse: 'Egg',
};

const HINTS: Record<string, string[]> = {
  segment: ['отрезок', 'сторона', 'segment'],
  ray: ['луч', 'полупрямая', 'ray'],
  line: ['прямая', 'line'],
  vector: ['вектор', 'направленный отрезок', 'vector'],
  polyline: ['ломаная', 'polyline'],
  polygon: ['многоугольник', 'треугольник', 'четырёхугольник', 'polygon'],
  'regular-polygon': ['правильный многоугольник', 'шестиугольник', 'квадрат', 'правильный треугольник'],
  circle: ['окружность', 'круг', 'радиус', 'circle'],
  arc: ['дуга', 'arc'],
  sector: ['сектор', 'круговой сектор'],
  'circle-segment': ['сегмент', 'круговой сегмент'],
  ellipse: ['эллипс', 'ellipse'],
};

const STEPS: Record<string, string> = {
  arc: 'центр, начало дуги, конец (против часовой стрелки)',
  sector: 'центр, начало дуги, конец (против часовой стрелки)',
  'circle-segment': 'центр, начало дуги, конец (против часовой стрелки)',
  ellipse: 'центр, конец полуоси, точка второй полуоси',
  circle: 'центр, точка окружности',
};

/** Инструмент построения фигуры по точкам: щелчки (или протяжка для двух точек). */
function figureTool(def: FigureDef): ToolModule<ReactNode> {
  const free = def.points === null;
  let downAt: Point | null = null;
  const preview = (ctx: ToolContext, picks: Pick[], cursor: Point | null) =>
    ctx.setPreview(picks.length || cursor ? ({ picks, cursor, name: def.name, n: sidesOf(ctx) } satisfies Preview) : null);
  const picksOf = (ctx: ToolContext) => ctx.getPreview<Preview>()?.picks ?? [];
  const finish = (ctx: ToolContext, picks: Pick[]) => {
    ctx.setPreview(null);
    if (picks.length < (def.points ?? def.minPoints ?? 2)) return;
    const id = commit(ctx, def, picks);
    if (id) ctx.setSelection([id]);
  };
  const add = (e: ToolPointerEvent, ctx: ToolContext) => {
    const picks = picksOf(ctx);
    const p = pickAt(e, ctx);
    const first = picks[0];
    // Ломаная и многоугольник: щелчок по первой точке замыкает, по последней — завершает.
    if (free && picks.length >= (def.minPoints ?? 2) - (def.closed ? 0 : 1)) {
      const last = picks[picks.length - 1]!;
      const near = (q: Pick) => (p.id && q.id === p.id) || dist(q.at, p.at) < ctx.screenToWorld(8);
      if ((def.closed && first && near(first)) || (!def.closed && near(last))) {
        finish(ctx, picks);
        return;
      }
    }
    // Одна и та же точка дважды подряд — не новая вершина.
    const last = picks[picks.length - 1];
    if (last && ((p.id && last.id === p.id) || dist(last.at, p.at) < 1e-6)) return;
    const next = [...picks, p];
    if (def.points && next.length >= def.points) finish(ctx, next);
    else preview(ctx, next, e.snapped);
  };
  return {
    id: `${PLUGIN_ID}.${def.name}`,
    title: def.title,
    icon: ICONS[def.name] ?? 'Shapes',
    group: 'math',
    section,
    keywords: [...(HINTS[def.name] ?? []), 'планиметрия', 'геометрия', ...(STEPS[def.name] ? [STEPS[def.name]!] : [])],
    requiresWrite: true,
    snapping: true,
    cursor: 'crosshair',
    options: def.name === 'regular-polygon' ? [...STYLE_OPTIONS, { kind: 'number', key: 'polygonSides', label: 'Сторон', min: 3, max: 24, step: 1 }] : STYLE_OPTIONS,
    onPointerDown(e, ctx) {
      downAt = e.snapped;
      add(e, ctx);
    },
    onPointerMove(e, ctx) {
      const picks = picksOf(ctx);
      if (picks.length) preview(ctx, picks, e.snapped);
    },
    onPointerUp(e, ctx) {
      // Протяжка для фигур из двух точек: отпускание — вторая точка.
      const picks = picksOf(ctx);
      if (def.points === 2 && picks.length === 1 && downAt && dist(downAt, e.snapped) > ctx.screenToWorld(12)) add(e, ctx);
      downAt = null;
    },
    onKeyDown(key, _m, ctx) {
      const picks = picksOf(ctx);
      if (key === 'Escape' && picks.length) {
        ctx.setPreview(null);
        return true;
      }
      if (key === 'Enter' && free) {
        finish(ctx, picks);
        return true;
      }
      if (key === 'Backspace' && picks.length) {
        preview(ctx, picks.slice(0, -1), null);
        return true;
      }
      return false;
    },
    onDeactivate(ctx) {
      // Незаконченная ломаная/многоугольник достраивается, если точек хватает.
      const picks = picksOf(ctx);
      if (free && picks.length >= (def.minPoints ?? 2)) finish(ctx, picks);
      else ctx.setPreview(null);
    },
    renderOverlay: renderPreview,
  };
}

export const figureTools = FIGURES.filter((f) => f.points !== undefined).map(figureTool);
