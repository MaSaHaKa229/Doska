import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext, ResolveContext } from '@doska/shared';
import { useBoard } from '../../store/board';
import { SURFACE_COLORS } from '../../objects/colors';
import { toLocal } from '../../objects/util';
import { fmtNum } from '../analysis/expr';
import { AXES_TYPE, frameOf, type Frame } from '../analysis/plot';
import { Q, parseQ } from './rational';
import { add, colsOf, det, eigen2, gaussSteps, inverse, mul, parseMatrix, rank, scale, solveText, toStrings, transpose, SizeError, type M } from './linalg';

export const PLUGIN_ID = 'math.linalg';
export const MATRIX_TYPE = `${PLUGIN_ID}.matrix`;
export const OP_TYPE = `${PLUGIN_ID}.op`;
export const GAUSS_TYPE = `${PLUGIN_ID}.gauss`;
export const TRANSFORM_TYPE = `${PLUGIN_ID}.transform`;
export const MATRIX_EDITOR = 'linalg.matrix';

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const color = z.string().max(32);
const FONT = 18;

// =====================================================================
//  Отрисовка матрицы
// =====================================================================

export type Bracket = 'round' | 'square' | 'det';

export interface MatrixLayout {
  colW: number[];
  rowH: number;
  w: number;
  h: number;
}

const PAD = 12;

export function layout(cells: string[][]): MatrixLayout {
  const cols = cells[0]?.length ?? 0;
  const colW = Array.from({ length: cols }, (_, j) => Math.max(...cells.map((r) => (r[j] ?? '').length)) * FONT * 0.58 + 22);
  const rowH = FONT * 1.7;
  return { colW, rowH, w: colW.reduce((s, v) => s + v, 0) + PAD * 2, h: rowH * cells.length + 8 };
}

/** Матрица в точке (0, 0) локально: скобки, ячейки, черта расширенной матрицы. */
function MatrixBody({ cells, stroke, bracket, augAt, bad }: { cells: string[][]; stroke: string; bracket: Bracket; augAt?: number; bad?: (i: number, j: number) => boolean }) {
  const L = layout(cells);
  const els: ReactNode[] = [];
  let x = PAD;
  L.colW.forEach((w, j) => {
    cells.forEach((row, i) => {
      els.push(
        <Text key={`${i}:${j}`} x={x} y={4 + i * L.rowH + (L.rowH - FONT) / 2} width={w} align="center" text={row[j] ?? ''} fontSize={FONT} fill={bad?.(i, j) ? '#d13a3a' : stroke} listening={false} />,
      );
    });
    x += w;
    if (augAt !== undefined && j === augAt - 1) els.push(<Line key="aug" points={[x, 6, x, L.h - 6]} stroke={stroke} strokeWidth={1.2} dash={[4, 3]} strokeScaleEnabled={false} listening={false} />);
  });
  const h = L.h;
  const br = (side: 1 | -1) => {
    const x0 = side < 0 ? 4 : L.w - 4;
    const k = side < 0 ? 1 : -1;
    if (bracket === 'det') return <Line key={side} points={[x0, 2, x0, h - 2]} stroke={stroke} strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />;
    if (bracket === 'square') return <Line key={side} points={[x0 + 6 * k, 2, x0, 2, x0, h - 2, x0 + 6 * k, h - 2]} stroke={stroke} strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />;
    return (
      <Shape
        key={side}
        sceneFunc={(c, shape) => {
          const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
          g.beginPath();
          g.moveTo(x0 + 6 * k, 2);
          g.quadraticCurveTo(x0 - 4 * k, h / 2, x0 + 6 * k, h - 2);
          c.strokeShape(shape);
        }}
        stroke={stroke}
        strokeWidth={1.6}
        strokeScaleEnabled={false}
        listening={false}
      />
    );
  };
  return (
    <Group>
      {els}
      {br(-1)}
      {br(1)}
    </Group>
  );
}

const textW = (t: string, size = FONT) => t.length * size * 0.5 + 8;

// =====================================================================
//  Матрица
// =====================================================================

export const matrixPropsSchema = z
  .object({
    name: z.string().max(12),
    rows: z.number().int().min(1).max(8),
    cols: z.number().int().min(1).max(9),
    /** Ячейки по строкам: «3», «−2/3», «1,5». */
    cells: z.array(z.string().max(24)).max(72),
    /** Расширенная матрица системы: последний столбец — свободные члены. */
    augmented: z.boolean(),
    color,
  })
  .refine((p) => p.cells.length === p.rows * p.cols, 'Число ячеек не совпадает с размером');
export type MatrixProps = z.infer<typeof matrixPropsSchema>;

const cellsGrid = (p: MatrixProps): string[][] =>
  Array.from({ length: p.rows }, (_, i) => Array.from({ length: p.cols }, (_, j) => {
    const v = parseQ(p.cells[i * p.cols + j] ?? '');
    return v ? v.toString() : (p.cells[i * p.cols + j] ?? '').trim() || '?';
  }));

const prefixOf = (name: string) => (name ? `${name} = ` : '');

function matrixSize(p: MatrixProps): { w: number; h: number; prefix: number } {
  const L = layout(cellsGrid(p));
  const prefix = p.name ? textW(prefixOf(p.name)) : 0;
  return { w: prefix + L.w, h: L.h, prefix };
}

export const matrixModule: ObjectModule<MatrixProps, ReactNode> = {
  type: MATRIX_TYPE,
  title: 'Матрица',
  version: 1,
  propsSchema: matrixPropsSchema as unknown as z.ZodType<MatrixProps>,
  createProps: () => ({ name: 'A', rows: 2, cols: 2, cells: ['1', '2', '3', '4'], augmented: false, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<MatrixProps>,
  getLocalBounds: (o) => {
    const s = matrixSize(o.props);
    return { x: 0, y: 0, width: s.w, height: s.h };
  },
  hitTest: (o, point, tol) => {
    const p = toLocal(o, point);
    const s = matrixSize(o.props);
    return p.x >= -tol && p.y >= -tol && p.x <= s.w + tol && p.y <= s.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const s = matrixSize(o.props);
    const grid = cellsGrid(o.props);
    return (
      <Group>
        {o.props.name && <Text x={0} y={s.h / 2 - FONT / 2} text={prefixOf(o.props.name)} fontSize={FONT} fontStyle="italic" fill={c} listening={false} />}
        <Group x={s.prefix}>
          <MatrixBody cells={grid} stroke={c} bracket="round" augAt={o.props.augmented ? o.props.cols - 1 : undefined} bad={(i, j) => !parseQ(o.props.cells[i * o.props.cols + j] ?? '')} />
        </Group>
      </Group>
    );
  },
  toSVG: (o, ctx) => {
    const c = ctx.resolveColor(o.props.color);
    const L = layout(cellsGrid(o.props));
    const s = matrixSize(o.props);
    let x = o.x + s.prefix + PAD;
    const texts: string[] = [];
    L.colW.forEach((w, j) => {
      cellsGrid(o.props).forEach((row, i) => texts.push(`<text x="${x + w / 2}" y="${o.y + 4 + i * L.rowH + L.rowH / 2 + 6}" text-anchor="middle" font-size="${FONT}" fill="${c}">${row[j]}</text>`));
      x += w;
    });
    return `<g>${o.props.name ? `<text x="${o.x}" y="${o.y + s.h / 2 + 6}" font-size="${FONT}" font-style="italic" fill="${c}">${prefixOf(o.props.name)}</text>` : ''}${texts.join('')}</g>`;
  },
  inspector: [
    { kind: 'text', key: 'name', label: 'Имя', maxLength: 12 },
    { kind: 'toggle', key: 'augmented', label: 'Расширенная (система)' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  editor: MATRIX_EDITOR,
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Значение матрицы или результата операции (рекурсивно)
// =====================================================================

export const OPS = ['add', 'sub', 'mul', 'scale', 'transpose', 'det', 'inverse', 'rank'] as const;
export type Op = (typeof OPS)[number];

export const opPropsSchema = z.object({ op: z.enum(OPS), k: z.string().max(24), color });
export type OpProps = z.infer<typeof opPropsSchema>;

export type Value = { m: M; name: string } | { q: Q; name: string } | { n: number; name: string } | { error: string; name: string };

/** Имя операнда для подписи: имя матрицы или «(…)» результата. */
function nameOf(o: BoardObject | undefined, ctx: ResolveContext, depth: number): string {
  if (!o) return '?';
  if (o.type === MATRIX_TYPE) return (o.props as unknown as MatrixProps).name || 'M';
  if (o.type === OP_TYPE) return `(${valueOf(o, ctx, depth + 1).name})`;
  return '?';
}

export function valueOf(o: BoardObject, ctx: ResolveContext, depth = 0): Value {
  if (depth > 20) return { error: 'Слишком длинная цепочка', name: '?' };
  if (o.type === MATRIX_TYPE) {
    const p = o.props as unknown as MatrixProps;
    const m = parseMatrix(p.cells, p.rows, p.cols);
    return 'error' in m ? { error: m.error, name: p.name } : { m, name: p.name || 'M' };
  }
  if (o.type !== OP_TYPE) return { error: 'Не матрица', name: '?' };
  const p = o.props as unknown as OpProps;
  const A = ctx.getObject(o.deps[0] ?? '');
  const B = ctx.getObject(o.deps[1] ?? '');
  const an = nameOf(A, ctx, depth);
  const bn = nameOf(B, ctx, depth);
  const k = parseQ(p.k) ?? Q.ONE;
  const name = {
    add: `${an} + ${bn}`,
    sub: `${an} − ${bn}`,
    mul: `${an}·${bn}`,
    scale: `${k.toString()}·${an}`,
    transpose: `${an}ᵀ`,
    det: `det ${an}`,
    inverse: `${an}⁻¹`,
    rank: `rang ${an}`,
  }[p.op];
  const va = A ? valueOf(A, ctx, depth + 1) : null;
  const vb = B ? valueOf(B, ctx, depth + 1) : null;
  if (!va) return { error: 'нет матрицы', name };
  if ('error' in va) return { error: va.error, name };
  if (!('m' in va)) return { error: `${an} — не матрица`, name };
  try {
    switch (p.op) {
      case 'add':
      case 'sub':
      case 'mul': {
        if (!vb) return { error: 'нет второй матрицы', name };
        if ('error' in vb) return { error: vb.error, name };
        if (!('m' in vb)) return { error: `${bn} — не матрица`, name };
        return { m: p.op === 'mul' ? mul(va.m, vb.m) : add(va.m, vb.m, p.op === 'add' ? 1 : -1), name };
      }
      case 'scale':
        return { m: scale(va.m, k), name };
      case 'transpose':
        return { m: transpose(va.m), name };
      case 'det':
        return { q: det(va.m), name };
      case 'inverse':
        return { m: inverse(va.m), name };
      case 'rank':
        return { n: rank(va.m), name };
    }
  } catch (e) {
    return { error: e instanceof SizeError || e instanceof Error ? e.message : 'Ошибка', name };
  }
}

function opSize(v: Value): { w: number; h: number; prefix: number } {
  const prefix = textW(`${v.name} = `);
  if ('m' in v) {
    const L = layout(toStrings(v.m));
    return { w: prefix + L.w, h: L.h, prefix };
  }
  const t = 'error' in v ? v.error : 'q' in v ? v.q.toString() : String(v.n);
  return { w: prefix + textW(t), h: FONT * 1.8, prefix };
}

export const opModule: ObjectModule<OpProps, ReactNode> = {
  type: OP_TYPE,
  title: 'Действие с матрицами',
  version: 1,
  propsSchema: opPropsSchema,
  createProps: () => ({ op: 'mul', k: '2', color: 'accent-5' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<OpProps>,
  getLocalBounds: (o, ctx) => {
    const s = opSize(valueOf(o, ctx));
    return { x: 0, y: 0, width: s.w, height: s.h };
  },
  hitTest: (o, point, tol, ctx) => {
    const p = toLocal(o, point);
    const s = opSize(valueOf(o, ctx));
    return p.x >= -tol && p.y >= -tol && p.x <= s.w + tol && p.y <= s.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => {
    const v = valueOf(o, ctx);
    const s = opSize(v);
    const c = ctx.resolveColor(o.props.color);
    const label = <Text x={0} y={s.h / 2 - FONT / 2} text={`${v.name} = `} fontSize={FONT} fontStyle="italic" fill={c} listening={false} />;
    if ('m' in v)
      return (
        <Group>
          {label}
          <Group x={s.prefix}>
            <MatrixBody cells={toStrings(v.m)} stroke={c} bracket="round" />
          </Group>
        </Group>
      );
    const t = 'error' in v ? v.error : 'q' in v ? v.q.toString() : String(v.n);
    return (
      <Group>
        {label}
        <Text x={s.prefix} y={s.h / 2 - FONT / 2} text={t} fontSize={FONT} fill={'error' in v ? '#d13a3a' : c} listening={false} />
      </Group>
    );
  },
  inspector: [
    { kind: 'text', key: 'k', label: 'Число k', maxLength: 24 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Метод Гаусса по шагам
// =====================================================================

export const gaussPropsSchema = z.object({
  /** До приведённого вида (Гаусс — Жордан). */
  jordan: z.boolean(),
  /** Ширина строки шагов (мировые единицы) — дальше перенос. */
  width: z.number().finite().min(300).max(4000),
  color,
});
export type GaussProps = z.infer<typeof gaussPropsSchema>;

interface GaussLayout {
  items: { x: number; y: number; cells: string[][]; ops: string[] }[];
  answer: string | null;
  augAt: number | undefined;
  w: number;
  h: number;
  error?: string;
}

const ARROW_W = 150;

export function gaussLayout(o: BoardObject<GaussProps>, ctx: ResolveContext): GaussLayout {
  const src = ctx.getObject(o.deps[0] ?? '');
  const v = src ? valueOf(src, ctx) : null;
  if (!v || !('m' in v)) return { items: [], answer: null, augAt: undefined, w: 260, h: 30, error: v && 'error' in v ? v.error : 'нет матрицы' };
  const augmented = src?.type === MATRIX_TYPE && (src.props as unknown as MatrixProps).augmented && colsOf(v.m) > 1;
  const cols = augmented ? colsOf(v.m) - 1 : colsOf(v.m);
  const { steps } = gaussSteps(v.m, o.props.jordan, cols);
  const items: GaussLayout['items'] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  steps.forEach((s, i) => {
    const cells = toStrings(s.m);
    const L = layout(cells);
    const opsW = i === 0 ? 0 : Math.max(ARROW_W, ...s.ops.map((t) => textW(t, 13)));
    if (x > 0 && x + opsW + L.w > o.props.width) {
      x = 0;
      y += rowH + 30;
      rowH = 0;
    }
    items.push({ x: x + opsW, y, cells, ops: s.ops });
    x += opsW + L.w;
    w = Math.max(w, x);
    rowH = Math.max(rowH, L.h, s.ops.length * 16 + 10);
  });
  const answer = augmented ? solveText(v.m) : `Ранг: ${rank(v.m)}`;
  return { items, answer, augAt: augmented ? cols : undefined, w: Math.max(w, textW(answer, 15)), h: y + rowH + 34 };
}

function GaussView({ o, ctx }: { o: BoardObject<GaussProps>; ctx: RenderContext }) {
  const g = gaussLayout(o, ctx);
  const c = ctx.resolveColor(o.props.color);
  if (g.error) return <Text text={`Метод Гаусса: ${g.error}`} fontSize={15} fill="#d13a3a" listening={false} />;
  return (
    <Group>
      {g.items.map((it, i) => {
        const L = layout(it.cells);
        return (
          <Group key={i}>
            {i > 0 && (
              <Group x={it.x - Math.max(ARROW_W, ...it.ops.map((t) => textW(t, 13)))} y={it.y}>
                {it.ops.map((t, k) => (
                  <Text key={k} x={6} y={L.h / 2 - 8 - (it.ops.length - k) * 15} text={t} fontSize={13} fill={c} listening={false} />
                ))}
                <Arrow points={[6, L.h / 2, Math.max(ARROW_W, ...it.ops.map((t) => textW(t, 13))) - 8, L.h / 2]} stroke={c} fill={c} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={8} pointerWidth={6} listening={false} />
              </Group>
            )}
            <Group x={it.x} y={it.y}>
              <MatrixBody cells={it.cells} stroke={c} bracket="round" augAt={g.augAt} />
            </Group>
          </Group>
        );
      })}
      {g.answer && <Text x={0} y={g.h - 22} text={g.answer} fontSize={15} fontStyle="bold" fill={c} listening={false} />}
    </Group>
  );
}

export const gaussModule: ObjectModule<GaussProps, ReactNode> = {
  type: GAUSS_TYPE,
  title: 'Метод Гаусса',
  version: 1,
  propsSchema: gaussPropsSchema,
  createProps: () => ({ jordan: true, width: 1100, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<GaussProps>,
  getLocalBounds: (o, ctx) => {
    const g = gaussLayout(o, ctx);
    return { x: 0, y: 0, width: g.w, height: g.h };
  },
  hitTest: (o, point, tol, ctx) => {
    const p = toLocal(o, point);
    const g = gaussLayout(o, ctx);
    return p.x >= -tol && p.y >= -tol && p.x <= g.w + tol && p.y <= g.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <GaussView o={o} ctx={ctx} />,
  inspector: [
    { kind: 'toggle', key: 'jordan', label: 'До приведённого вида (Жордан)' },
    { kind: 'number', key: 'width', label: 'Ширина строки', min: 300, max: 4000, step: 50 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Линейное преобразование плоскости
// =====================================================================

export const transformPropsSchema = z.object({
  a: z.number().finite().min(-20).max(20),
  b: z.number().finite().min(-20).max(20),
  c: z.number().finite().min(-20).max(20),
  d: z.number().finite().min(-20).max(20),
  showGrid: z.boolean(),
  showSquare: z.boolean(),
  showEigen: z.boolean(),
  color,
});
export type TransformProps = z.infer<typeof transformPropsSchema>;

const frameFor = (o: BoardObject, ctx: ResolveContext): Frame | null => {
  const a = ctx.getObject(o.deps[0] ?? '');
  return a?.type === AXES_TYPE ? frameOf(a) : null;
};

/** Образ точки: (x, y) → (ax + by, cx + dy). */
export const apply = (p: TransformProps, x: number, y: number) => ({ x: p.a * x + p.b * y, y: p.c * x + p.d * y });

function TransformView({ o, ctx }: { o: BoardObject<TransformProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const fr = frameFor(o, ctx);
  if (!fr) return null;
  const p = o.props;
  const col = ctx.resolveColor(p.color);
  const W = (x: number, y: number) => fr.toWorld(x, y);
  const els: ReactNode[] = [];
  const R = Math.ceil(Math.max(Math.abs(fr.xMin), Math.abs(fr.xMax), Math.abs(fr.yMin), Math.abs(fr.yMax)) * 2);
  if (p.showGrid) {
    const pts: number[] = [];
    for (let k = -R; k <= R; k++) {
      for (const [s, e] of [
        [apply(p, k, -R), apply(p, k, R)],
        [apply(p, -R, k), apply(p, R, k)],
      ] as const) {
        const a = W(s.x, s.y);
        const b = W(e.x, e.y);
        pts.push(a.x, a.y, b.x, b.y);
      }
    }
    els.push(
      <Shape
        key="grid"
        sceneFunc={(c, shape) => {
          const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
          g.beginPath();
          for (let i = 0; i < pts.length; i += 4) {
            g.moveTo(pts[i]!, pts[i + 1]!);
            g.lineTo(pts[i + 2]!, pts[i + 3]!);
          }
          c.strokeShape(shape);
        }}
        stroke={col}
        opacity={0.35}
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />,
    );
  }
  if (p.showSquare) {
    const sq = [W(0, 0), W(1, 0), W(1, 1), W(0, 1)];
    const img = [apply(p, 0, 0), apply(p, 1, 0), apply(p, 1, 1), apply(p, 0, 1)].map((q) => W(q.x, q.y));
    els.push(<Line key="sq" points={sq.flatMap((q) => [q.x, q.y])} closed stroke={ctx.resolveColor('muted')} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />);
    els.push(<Line key="img" points={img.flatMap((q) => [q.x, q.y])} closed fill={col} opacity={0.22} stroke={col} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />);
  }
  const O = W(0, 0);
  const i1 = W(p.a, p.c);
  const j1 = W(p.b, p.d);
  els.push(<Arrow key="i" points={[O.x, O.y, i1.x, i1.y]} stroke="#d13a3a" fill="#d13a3a" strokeWidth={2.5} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />);
  els.push(<Arrow key="j" points={[O.x, O.y, j1.x, j1.y]} stroke="#1a9b55" fill="#1a9b55" strokeWidth={2.5} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} />);
  els.push(<Text key="it" x={i1.x + 4} y={i1.y + 2} text={`A·i(${fmtNum(p.a, 3)}; ${fmtNum(p.c, 3)})`} fontSize={13} fill="#d13a3a" listening={false} />);
  els.push(<Text key="jt" x={j1.x + 4} y={j1.y - 16} text={`A·j(${fmtNum(p.b, 3)}; ${fmtNum(p.d, 3)})`} fontSize={13} fill="#1a9b55" listening={false} />);
  if (p.showEigen) {
    eigen2(p.a, p.b, p.c, p.d).forEach((e, k) => {
      const a = W(-e.vector[0] * R, -e.vector[1] * R);
      const b = W(e.vector[0] * R, e.vector[1] * R);
      els.push(<Line key={`e${k}`} points={[a.x, a.y, b.x, b.y]} stroke="#8a4fd8" strokeWidth={1.5} dash={[8 / zoom, 5 / zoom]} strokeScaleEnabled={false} listening={false} />);
      const t = W(e.vector[0] * 1.6, e.vector[1] * 1.6 + 0.3 * (k ? -1 : 1));
      els.push(<Text key={`et${k}`} x={t.x + 4} y={t.y} text={`λ${k ? '₂' : '₁'} = ${fmtNum(e.value, 3)}`} fontSize={13} fill="#8a4fd8" listening={false} />);
    });
  }
  const dt = p.a * p.d - p.b * p.c;
  const r = fr.rect;
  const info = `A = (${fmtNum(p.a, 3)} ${fmtNum(p.b, 3)}; ${fmtNum(p.c, 3)} ${fmtNum(p.d, 3)}),  det A = ${fmtNum(dt, 4)}${p.showSquare ? ` — площадь образа квадрата ${fmtNum(Math.abs(dt), 4)}${dt < 0 ? ', ориентация меняется' : ''}` : ''}`;
  return (
    <Group clipX={r.x} clipY={r.y} clipWidth={r.width} clipHeight={r.height}>
      {els}
      <KRect x={r.x + 4} y={r.y + 4} width={info.length * 7.2 + 10} height={20} fill={SURFACE_COLORS[ctx.theme].paper} opacity={0.85} cornerRadius={4} listening={false} />
      <Text x={r.x + 9} y={r.y + 7} text={info} fontSize={13} fill={col} listening={false} />
      <Circle x={O.x} y={O.y} radius={3 / zoom} fill={col} listening={false} />
    </Group>
  );
}

const NONE: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const transformModule: ObjectModule<TransformProps, ReactNode> = {
  type: TRANSFORM_TYPE,
  title: 'Линейное преобразование',
  version: 1,
  propsSchema: transformPropsSchema,
  createProps: () => ({ a: 1, b: 1, c: 0, d: 1, showGrid: true, showSquare: true, showEigen: true, color: 'accent-2' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as BoardObject<TransformProps>,
  getLocalBounds: (o, ctx) => frameFor(o, ctx)?.rect ?? NONE,
  hitTest: (o, point, tol, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return false;
    // Выбирается по образу единичного квадрата и образам базисных векторов.
    const q = fr.toMath(point);
    const p = o.props;
    const dt = p.a * p.d - p.b * p.c;
    if (Math.abs(dt) > 1e-12) {
      const u = (p.d * q.X - p.b * q.Y) / dt;
      const v = (-p.c * q.X + p.a * q.Y) / dt;
      if (u >= -0.02 && u <= 1.02 && v >= -0.02 && v <= 1.02) return true;
    }
    const near = (x: number, y: number) => {
      const a = fr.toWorld(0, 0);
      const b = fr.toWorld(x, y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0;
      return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= tol + 4;
    };
    return near(p.a, p.c) || near(p.b, p.d);
  },
  hitTestRect: () => false,
  // Концы образов базисных векторов тянут — меняются столбцы матрицы.
  getHandles: (o, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return [];
    return [
      { id: 'i', kind: 'point', position: fr.toWorld(o.props.a, o.props.c), label: 'A·i — первый столбец', snap: false },
      { id: 'j', kind: 'point', position: fr.toWorld(o.props.b, o.props.d), label: 'A·j — второй столбец', snap: false },
    ];
  },
  dragHandle: (o, h, to, m, ctx) => {
    const fr = frameFor(o, ctx);
    if (!fr) return null;
    const q = fr.toMath(to);
    const s = (v: number) => (m.alt ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2 + 0);
    return h === 'i' ? { props: { a: s(q.X), c: s(q.Y) } } : { props: { b: s(q.X), d: s(q.Y) } };
  },
  render: (o, ctx) => <TransformView o={o} ctx={ctx} />,
  inspector: [
    { kind: 'number', key: 'a', label: 'a', step: 0.5 },
    { kind: 'number', key: 'b', label: 'b', step: 0.5 },
    { kind: 'number', key: 'c', label: 'c', step: 0.5 },
    { kind: 'number', key: 'd', label: 'd', step: 0.5 },
    { kind: 'toggle', key: 'showGrid', label: 'Сетка' },
    { kind: 'toggle', key: 'showSquare', label: 'Квадрат' },
    { kind: 'toggle', key: 'showEigen', label: 'Собственные векторы' },
  ],
  transform: { rotatable: false, resize: 'none' },
  derived: true,
  moveDeps: () => [],
  hitPriority: 10,
};

export const linalgModules = [matrixModule, opModule, gaussModule, transformModule];
