import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { PLAY0, playAction, playSchema, usePlayTime } from '../../physics/mechanics/playback';
import { Lines, boxed, useZoom } from '../multivar/objects';
import {
  type Edge,
  type Visit,
  arrangements,
  bfs,
  combinations,
  components,
  degrees,
  dfs,
  dijkstra,
  divideSteps,
  enumerate,
  euler,
  expanded,
  factorial,
  fracSteps,
  kruskal,
  parseBase,
  parseEdges,
  pascal,
  pathEdges,
  truthTable,
} from './discrete';

export const PLUGIN_ID = 'math.discrete';
export const GRAPH_TYPE = `${PLUGIN_ID}.graph`;
export const COMB_TYPE = `${PLUGIN_ID}.comb`;
export const LOGIC_TYPE = `${PLUGIN_ID}.logic`;
export const BASES_TYPE = `${PLUGIN_ID}.bases`;

const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const HI = '#ea580c';
const PATH = '#d13a3a';
const BLUE = '#2563eb';
const RED = '#d13a3a';
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SUBS = (n: number) => String(n).split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join('');

// =====================================================================
//  Граф
// =====================================================================

const ALGOS = ['none', 'bfs', 'dfs', 'dijkstra', 'mst', 'euler'] as const;
type Algo = (typeof ALGOS)[number];
const ALGO_TITLE: Record<Algo, string> = { none: 'Без алгоритма', bfs: 'Обход в ширину', dfs: 'Обход в глубину', dijkstra: 'Кратчайшие пути (Дейкстра)', mst: 'Минимальное остовное дерево', euler: 'Эйлеров путь' };

export const graphPropsSchema = z.object({
  vertices: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(1).max(26),
  edges: z.string().max(2000),
  directed: z.boolean(),
  weighted: z.boolean(),
  algo: z.enum(ALGOS),
  start: z.number().int().min(0).max(25),
  target: z.number().int().min(0).max(25),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type GraphProps = z.infer<typeof graphPropsSchema>;
const VR = 17;
const STEP = 0.9;
const names = (p: GraphProps) => p.vertices.map((_, i) => ABC[i]!);

function graphBox(p: GraphProps): Rect {
  const xs = p.vertices.map((v) => v.x);
  const ys = p.vertices.map((v) => v.y);
  const x0 = Math.min(...xs) - 40;
  const y0 = Math.min(...ys) - 40;
  return { x: Math.min(x0, 0), y: y0 - 110, width: Math.max(Math.max(...xs) + 40, 560) - Math.min(x0, 0), height: Math.max(...ys) + 40 - y0 + 110 };
}

export interface GraphRun {
  /** Шаги анимации: вершины и рёбра по порядку. */
  steps: { v?: number; e?: number }[];
  lines: string[];
  /** Расстояния Дейкстры и рёбра кратчайшего пути до цели. */
  dist?: number[];
  path?: number[];
  /** Номер ребра в эйлеровом пути. */
  eulerIndex?: Map<number, number>;
}

/** Результат выбранного алгоритма: шаги и строки пояснения. */
export function runGraph(p: GraphProps, edges: Edge[]): GraphRun {
  const n = p.vertices.length;
  const nm = names(p);
  const start = Math.min(p.start, n - 1);
  const target = Math.min(p.target, n - 1);
  const visits = (list: Visit[]) => list.map((v) => ({ v: v.v, e: v.via >= 0 ? v.via : undefined }));
  switch (p.algo) {
    case 'bfs':
    case 'dfs': {
      const list = p.algo === 'bfs' ? bfs(n, edges, p.directed, start) : dfs(n, edges, p.directed, start);
      return { steps: visits(list), lines: [`Порядок обхода из ${nm[start]}: ${list.map((v) => nm[v.v]).join(' → ')}`, p.algo === 'bfs' ? 'В ширину: сначала все соседи, потом соседи соседей (очередь)' : 'В глубину: идём, пока можно, затем возвращаемся (стек)'] };
    }
    case 'dijkstra': {
      if (edges.some((e) => e.w < 0)) return { steps: [], lines: ['Алгоритм Дейкстры не работает с отрицательными весами'] };
      const d = dijkstra(n, edges, p.directed, start);
      const path = Number.isFinite(d.dist[target]!) ? pathEdges(edges, d.prevEdge, target, p.directed) : [];
      const seq = [start];
      for (const e of path) {
        const ed = edges[e]!;
        seq.push(ed.a === seq[seq.length - 1] ? ed.b : ed.a);
      }
      return {
        steps: visits(d.order),
        dist: d.dist,
        path,
        lines: [Number.isFinite(d.dist[target]!) ? `Кратчайший путь ${nm[start]} → ${nm[target]}: ${seq.map((v) => nm[v]).join(' → ')}, длина ${d.dist[target]}` : `Из ${nm[start]} в ${nm[target]} пути нет`, 'Над вершинами — расстояния от начальной; вершины помечаются по возрастанию расстояния'],
      };
    }
    case 'mst': {
      if (p.directed) return { steps: [], lines: ['Остовное дерево строится для неориентированного графа'] };
      const t = kruskal(n, edges);
      const w = t.reduce((s, e) => s + edges[e]!.w, 0);
      return { steps: t.map((e) => ({ e })), lines: [`Остов (Краскал): ${t.map((e) => nm[edges[e]!.a]! + nm[edges[e]!.b]!).join(', ')};  вес ${w}`, components(n, edges) > 1 ? 'Граф несвязный — получился остовный лес' : 'Берём рёбра по возрастанию веса, если они не дают цикла'] };
    }
    case 'euler': {
      if (p.directed) return { steps: [], lines: ['Эйлеров путь здесь — для неориентированного графа'] };
      const r = euler(n, edges);
      if ('reason' in r) return { steps: [], lines: [r.reason, 'Эйлеров путь есть, если рёбра связны и нечётных вершин 0 или 2'] };
      const seq = [r.start];
      for (const e of r.edges) {
        const ed = edges[e]!;
        seq.push(ed.a === seq[seq.length - 1] ? ed.b : ed.a);
      }
      return { steps: r.edges.map((e) => ({ e })), eulerIndex: new Map(r.edges.map((e, i) => [e, i + 1])), lines: [`${r.cycle ? 'Эйлеров цикл' : 'Эйлеров путь'}: ${seq.map((v) => nm[v]).join(' → ')}`, r.cycle ? 'Все степени чётные — путь замыкается' : 'Две нечётные вершины — путь начинается в одной и кончается в другой'] };
    }
  }
  return { steps: [], lines: [] };
}

const graphEnd = (steps: number) => Math.max(STEP, steps * STEP);

function GraphShape({ o, ctx }: { o: BoardObject<GraphProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const nm = names(p);
  const parsed = parseEdges(p.edges, nm);
  const edges = 'error' in parsed ? [] : parsed;
  const run = runGraph(p, edges);
  const t = usePlayTime(p.play, graphEnd(run.steps.length), p.speed);
  // До первого пуска показан весь результат; после — по шагам.
  const fresh = !p.play.running && p.play.t0 === 0 && p.play.at === 0;
  const shown = fresh ? run.steps.length : Math.min(run.steps.length, Math.floor(t / STEP) + 1);
  const hotV = new Map<number, number>();
  const hotE = new Set<number>();
  run.steps.slice(0, shown).forEach((s, i) => {
    if (s.v !== undefined) hotV.set(s.v, i + 1);
    if (s.e !== undefined) hotE.add(s.e);
  });
  const complete = shown >= run.steps.length;
  const pathSet = new Set(complete ? run.path ?? [] : []);
  const deg = degrees(p.vertices.length, edges);
  const comp = components(p.vertices.length, edges);
  const b = graphBox(p);
  return (
    <Group listening={false}>
      {edges.map((e, i) => {
        const A = p.vertices[e.a]!;
        const B = p.vertices[e.b]!;
        const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
        const ux = (B.x - A.x) / len;
        const uy = (B.y - A.y) / len;
        const color = pathSet.has(i) ? PATH : hotE.has(i) ? HI : ink;
        const width = pathSet.has(i) || hotE.has(i) ? 3.4 : 1.6;
        const pts = [A.x + ux * VR, A.y + uy * VR, B.x - ux * VR, B.y - uy * VR];
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        return (
          <Group key={i}>
            {p.directed ? <Arrow points={pts} stroke={color} fill={color} strokeWidth={width} strokeScaleEnabled={false} pointerLength={10 / zoom} pointerWidth={8 / zoom} listening={false} /> : <Line points={pts} stroke={color} strokeWidth={width} strokeScaleEnabled={false} listening={false} />}
            {p.weighted && (
              <Group>
                <KRect x={mx - 12 - uy * 12} y={my - 9 + ux * 12} width={24} height={18} cornerRadius={4} fill="#ffffff" opacity={0.85} listening={false} />
                <Text x={mx - 12 - uy * 12} y={my - 7 + ux * 12} width={24} align="center" text={String(e.w).replace('.', ',')} fontSize={13} fill={color} listening={false} />
              </Group>
            )}
            {run.eulerIndex?.has(i) && hotE.has(i) && <Text x={mx + uy * 14 - 8} y={my - ux * 14 - 8} text={String(run.eulerIndex.get(i))} fontSize={12} fill={HI} listening={false} />}
          </Group>
        );
      })}
      {p.vertices.map((v, i) => {
        const hot = hotV.has(i);
        const isStart = p.algo !== 'none' && p.algo !== 'mst' && p.algo !== 'euler' && i === Math.min(p.start, p.vertices.length - 1);
        const isTarget = p.algo === 'dijkstra' && i === Math.min(p.target, p.vertices.length - 1);
        return (
          <Group key={i}>
            <Circle x={v.x} y={v.y} radius={VR} fill={hot ? '#fed7aa' : '#ffffff'} stroke={isTarget ? PATH : isStart ? BLUE : ink} strokeWidth={isStart || isTarget ? 3 : 1.6} strokeScaleEnabled={false} listening={false} />
            <Text x={v.x - VR} y={v.y - 9} width={2 * VR} align="center" text={nm[i]} fontSize={17} {...italic} fill={ink} listening={false} />
            {hot && p.algo !== 'dijkstra' && <Text x={v.x + VR - 4} y={v.y - VR - 12} text={String(hotV.get(i))} fontSize={12} fill={HI} listening={false} />}
            {run.dist && hot && <Text x={v.x - 20} y={v.y - VR - 18} width={40} align="center" text={Number.isFinite(run.dist[i]!) ? String(run.dist[i]).replace('.', ',') : '∞'} fontSize={13} fill={BLUE} listening={false} />}
          </Group>
        );
      })}
      <Lines
        x={b.x + 4}
        y={b.y + 4}
        ink={ink}
        muted={muted}
        lines={
          'error' in parsed
            ? [`Ошибка в рёбрах: ${parsed.error}`, 'Пример: AB 3, BC, C-D 2']
            : [
                `${p.directed ? 'Ориентированный' : 'Неориентированный'} граф: вершин ${p.vertices.length}, рёбер ${edges.length};  ${comp === 1 ? 'связный' : `компонент связности: ${comp}`}`,
                `Степени: ${nm.map((x, i) => `${x} — ${deg[i]}`).join(', ')};  сумма ${deg.reduce((a, c) => a + c, 0)} = 2·${edges.length}`,
                ...(p.algo === 'none' ? ['Вершины тянутся мышью; рёбра и алгоритм — на панели свойств'] : [`${p.play.running ? '▶' : '‖'} ${ALGO_TITLE[p.algo]}${complete ? '' : ` — шаг ${shown} из ${run.steps.length}`}`, ...run.lines]),
              ]
        }
      />
    </Group>
  );
}

/** Убрать рёбра с вершиной name из текстовой записи (пара вершин — как в parseEdges). */
export function dropVertexEdges(src: string, name: string): string {
  const pair = /^([A-Za-zА-Яа-яЁё]\d*)\s*[-–—]?\s*([A-Za-zА-Яа-яЁё]\d*)/;
  const same = (x: string | undefined) => x?.toLowerCase() === name.toLowerCase();
  return src
    .split(/[;\n]+|,(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => {
      const m = pair.exec(s);
      return s && !(m && (same(m[1]) || same(m[2])));
    })
    .join(', ');
}

export const graphModule: ObjectModule<GraphProps, ReactNode> = {
  type: GRAPH_TYPE,
  title: 'Граф',
  version: 1,
  propsSchema: graphPropsSchema,
  createProps: () => ({
    vertices: [{ x: 60, y: 140 }, { x: 220, y: 60 }, { x: 220, y: 230 }, { x: 400, y: 60 }, { x: 400, y: 230 }, { x: 540, y: 145 }],
    edges: 'AB 4, AC 2, BC 1, BD 5, CE 9, CD 10, DE 2, DF 6, EF 3',
    directed: false,
    weighted: true,
    algo: 'dijkstra',
    start: 0,
    target: 5,
    speed: 1,
    play: PLAY0,
  }),
  deserialize: (r) => r as unknown as BoardObject<GraphProps>,
  ...boxed(graphBox),
  hitPriority: 1,
  getHandles: (o) => o.props.vertices.map((v, i) => ({ id: `v:${i}`, kind: 'point' as const, position: toWorld(o, v), label: `Вершина ${ABC[i]}`, snap: false })),
  dragHandle: (o, id, to) => {
    const i = Number(id.slice(2));
    if (!id.startsWith('v:') || !o.props.vertices[i]) return null;
    const q = toLocal(o, to);
    return { props: { vertices: o.props.vertices.map((v, k) => (k === i ? { x: Math.round(q.x), y: Math.round(q.y) } : v)) } };
  },
  render: (o, ctx) => <GraphShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'edges', label: 'Рёбра', maxLength: 2000 },
    { kind: 'select', key: 'algo', label: 'Алгоритм', options: ALGOS.map((v) => ({ value: v, label: ALGO_TITLE[v] })) },
    { kind: 'action', key: 'toggle', label: '▶ По шагам' },
    { kind: 'action', key: 'reset', label: '⟲ Сначала' },
    { kind: 'number', key: 'start', label: 'Начало (0 — A)', min: 0, max: 25, step: 1 },
    { kind: 'number', key: 'target', label: 'Цель (0 — A)', min: 0, max: 25, step: 1 },
    { kind: 'toggle', key: 'directed', label: 'Ориентированный' },
    { kind: 'toggle', key: 'weighted', label: 'Веса рёбер' },
    { kind: 'action', key: 'add', label: '＋ Вершина' },
    { kind: 'action', key: 'remove', label: '− Вершина' },
  ],
  runAction: (o, key, ctx) => {
    const p = o.props;
    if (key === 'add' && p.vertices.length < 26) {
      const b = graphBox(p);
      ctx.updateObject<GraphProps>(o.id, { props: { vertices: [...p.vertices, { x: Math.round(b.x + b.width + 20), y: Math.round(b.y + 110 + 40) }] } });
      return;
    }
    if (key === 'remove' && p.vertices.length > 1) {
      ctx.updateObject<GraphProps>(o.id, { props: { vertices: p.vertices.slice(0, -1), edges: dropVertexEdges(p.edges, ABC[p.vertices.length - 1]!) } });
      return;
    }
    const nm = names(p);
    const parsed = parseEdges(p.edges, nm);
    const steps = 'error' in parsed ? 0 : runGraph(p, parsed).steps.length;
    // До первого пуска показан весь результат; «По шагам» начинает с первого шага.
    const play = playAction(key, p.play, graphEnd(steps), p.speed, ctx.now);
    if (play) ctx.updateObject<GraphProps>(o.id, { props: { play } });
  },
} as ObjectModule<GraphProps, ReactNode>;

// =====================================================================
//  Комбинаторика
// =====================================================================

export const combPropsSchema = z.object({
  kind: z.enum(['perm', 'arr', 'comb', 'pascal']),
  items: z.string().max(12),
  k: z.number().int().min(0).max(12),
  rows: z.number().int().min(1).max(16),
});
export type CombProps = z.infer<typeof combPropsSchema>;
const COMB_TITLE = { perm: 'Перестановки', arr: 'Размещения', comb: 'Сочетания', pascal: 'Треугольник Паскаля' };
const LIST_MAX = 120;

function CombShape({ o, ctx }: { o: BoardObject<CombProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  if (p.kind === 'pascal') {
    const tri = pascal(p.rows);
    const k = Math.min(p.k, p.rows);
    const cw = 44;
    const width = (p.rows + 1) * cw;
    return (
      <Group listening={false}>
        {tri.map((row, r) =>
          row.map((v, i) => {
            const hot = r === p.rows && i === k;
            const x = width / 2 - ((row.length - 1) * cw) / 2 + i * cw;
            return (
              <Group key={`${r}-${i}`}>
                {hot && <Circle x={x} y={r * 30 + 9} radius={17} fill="#fed7aa" listening={false} />}
                <Text x={x - cw / 2} y={r * 30} width={cw} align="center" text={String(v)} fontSize={v > 9999 ? 11 : 14} fill={hot ? HI : ink} listening={false} />
              </Group>
            );
          }),
        )}
        <Lines x={0} y={-82} ink={ink} muted={muted} lines={[`Треугольник Паскаля, строки 0…${p.rows}`, `Каждое число — сумма двух над ним:  Cₙᵏ = Cₙ₋₁ᵏ⁻¹ + Cₙ₋₁ᵏ`, `C${SUBS(p.rows)}^${k} = ${combinations(p.rows, k)};  сумма строки ${p.rows}: 2^${p.rows} = ${2 ** p.rows}`]} />
      </Group>
    );
  }
  const items = [...p.items.replace(/\s|,/g, '')];
  const n = items.length;
  const k = p.kind === 'perm' ? n : Math.min(p.k, n);
  const total = p.kind === 'comb' ? combinations(n, k) : arrangements(n, k);
  const list = enumerate(items, k, p.kind !== 'comb', LIST_MAX);
  const cols = Math.max(1, Math.min(10, Math.floor(560 / Math.max(30, k * 12 + 18))));
  const cw = 560 / cols;
  const formula =
    p.kind === 'perm' ? `Pₙ = n!:  P${SUBS(n)} = ${n}! = ${factorial(n)}`
    : p.kind === 'arr' ? `Aₙᵏ = n!/(n − k)!:  A${SUBS(n)}^${k} = ${n}!/${n - k}! = ${total}`
    : `Cₙᵏ = n!/(k!(n − k)!):  C${SUBS(n)}^${k} = ${n}!/(${k}!·${n - k}!) = ${total}`;
  return (
    <Group listening={false}>
      {list.map((v, i) => (
        <Text key={i} x={(i % cols) * cw} y={Math.floor(i / cols) * 22} width={cw} text={p.kind === 'comb' ? `{${v.join(', ')}}` : v.join('')} fontSize={14} fill={ink} listening={false} />
      ))}
      <Lines
        x={0}
        y={-82}
        ink={ink}
        muted={muted}
        lines={[
          `${COMB_TITLE[p.kind]} из ${n} элементов (${items.join(', ')})${p.kind === 'perm' ? '' : ` по ${k}`}`,
          formula,
          `${p.kind === 'comb' ? 'Порядок не важен' : 'Порядок важен'};  выписано ${list.length}${total > list.length ? ` из ${total}` : ''}`,
        ]}
      />
    </Group>
  );
}

export const combModule: ObjectModule<CombProps, ReactNode> = {
  type: COMB_TYPE,
  title: 'Комбинаторика',
  version: 1,
  propsSchema: combPropsSchema,
  createProps: () => ({ kind: 'arr', items: 'ABCD', k: 2, rows: 6 }),
  deserialize: (r) => r as unknown as BoardObject<CombProps>,
  ...boxed((p: CombProps) => (p.kind === 'pascal' ? { x: -6, y: -86, width: Math.max(560, (p.rows + 1) * 44), height: (p.rows + 1) * 30 + 96 } : { x: -6, y: -86, width: 570, height: 96 + 22 * Math.ceil(Math.min(LIST_MAX, p.kind === 'comb' ? combinations([...p.items].length, p.k) : arrangements([...p.items].length, p.kind === 'perm' ? [...p.items].length : p.k)) / 4) })),
  getHandles: () => [],
  render: (o, ctx) => <CombShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'select', key: 'kind', label: 'Вид', options: (Object.keys(COMB_TITLE) as (keyof typeof COMB_TITLE)[]).map((v) => ({ value: v, label: COMB_TITLE[v] })) },
    { kind: 'text', key: 'items', label: 'Элементы', maxLength: 12 },
    { kind: 'number', key: 'k', label: 'k', min: 0, max: 12, step: 1, slider: true },
    { kind: 'number', key: 'rows', label: 'n (Паскаль)', min: 1, max: 16, step: 1 },
  ],
} as ObjectModule<CombProps, ReactNode>;

// =====================================================================
//  Логика: таблица истинности, СДНФ, СКНФ, круги Эйлера — Венна
// =====================================================================

export const logicPropsSchema = z.object({ formula: z.string().max(200), venn: z.boolean() });
export type LogicProps = z.infer<typeof logicPropsSchema>;
const CELL_W = 40;
const CELL_H = 22;
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Круги Венна: центры для 1–3 множеств. */
const VENN: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 110, y: 100 }],
  2: [{ x: 85, y: 100 }, { x: 145, y: 100 }],
  3: [{ x: 85, y: 82 }, { x: 145, y: 82 }, { x: 115, y: 134 }],
};
const VR2 = 62;

function LogicShape({ o, ctx }: { o: BoardObject<LogicProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const tt = truthTable(p.formula);
  if ('error' in tt) return <Lines x={0} y={0} ink={RED} muted={muted} lines={[`Ошибка в формуле: ${tt.error}`, 'Пример: (A → B) ∧ ¬C;  можно писать и, или, не, ->, <->, xor, &, |, !']} />;
  const nv = tt.vars.length;
  const tw = (nv + 1) * CELL_W;
  const showVenn = p.venn && nv >= 1 && nv <= 3;
  const centers = VENN[nv] ?? [];
  const vx = tw + 40;
  return (
    <Group listening={false}>
      {[...tt.vars, 'F'].map((v, i) => (
        <Group key={v}>
          <KRect x={i * CELL_W} y={0} width={CELL_W} height={CELL_H} fill={i === nv ? '#fed7aa' : '#e5e7eb'} stroke={muted} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          <Text x={i * CELL_W} y={4} width={CELL_W} align="center" text={v} fontSize={14} {...italic} fill={ink} listening={false} />
        </Group>
      ))}
      {tt.rows.map((r, j) => (
        <Group key={j}>
          {[...r.values, r.result].map((v, i) => (
            <Group key={i}>
              <KRect x={i * CELL_W} y={(j + 1) * CELL_H} width={CELL_W} height={CELL_H} fill={i === nv && v ? '#fff7ed' : undefined} stroke={muted} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
              <Text x={i * CELL_W} y={(j + 1) * CELL_H + 4} width={CELL_W} align="center" text={v ? '1' : '0'} fontSize={14} fill={i === nv ? (v ? HI : muted) : ink} listening={false} />
            </Group>
          ))}
        </Group>
      ))}
      {showVenn && (
        <Group x={vx} y={0} listening={false}>
          <KRect width={230} height={210} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
          <Shape
            sceneFunc={(c) => {
              const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
              // Закраска областей, где формула истинна: переменные — «точка во множестве».
              g.beginPath();
              const step = 2;
              for (let x = 0; x < 230; x += step)
                for (let y = 0; y < 210; y += step) {
                  const env: Record<string, boolean> = {};
                  tt.vars.forEach((v, i) => (env[v] = Math.hypot(x + 1 - centers[i]!.x, y + 1 - centers[i]!.y) <= VR2));
                  const row = tt.rows.find((r) => r.values.every((val, i) => val === env[tt.vars[i]!]));
                  if (row?.result) g.rect(x, y, step + 0.2, step + 0.2);
                }
              g.fillStyle = HI;
              g.globalAlpha = 0.4;
              g.fill();
              g.globalAlpha = 1;
            }}
            listening={false}
          />
          {centers.map((c, i) => (
            <Group key={i}>
              <Circle x={c.x} y={c.y} radius={VR2} stroke={ink} strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />
              <Text x={c.x + (i === 2 ? -6 : i === 0 ? -VR2 + 6 : VR2 - 18)} y={c.y + (i === 2 ? VR2 - 22 : -VR2 + 4)} text={tt.vars[i]} fontSize={16} {...italic} fill={ink} listening={false} />
            </Group>
          ))}
          <Text x={4} y={192} text="U" fontSize={13} {...italic} fill={muted} listening={false} />
        </Group>
      )}
      <Lines
        x={0}
        y={-100}
        ink={ink}
        muted={muted}
        lines={[`F = ${p.formula};  формула ${tt.kind}`, `СДНФ: ${clip(tt.sdnf)}`, `СКНФ: ${clip(tt.sknf)}`, showVenn ? 'Справа — круги Эйлера — Венна: закрашено, где F = 1 (∧ — пересечение, ∨ — объединение, ¬ — дополнение)' : 'Строки, где F = 1, дают СДНФ; где F = 0 — СКНФ']}
      />
    </Group>
  );
}

export const logicModule: ObjectModule<LogicProps, ReactNode> = {
  type: LOGIC_TYPE,
  title: 'Логика: таблица истинности',
  version: 1,
  propsSchema: logicPropsSchema,
  createProps: () => ({ formula: '(A ∨ B) ∧ ¬C', venn: true }),
  deserialize: (r) => r as unknown as BoardObject<LogicProps>,
  ...boxed((p: LogicProps) => {
    const tt = truthTable(p.formula);
    const nv = 'error' in tt ? 2 : tt.vars.length;
    return { x: -6, y: -104, width: Math.max(620, (nv + 1) * CELL_W + 290), height: Math.max(240, (2 ** nv + 1) * CELL_H + 20) + 104 };
  }),
  getHandles: () => [],
  render: (o, ctx) => <LogicShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'formula', label: 'Формула', maxLength: 200 },
    { kind: 'toggle', key: 'venn', label: 'Круги Эйлера — Венна' },
  ],
} as ObjectModule<LogicProps, ReactNode>;

// =====================================================================
//  Системы счисления
// =====================================================================

export const basesPropsSchema = z.object({
  value: z.string().max(40),
  from: z.number().int().min(2).max(36),
  to: z.number().int().min(2).max(36),
});
export type BasesProps = z.infer<typeof basesPropsSchema>;

function BasesShape({ o, ctx }: { o: BoardObject<BasesProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const zoom = useZoom();
  const src = parseBase(p.value, p.from);
  if ('error' in src) return <Lines x={0} y={0} ink={RED} muted={muted} lines={[`Ошибка: ${src.error}`]} />;
  if (src.value > 2 ** 52) return <Lines x={0} y={0} ink={RED} muted={muted} lines={['Слишком большое число']} />;
  const int = Math.floor(src.value);
  const frac = src.value - int;
  const div = divideSteps(int, p.to);
  const fr = fracSteps(frac, p.to);
  const result = `${div.digits}${fr.digits ? `,${fr.digits}` : ''}`;
  const dec = String(Number(src.value.toPrecision(12))).replace('.', ',');
  const rowH = 22;
  return (
    <Group listening={false}>
      {/* Деление «уголком»: делимое, частное, остаток; ответ — остатки снизу вверх. */}
      {p.to !== 10 && (
        <Group y={10} listening={false}>
          {['Делимое', `: ${p.to}`, 'Остаток'].map((h, i) => (
            <Text key={h} x={i * 110} y={0} width={100} align="center" text={h} fontSize={13} fill={muted} listening={false} />
          ))}
          {div.steps.map((s, i) => (
            <Group key={i}>
              <Text x={0} y={(i + 1) * rowH} width={100} align="center" text={String(s.q)} fontSize={15} fill={ink} listening={false} />
              <Text x={110} y={(i + 1) * rowH} width={100} align="center" text={String(s.d)} fontSize={15} fill={ink} listening={false} />
              <Text x={220} y={(i + 1) * rowH} width={100} align="center" text={'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[s.r]!} fontSize={15} fill={HI} listening={false} />
            </Group>
          ))}
          <Arrow points={[330, (div.steps.length + 0.6) * rowH, 330, rowH]} stroke={HI} fill={HI} strokeWidth={1.8} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
          <Text x={340} y={rowH} text="остатки читаем снизу вверх" fontSize={12} fill={HI} listening={false} />
          {fr.steps.length > 0 && (
            <Group y={(div.steps.length + 2) * rowH}>
              <Text x={0} y={0} text={`Дробная часть — умножаем на ${p.to}, целые части дают цифры:`} fontSize={13} fill={muted} listening={false} />
              {fr.steps.map((s, i) => (
                <Text key={i} x={0} y={(i + 1) * rowH} text={`${String(Number(s.x.toPrecision(10))).replace('.', ',')} · ${p.to} = ${String(Number((s.x * p.to).toPrecision(10))).replace('.', ',')}  →  ${'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[s.digit]}`} fontSize={14} fill={ink} listening={false} />
              ))}
            </Group>
          )}
        </Group>
      )}
      <Lines
        x={0}
        y={-82}
        ink={ink}
        muted={muted}
        lines={[
          `${src.digits.replace('.', ',')}${SUBS(p.from)} = ${result}${SUBS(p.to)}`,
          p.from !== 10 ? `В десятичную: ${expanded(src.digits, p.from)} = ${dec}` : `Число ${dec} уже десятичное`,
          p.to !== 10 ? `Из десятичной в ${p.to}-ю: целую часть делим на ${p.to}, пока частное не станет 0` : 'Результат — десятичное число',
        ]}
      />
    </Group>
  );
}

export const basesModule: ObjectModule<BasesProps, ReactNode> = {
  type: BASES_TYPE,
  title: 'Системы счисления',
  version: 1,
  propsSchema: basesPropsSchema,
  createProps: () => ({ value: '157', from: 10, to: 2 }),
  deserialize: (r) => r as unknown as BoardObject<BasesProps>,
  ...boxed(() => ({ x: -6, y: -86, width: 600, height: 520 })),
  getHandles: () => [],
  render: (o, ctx) => <BasesShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'value', label: 'Число', maxLength: 40 },
    { kind: 'number', key: 'from', label: 'Из системы', min: 2, max: 36, step: 1 },
    { kind: 'number', key: 'to', label: 'В систему', min: 2, max: 36, step: 1 },
  ],
} as ObjectModule<BasesProps, ReactNode>;

export const discreteModules = [graphModule, combModule, logicModule, basesModule];
