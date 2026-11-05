import type { ReactNode } from 'react';
import { Circle, Group, Text } from 'react-konva';
import type { BoardObject, InspectorField, Point, ToolContext, ToolModule, ToolPointerEvent } from '@doska/shared';
import { dist, intersections, paramOf, type Geom } from './geometry';
import { CPOINT_TYPE, evaluate, isPointType, PLUGIN_ID, POINT_TYPE } from './eval';
import {
  ANGLE_TYPE,
  FIGURES,
  TICKS_TYPE,
  figureType,
  pointModule,
  type AngleProps,
  type CPointKind,
  type CPointProps,
  type FigureProps,
  type PointProps,
  type TicksProps,
  type XformKind,
} from './objects';
import { existingPoint, nextLabels, pointPos, STYLE_OPTIONS, usedLabels, type ToolOptionsView } from './tools';

export const SECTION_CONSTRUCT = `${PLUGIN_ID}.constructions`;
export const SECTION_TRANSFORM = `${PLUGIN_ID}.transforms`;
export const SECTION_MARKS = `${PLUGIN_ID}.marks`;

/** Что принимает шаг построения. */
type Want = 'point' | 'linear' | 'circle' | 'curve' | 'object';

/** Выбранное на шаге: существующий объект или новая точка (создаётся при завершении). */
interface Picked {
  id: string | null;
  at: Point;
  geom: Geom;
}

interface Preview {
  picks: Picked[];
  cursor: Point | null;
  hint: string;
}

const WANT_HINT: Record<Want, string> = {
  point: 'точку',
  linear: 'прямую, отрезок или луч',
  circle: 'окружность',
  curve: 'линию или окружность',
  object: 'фигуру или точку',
};

const matches = (want: Want, g: Geom) =>
  want === 'object' ||
  (want === 'point' && g.kind === 'point') ||
  (want === 'linear' && g.kind === 'linear') ||
  (want === 'circle' && g.kind === 'circle') ||
  (want === 'curve' && g.kind !== 'point');

/** Объекты планиметрии под курсором, подходящие для шага (сверху вниз). */
function hitsFor(want: Want, e: ToolPointerEvent, ctx: ToolContext): { o: BoardObject; g: Geom }[] {
  const out: { o: BoardObject; g: Geom }[] = [];
  for (const o of ctx.hitTest(e.world, ctx.screenToWorld(8))) {
    if (!o.type.startsWith(`${PLUGIN_ID}.`) || o.type === ANGLE_TYPE || o.type === TICKS_TYPE) continue;
    const g = evaluate(o, ctx.resolve).g;
    if (g && matches(want, g)) out.push({ o, g });
  }
  return out;
}

/** Выбор для шага: точка — существующая или новая; остальное — только существующий объект. */
function pickFor(want: Want, e: ToolPointerEvent, ctx: ToolContext): Picked | null {
  if (want === 'point') {
    const id = existingPoint(e, ctx);
    const at = id ? pointPos(id, ctx) : null;
    return id && at ? { id, at, geom: { kind: 'point', p: at } } : { id: null, at: e.snapped, geom: { kind: 'point', p: e.snapped } };
  }
  const h = hitsFor(want, e, ctx)[0];
  return h ? { id: h.o.id, at: e.world, geom: h.g } : null;
}

const opts = (ctx: ToolContext) => ctx.getToolOptions<ToolOptionsView & { rotateAngle?: number; homothetyK?: number; tickCount?: number }>();

/** Стиль новых фигур из панели инструмента. */
function figureStyle(ctx: ToolContext, fb: Picked[]): FigureProps {
  const o = opts(ctx);
  return { color: o.stroke, width: o.strokeWidth, dash: o.dash, label: '', fill: false, fb: fb.flatMap((p) => [p.at.x, p.at.y]) };
}

/** Создать новые точки среди выбранного (одна транзакция с построением); возвращает id всех опор. */
function materialize(ctx: ToolContext, picks: Picked[]): string[] | null {
  const labels = nextLabels(usedLabels(ctx), picks.filter((p) => !p.id).length);
  const ids: string[] = [];
  for (const p of picks) {
    if (p.id) {
      ids.push(p.id);
      continue;
    }
    const props: PointProps = { ...pointModule.createProps(), label: labels.shift() ?? '', color: opts(ctx).stroke, auto: true };
    const id = ctx.createObject<PointProps>(POINT_TYPE, { x: p.at.x, y: p.at.y, props });
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/** Подпись новой зависимой точки: привычная буква, если свободна, иначе следующая. */
function labelFor(ctx: ToolContext, preferred: string | null): string {
  const used = usedLabels(ctx);
  return preferred && !used.includes(preferred) ? preferred : (nextLabels(used, 1)[0] ?? '');
}

function createCPoint(ctx: ToolContext, kind: CPointKind, deps: string[], extra: Partial<CPointProps> = {}, label: string | null = null): string {
  const props: CPointProps = { label: labelFor(ctx, label), color: opts(ctx).stroke, size: 4, kind, ...extra };
  return ctx.createObject<CPointProps>(CPOINT_TYPE, { x: 0, y: 0, props, deps });
}

/** Описание пошагового инструмента. */
interface Spec {
  name: string;
  title: string;
  icon: string;
  section: string;
  keywords: string[];
  /** Шаги (могут зависеть от уже выбранного). */
  steps(picks: Picked[]): Want[];
  /**
   * Короткий путь по первому щелчку: например, щелчок по отрезку для
   * середины или по треугольнику для центра. Возвращает выбранное целиком.
   */
  shortcut?(e: ToolPointerEvent, ctx: ToolContext): Picked[] | null;
  /** Построить по выбранному (внутри транзакции); id для выделения. */
  build(ctx: ToolContext, picks: Picked[], e: ToolPointerEvent): string[];
  options?: InspectorField[];
  /** Источник берётся из выделения на момент выбора инструмента (преобразования). */
  fromSelection?: boolean;
}

/** Треугольник под курсором (многоугольник из трёх точек) — его вершины. */
function triangleShortcut(e: ToolPointerEvent, ctx: ToolContext): Picked[] | null {
  if (existingPoint(e, ctx)) return null;
  const tri = ctx.hitTest(e.world, ctx.screenToWorld(8)).find((o) => o.type === figureType('polygon') && o.deps.length === 3);
  if (!tri) return null;
  const picks = tri.deps.map((id) => {
    const at = pointPos(id, ctx);
    return at ? { id, at, geom: { kind: 'point' as const, p: at } } : null;
  });
  return picks.every(Boolean) ? (picks as Picked[]) : null;
}

/** Отрезок под курсором (не точка) — для середины, серединного перпендикуляра, штрихов. */
function segmentShortcut(e: ToolPointerEvent, ctx: ToolContext): Picked[] | null {
  if (existingPoint(e, ctx)) return null;
  const h = hitsFor('linear', e, ctx).find((x) => x.g.kind === 'linear' && (x.g.mode === 'segment' || x.g.mode === 'vector'));
  return h ? [{ id: h.o.id, at: e.world, geom: h.g }] : null;
}

const figure = (name: string, ctx: ToolContext, deps: string[], picks: Picked[], extra: Partial<FigureProps> = {}) =>
  ctx.createObject<FigureProps>(figureType(name), { x: 0, y: 0, props: { ...figureStyle(ctx, picks), ...extra }, deps });

const three = () => ['point', 'point', 'point'] as Want[];

/** Построение по трём точкам: фигура или зависимая точка. */
function triangleSpec(name: string, title: string, icon: string, keywords: string[], build: (ctx: ToolContext, deps: string[], picks: Picked[]) => string): Spec {
  return {
    name,
    title,
    icon,
    section: SECTION_CONSTRUCT,
    keywords,
    steps: three,
    shortcut: triangleShortcut,
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks);
      return deps ? [build(ctx, deps, picks)] : [];
    },
    options: STYLE_OPTIONS,
  };
}

// ---------------------------------------------------------------------
//  Построения
// ---------------------------------------------------------------------

const CONSTRUCTIONS: Spec[] = [
  {
    name: 'midpoint',
    title: 'Середина',
    icon: 'Dot',
    section: SECTION_CONSTRUCT,
    keywords: ['середина', 'середина отрезка', 'midpoint'],
    steps: () => ['point', 'point'],
    shortcut: segmentShortcut,
    build: (ctx, picks) => {
      const deps = picks[0]!.geom.kind === 'linear' ? [picks[0]!.id!] : materialize(ctx, picks);
      return deps ? [createCPoint(ctx, 'midpoint', deps, {}, 'M')] : [];
    },
  },
  {
    name: 'intersection',
    title: 'Точка пересечения',
    icon: 'X',
    section: SECTION_CONSTRUCT,
    keywords: ['пересечение', 'точка пересечения', 'intersection'],
    steps: () => ['curve', 'curve'],
    // Щелчок прямо в пересечение двух линий — сразу точка.
    shortcut: (e, ctx) => {
      const hits = hitsFor('curve', e, ctx);
      return hits.length >= 2 ? hits.slice(0, 2).map((h) => ({ id: h.o.id, at: e.world, geom: h.g })) : null;
    },
    build: (ctx, picks, e) => {
      const [a, b] = picks;
      if (!a?.id || !b?.id || a.id === b.id || a.geom.kind === 'point' || b.geom.kind === 'point') return [];
      const pts = intersections(a.geom, b.geom);
      if (!pts.length) return [];
      // Одним щелчком в пересечение — ближайшая точка; выбором двух линий — все точки.
      const shortcut = dist(a.at, b.at) < 1e-9;
      const idx = shortcut ? [pts.reduce((best, p, i) => (dist(p, e.world) < dist(pts[best]!, e.world) ? i : best), 0)] : pts.map((_, i) => i);
      return idx.map((index) => createCPoint(ctx, 'intersection', [a.id!, b.id!], { index }));
    },
  },
  {
    name: 'point-on',
    title: 'Точка на объекте',
    icon: 'CircleDot',
    section: SECTION_CONSTRUCT,
    keywords: ['точка на прямой', 'точка на окружности', 'скользящая точка', 'точка на объекте'],
    steps: () => ['curve'],
    build: (ctx, picks) => {
      const p = picks[0]!;
      if (!p.id || p.geom.kind === 'point') return [];
      return [createCPoint(ctx, 'on', [p.id], { t: paramOf(p.geom, p.at) })];
    },
  },
  {
    name: 'perpendicular',
    title: 'Перпендикуляр',
    icon: 'CornerDownRight',
    section: SECTION_CONSTRUCT,
    keywords: ['перпендикуляр', 'перпендикулярная прямая', 'perpendicular'],
    steps: () => ['point', 'linear'],
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks.slice(0, 1));
      return deps ? [figure('perpendicular', ctx, [deps[0]!, picks[1]!.id!], picks.slice(0, 1))] : [];
    },
    options: STYLE_OPTIONS,
  },
  {
    name: 'parallel',
    title: 'Параллельная прямая',
    icon: 'Equal',
    section: SECTION_CONSTRUCT,
    keywords: ['параллельная', 'параллель', 'parallel'],
    steps: () => ['point', 'linear'],
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks.slice(0, 1));
      return deps ? [figure('parallel', ctx, [deps[0]!, picks[1]!.id!], picks.slice(0, 1))] : [];
    },
    options: STYLE_OPTIONS,
  },
  {
    name: 'bisector',
    title: 'Биссектриса угла',
    icon: 'ChevronLeft',
    section: SECTION_CONSTRUCT,
    keywords: ['биссектриса', 'биссектриса угла', 'bisector'],
    steps: three,
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks);
      return deps ? [figure('bisector', ctx, deps, picks)] : [];
    },
    options: STYLE_OPTIONS,
  },
  {
    name: 'perp-bisector',
    title: 'Серединный перпендикуляр',
    icon: 'SplitSquareHorizontal',
    section: SECTION_CONSTRUCT,
    keywords: ['серединный перпендикуляр', 'срединный перпендикуляр'],
    steps: () => ['point', 'point'],
    shortcut: (e, ctx) => {
      // Щелчок по отрезку на двух точках — его концы.
      const s = segmentShortcut(e, ctx);
      const o = s?.[0]?.id ? ctx.resolve.getObject(s[0].id) : undefined;
      if (!o || o.type !== figureType('segment')) return null;
      const picks = o.deps.map((id) => {
        const at = pointPos(id, ctx);
        return at ? { id, at, geom: { kind: 'point' as const, p: at } } : null;
      });
      return picks.every(Boolean) ? (picks as Picked[]) : null;
    },
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks);
      return deps ? [figure('perp-bisector', ctx, deps, picks)] : [];
    },
    options: STYLE_OPTIONS,
  },
  {
    name: 'tangent',
    title: 'Касательные',
    icon: 'CircleArrowOutUpRight',
    section: SECTION_CONSTRUCT,
    keywords: ['касательная', 'касательные к окружности', 'tangent'],
    steps: () => ['point', 'circle'],
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks.slice(0, 1));
      const c = picks[1]!;
      if (!deps || c.geom.kind !== 'circle') return [];
      const d = dist(picks[0]!.at, c.geom.c);
      if (d < c.geom.r - 1e-6) return [];
      const count = d - c.geom.r < 1e-6 ? 1 : 2;
      return Array.from({ length: count }, (_, index) => figure('tangent', ctx, [deps[0]!, c.id!], picks.slice(0, 1), { index }));
    },
    options: STYLE_OPTIONS,
  },
  triangleSpec('median', 'Медиана', 'GitCommitVertical', ['медиана', 'медиана треугольника', 'вершина, затем концы противоположной стороны'], (ctx, deps, picks) =>
    figure('median', ctx, deps, picks),
  ),
  triangleSpec('altitude', 'Высота', 'ArrowDownToLine', ['высота', 'высота треугольника', 'вершина, затем концы противоположной стороны'], (ctx, deps, picks) =>
    figure('altitude', ctx, deps, picks),
  ),
  triangleSpec('centroid', 'Точка пересечения медиан', 'Crosshair', ['центроид', 'центр тяжести', 'медианы'], (ctx, deps) => createCPoint(ctx, 'centroid', deps, {}, 'M')),
  triangleSpec('orthocenter', 'Точка пересечения высот', 'Crosshair', ['ортоцентр', 'высоты'], (ctx, deps) => createCPoint(ctx, 'orthocenter', deps, {}, 'H')),
  triangleSpec('incenter', 'Центр вписанной окружности', 'Crosshair', ['инцентр', 'биссектрисы', 'центр вписанной'], (ctx, deps) => createCPoint(ctx, 'incenter', deps, {}, 'I')),
  triangleSpec('circumcenter', 'Центр описанной окружности', 'Crosshair', ['центр описанной', 'серединные перпендикуляры'], (ctx, deps) =>
    createCPoint(ctx, 'circumcenter', deps, {}, 'O'),
  ),
  triangleSpec('incircle', 'Вписанная окружность', 'CircleDashed', ['вписанная окружность', 'incircle'], (ctx, deps, picks) => figure('incircle', ctx, deps, picks)),
  triangleSpec('circumcircle', 'Описанная окружность', 'Circle', ['описанная окружность', 'circumcircle'], (ctx, deps, picks) => figure('circumcircle', ctx, deps, picks)),
];

// ---------------------------------------------------------------------
//  Преобразования
// ---------------------------------------------------------------------

/** Фигуры по точкам, у которых образ строится из образов вершин (с подписями A′, B′…). */
const BY_POINTS = new Set(FIGURES.filter((f) => f.points !== undefined).map((f) => figureType(f.name)));
/** Фигуры, у которых отражение меняет порядок опор (обход против часовой стрелки). */
const FLIP_ORDER: Record<string, (deps: string[]) => string[]> = {
  [figureType('regular-polygon')]: ([a, b]) => [b!, a!],
  [figureType('arc')]: ([c, a, b]) => [c!, b!, a!],
  [figureType('sector')]: ([c, a, b]) => [c!, b!, a!],
  [figureType('circle-segment')]: ([c, a, b]) => [c!, b!, a!],
};

const prime = (label: string) => (label ? `${label}′` : '');

function transformSpec(xf: XformKind, title: string, icon: string, param: Want, keywords: string[], options: InspectorField[] = []): Spec {
  const flips = xf === 'reflect-line';
  return {
    name: xf,
    title,
    icon,
    section: SECTION_TRANSFORM,
    keywords: [...keywords, 'преобразование', 'образ'],
    fromSelection: true,
    // Выделенное заранее занимает первый шаг (источник), щелчок — сразу параметр.
    steps: () => ['object', param],
    build: (ctx, picks) => {
      // Источники: выделенное до выбора инструмента или фигура первого щелчка.
      const sources = picks[0]!.id === '' ? ((picks[0] as Picked & { sources?: string[] }).sources ?? []) : [picks[0]!.id!];
      const paramPick = picks[picks.length - 1]!;
      const paramIds = materialize(ctx, [paramPick]);
      if (!paramIds) return [];
      const o = opts(ctx);
      const extra = { xf, ...(xf === 'rotate' ? { angle: Number(o.rotateAngle ?? 90) } : {}), ...(xf === 'homothety' ? { k: Number(o.homothetyK ?? 2) } : {}) };
      const images = new Map<string, string>();
      const imagePoint = (id: string): string => {
        const done = images.get(id);
        if (done) return done;
        const src = ctx.resolve.getObject(id);
        const label = src ? prime(String((src.props as PointProps).label ?? '')) : '';
        const img = createCPoint(ctx, 'image', [id, paramIds[0]!], extra, label || null);
        images.set(id, img);
        return img;
      };
      const out: string[] = [];
      for (const id of sources) {
        const src = ctx.resolve.getObject(id);
        if (!src || src.id === paramIds[0]) continue;
        if (isPointType(src.type)) out.push(imagePoint(id));
        else if (BY_POINTS.has(src.type) && src.deps.every((d) => isPointType(ctx.resolve.getObject(d)?.type ?? ''))) {
          const deps = src.deps.map(imagePoint);
          const props = { ...(src.props as FigureProps), label: prime(String((src.props as FigureProps).label ?? '')), fb: [] };
          out.push(ctx.createObject<FigureProps>(src.type, { x: 0, y: 0, props, deps: flips && FLIP_ORDER[src.type] ? FLIP_ORDER[src.type]!(deps) : deps }));
        } else if (src.type.startsWith(`${PLUGIN_ID}.`) && src.type !== ANGLE_TYPE && src.type !== TICKS_TYPE) {
          const props = { ...(src.props as FigureProps), ...extra, label: prime(String((src.props as FigureProps).label ?? '')), fb: [] };
          out.push(ctx.createObject<FigureProps>(figureType('image'), { x: 0, y: 0, props, deps: [id, paramIds[0]!] }));
        }
      }
      return out.filter(Boolean);
    },
    options,
  };
}

const TRANSFORMS: Spec[] = [
  transformSpec('reflect-line', 'Осевая симметрия', 'FlipHorizontal2', 'linear', ['осевая симметрия', 'отражение относительно прямой', 'симметрия']),
  transformSpec('reflect-point', 'Центральная симметрия', 'Asterisk', 'point', ['центральная симметрия', 'симметрия относительно точки']),
  transformSpec('rotate', 'Поворот', 'RotateCcw', 'point', ['поворот', 'вращение'], [{ kind: 'number', key: 'rotateAngle', label: 'Угол, °', min: -360, max: 360, step: 1 }]),
  transformSpec('translate', 'Параллельный перенос', 'MoveRight', 'linear', ['параллельный перенос', 'сдвиг на вектор', 'перенос']),
  transformSpec('homothety', 'Гомотетия', 'Scaling', 'point', ['гомотетия', 'подобие', 'растяжение'], [{ kind: 'number', key: 'homothetyK', label: 'Коэффициент', min: -10, max: 10, step: 0.5 }]),
];

// ---------------------------------------------------------------------
//  Отметки и измерения
// ---------------------------------------------------------------------

const MARKS: Spec[] = [
  {
    name: 'angle-mark',
    title: 'Отметка угла',
    icon: 'Radius',
    section: SECTION_MARKS,
    keywords: ['угол', 'отметка угла', 'градусы', 'измерить угол', 'прямой угол', 'точка, вершина, точка'],
    steps: three,
    build: (ctx, picks) => {
      const deps = materialize(ctx, picks);
      if (!deps) return [];
      const props: AngleProps = { color: opts(ctx).stroke, arcs: 1, label: '', showValue: true, reflex: false, fb: picks.flatMap((p) => [p.at.x, p.at.y]) };
      return [ctx.createObject<AngleProps>(ANGLE_TYPE, { x: 0, y: 0, props, deps })];
    },
    options: [{ kind: 'color', key: 'stroke', label: 'Цвет' }],
  },
  {
    name: 'equal-ticks',
    title: 'Равные отрезки',
    icon: 'Hash',
    section: SECTION_MARKS,
    keywords: ['равные отрезки', 'штрихи', 'отметка равенства', 'равенство'],
    steps: () => ['point', 'point'],
    shortcut: segmentShortcut,
    build: (ctx, picks) => {
      const deps = picks[0]!.geom.kind === 'linear' ? [picks[0]!.id!] : materialize(ctx, picks);
      if (!deps) return [];
      const props: TicksProps = { color: opts(ctx).stroke, count: Math.min(3, Math.max(1, Math.round(Number(opts(ctx).tickCount ?? 1)))), fb: [] };
      return [ctx.createObject<TicksProps>(TICKS_TYPE, { x: 0, y: 0, props, deps })];
    },
    options: [
      { kind: 'color', key: 'stroke', label: 'Цвет' },
      { kind: 'number', key: 'tickCount', label: 'Штрихов', min: 1, max: 3, step: 1 },
    ],
  },
];

/** «Размер»: щелчок по фигуре показывает или прячет её длину, радиус, площадь; по отметке угла — градусы. */
export const measureTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.measure`,
  title: 'Размер',
  icon: 'Ruler',
  group: 'math',
  section: SECTION_MARKS,
  keywords: ['измерить', 'длина', 'площадь', 'радиус', 'размер', 'measure'],
  requiresWrite: true,
  cursor: 'pointer',
  onPointerUp(e, ctx) {
    const o = ctx.hitTest(e.world, ctx.screenToWorld(8)).find((x) => x.type.startsWith(`${PLUGIN_ID}.`) && !isPointType(x.type) && x.type !== TICKS_TYPE);
    if (!o || !ctx.canModify(o.id)) return;
    if (o.type === ANGLE_TYPE) ctx.updateObject<AngleProps>(o.id, { props: { showValue: !(o.props as AngleProps).showValue } });
    else ctx.updateObject<FigureProps>(o.id, { props: { measure: !(o.props as FigureProps).measure } });
    ctx.setSelection([o.id]);
  },
};

// ---------------------------------------------------------------------
//  Пошаговый инструмент
// ---------------------------------------------------------------------

function stepTool(spec: Spec): ToolModule<ReactNode> {
  /** Источники из выделения на момент выбора инструмента (для преобразований). */
  let selected: string[] = [];
  const picksOf = (ctx: ToolContext) => ctx.getPreview<Preview>()?.picks ?? [];
  const hintFor = (picks: Picked[]) => {
    const steps = spec.steps(picks);
    const want = steps[picks.length];
    return want ? `${spec.title}: выберите ${WANT_HINT[want]}` : '';
  };
  const show = (ctx: ToolContext, picks: Picked[], cursor: Point | null) => ctx.setPreview({ picks, cursor, hint: hintFor(picks) } satisfies Preview);
  const initial = (): Picked[] =>
    // Выделенное заранее — первый «выбор» (пустой id, источники отдельно).
    spec.fromSelection && selected.length ? [Object.assign({ id: '', at: { x: 0, y: 0 }, geom: { kind: 'point' as const, p: { x: 0, y: 0 } } }, { sources: selected })] : [];
  const finish = (ctx: ToolContext, picks: Picked[], e: ToolPointerEvent) => {
    let ids: string[] = [];
    ctx.transact(() => {
      ids = spec.build(ctx, picks, e).filter(Boolean);
    });
    selected = [];
    show(ctx, initial(), e.snapped);
    if (ids.length) ctx.setSelection(ids);
  };
  return {
    id: `${PLUGIN_ID}.${spec.name}`,
    title: spec.title,
    icon: spec.icon,
    group: 'math',
    section: spec.section,
    keywords: [...spec.keywords, 'планиметрия', 'геометрия', 'построение'],
    requiresWrite: true,
    snapping: true,
    cursor: 'crosshair',
    options: spec.options,
    onActivate(ctx) {
      selected = spec.fromSelection
        ? ctx.getSelection().filter((id) => ctx.resolve.getObject(id)?.type.startsWith(`${PLUGIN_ID}.`))
        : [];
      show(ctx, initial(), null);
    },
    onPointerDown(e, ctx) {
      let picks = picksOf(ctx);
      if (!picks.length || (picks.length === 1 && picks[0]!.id === '')) {
        const all = picks.length === 0 ? spec.shortcut?.(e, ctx) : null;
        if (all) {
          finish(ctx, all, e);
          return;
        }
      }
      const want = spec.steps(picks)[picks.length];
      if (!want) return;
      const p = pickFor(want, e, ctx);
      if (!p) return;
      // Одна и та же точка дважды подряд — не новый выбор.
      const last = picks[picks.length - 1];
      if (last && p.id && last.id === p.id) return;
      picks = [...picks, p];
      if (picks.length >= spec.steps(picks).length) finish(ctx, picks, e);
      else show(ctx, picks, e.snapped);
    },
    onPointerMove(e, ctx) {
      show(ctx, picksOf(ctx), e.snapped);
    },
    onKeyDown(key, _m, ctx) {
      if (key === 'Escape' && picksOf(ctx).length > initial().length) {
        show(ctx, initial(), null);
        return true;
      }
      return false;
    },
    onDeactivate(ctx) {
      selected = [];
      ctx.setPreview(null);
    },
    renderOverlay(ctx) {
      const p = ctx.getPreview<Preview>();
      if (!p) return null;
      const w = ctx.screenToWorld(1);
      return (
        <Group listening={false}>
          {p.picks
            .filter((q) => q.id !== '')
            .map((q, i) => (
              <Circle key={i} x={q.geom.kind === 'point' ? q.geom.p.x : q.at.x} y={q.geom.kind === 'point' ? q.geom.p.y : q.at.y} radius={5 * w} stroke="#2a7de1" strokeWidth={2} strokeScaleEnabled={false} listening={false} />
            ))}
          {p.cursor && p.hint && <Text x={p.cursor.x + 14 * w} y={p.cursor.y + 14 * w} text={p.hint} fontSize={13 * w} fill="#2a7de1" listening={false} />}
        </Group>
      );
    },
  };
}

export const constructionTools = [...CONSTRUCTIONS.map(stepTool)];
export const transformTools = TRANSFORMS.map(stepTool);
export const markTools = [...MARKS.map(stepTool), measureTool];
