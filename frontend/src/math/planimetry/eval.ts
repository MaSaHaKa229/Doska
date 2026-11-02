import type { BoardObject, ResolveContext } from '@doska/shared';
import type { Geom } from './geometry';

export const PLUGIN_ID = 'math.planimetry';
/** Свободная точка: положение — x, y объекта. */
export const POINT_TYPE = `${PLUGIN_ID}.point`;
/** Зависимая точка: середина, пересечение, точка на объекте, центр, образ. */
export const CPOINT_TYPE = `${PLUGIN_ID}.cpoint`;

/** Вычисление геометрии объекта по геометрии его опор (deps по порядку). */
export type Evaluator = (o: BoardObject, inputs: Geom[]) => Geom | null;

const evaluators = new Map<string, Evaluator>();

export function registerEvaluator(type: string, fn: Evaluator): void {
  evaluators.set(type, fn);
}

/** Последняя вычисленная геометрия — чем нарисовать построение, если опору удалили. */
const lastKnown = new Map<string, Geom>();

const MAX_DEPTH = 64;

export interface Evaluated {
  /** null — не определено (параллельные прямые не пересекаются) или нет данных. */
  g: Geom | null;
  /** Какая-то опора (возможно, через цепочку) удалена — рисуется «нет опоры». */
  missing: boolean;
}

/**
 * Геометрия объекта планиметрии. Опоры вычисляются рекурсивно (точка
 * пересечения двух перпендикуляров к сторонам треугольника и т. п.);
 * глубина ограничена на случай испорченного документа с циклом.
 */
export function evaluate(o: BoardObject, ctx: ResolveContext, depth = 0): Evaluated {
  if (o.type === POINT_TYPE) return { g: { kind: 'point', p: { x: o.x, y: o.y } }, missing: false };
  const ev = evaluators.get(o.type);
  if (!ev || depth > MAX_DEPTH) return { g: null, missing: false };
  const fb = ((o.props as { fb?: unknown }).fb as number[] | undefined) ?? [];
  const inputs: Geom[] = [];
  let missing = false;
  let unavailable = false;
  o.deps.forEach((id, i) => {
    if (unavailable) return;
    const d = ctx.getObject(id);
    if (!d) {
      missing = true;
      if (fb.length > i * 2 + 1) inputs.push({ kind: 'point', p: { x: fb[i * 2]!, y: fb[i * 2 + 1]! } });
      else unavailable = true;
      return;
    }
    const r = evaluate(d, ctx, depth + 1);
    if (r.missing) missing = true;
    if (!r.g) unavailable = true;
    else inputs.push(r.g);
  });
  if (unavailable) return { g: missing ? (lastKnown.get(o.id) ?? null) : null, missing };
  let g: Geom | null = null;
  try {
    g = ev(o, inputs);
  } catch {
    g = null;
  }
  if (g && !missing) lastKnown.set(o.id, g);
  return { g: g ?? (missing ? (lastKnown.get(o.id) ?? null) : null), missing };
}

/** Геометрия по id (null — нет объекта или не определена). */
export function geomOfId(id: string, ctx: ResolveContext): Geom | null {
  const o = ctx.getObject(id);
  return o ? evaluate(o, ctx).g : null;
}

/** Объект — точка (свободная или зависимая). */
export const isPointType = (type: string) => type === POINT_TYPE || type === CPOINT_TYPE;
