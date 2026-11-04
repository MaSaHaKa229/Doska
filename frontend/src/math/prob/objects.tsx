import { type ReactNode, useMemo } from 'react';
import { Arc, Arrow, Circle, Group, Line, Rect as KRect, Shape, Text, Wedge } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { useBoard } from '../../store/board';
import { niceStep } from '../analysis/expr';
import { PLAY0, playAction, playSchema, usePlayTime } from '../../physics/mechanics/playback';
import { type DistKind, distribution, eventProb, experiment, histogram, parseData, stats, tree, trials } from './prob';

export const PLUGIN_ID = 'math.prob';
export const EXPERIMENT_TYPE = `${PLUGIN_ID}.experiment`;
export const TREE_TYPE = `${PLUGIN_ID}.tree`;
export const DIST_TYPE = `${PLUGIN_ID}.dist`;
export const STATS_TYPE = `${PLUGIN_ID}.stats`;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const BAR = '#2563eb';
const HI = '#ea580c';
const RED = '#d13a3a';
const PALETTE = ['#2563eb', '#ea580c', '#16a34a', '#d13a3a', '#9333ea', '#0891b2', '#ca8a04', '#be185d', '#65a30d', '#475569', '#f97316', '#14b8a6'];
const SUB = '₁₂₃₄';

/** Число по-русски: значащих цифр digits, без «−0». */
export function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toPrecision(digits));
  return String(Math.abs(r) < 1e-12 ? 0 : r).replace('.', ',').replace('-', '−');
}

function Lines({ x, y, lines, ink, muted }: { x: number; y: number; lines: string[]; ink: string; muted: string }) {
  return (
    <Group listening={false}>
      {lines.map((l, i) => (
        <Text key={i} x={x} y={y + i * 19} text={l} fontSize={i ? 13 : 14} fill={i ? muted : ink} listening={false} />
      ))}
    </Group>
  );
}

function boxed<P>(box: (p: P) => Rect) {
  return {
    serialize: (o: BoardObject<P>) => o as unknown as BoardObject<Record<string, never>>,
    getLocalBounds: (o: BoardObject<P>) => box(o.props),
    hitTest: (o: BoardObject<P>, point: { x: number; y: number }, tol: number) => {
      const b = box(o.props);
      const q = toLocal(o, point);
      return q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;
    },
    getHandles: () => [],
    transform: { rotatable: false, resize: 'none' as const },
  };
}

/** Оси графика: x — от xMin до xMax (подписи — снаружи), y — от 0 до yMax с делениями. */
function Axes({ w, h, yMax, ink, muted, xLabel, yLabel, percent }: { w: number; h: number; yMax: number; ink: string; muted: string; xLabel: string; yLabel: string; percent?: boolean }) {
  const zoom = useZoom();
  const step = niceStep(yMax / 5);
  const ticks: number[] = [];
  for (let v = step; v <= yMax * 1.0001; v += step) ticks.push(v);
  return (
    <Group listening={false}>
      {ticks.map((v) => (
        <Group key={v}>
          <Line points={[0, h - (v / yMax) * h, w, h - (v / yMax) * h]} stroke={muted} opacity={0.25} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          <Text x={-48} y={h - (v / yMax) * h - 6} width={44} align="right" text={percent ? `${num(v * 100, 3)} %` : num(v, 3)} fontSize={11} fill={muted} listening={false} />
        </Group>
      ))}
      <Arrow points={[0, h, w + 14, h]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={5 / zoom} listening={false} />
      <Arrow points={[0, h, 0, -14]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={5 / zoom} listening={false} />
      <Text x={w + 6} y={h + 4} text={xLabel} fontSize={13} {...italic} fill={ink} listening={false} />
      <Text x={6} y={-18} text={yLabel} fontSize={13} {...italic} fill={ink} listening={false} />
    </Group>
  );
}

// =====================================================================
//  Опыт: частота и вероятность
// =====================================================================

export const experimentPropsSchema = z.object({
  kind: z.enum(['coin', 'die', 'urn']),
  /** Событие: e1 — орёл / шестёрка / красный; e2 — решка / чётное / синий; e3 — больше 4 (кубик). */
  event: z.enum(['e1', 'e2', 'e3']),
  red: z.number().int().min(1).max(50),
  blue: z.number().int().min(1).max(50),
  N: z.number().int().min(10).max(10000),
  seed: z.number().int().min(0).max(1e9),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type ExperimentProps = z.infer<typeof experimentPropsSchema>;
/** Вся серия показывается за 10 с. */
const SHOW = 10;
const EVENT_MAP: Record<ExperimentProps['kind'], Record<ExperimentProps['event'], string>> = {
  coin: { e1: 'heads', e2: 'tails', e3: 'heads' },
  die: { e1: 'six', e2: 'even', e3: 'gt4' },
  urn: { e1: 'red', e2: 'blue', e3: 'red' },
};
const KIND_TEXT = { coin: 'бросаем монету', die: 'бросаем кубик', urn: 'вынимаем шар из урны и возвращаем' };
export const experimentOf = (p: ExperimentProps) => experiment(p.kind, EVENT_MAP[p.kind][p.event], p.red, p.blue);

/** Сколько опытов проведено к моменту t показа. */
export const doneAt = (p: ExperimentProps, t: number) => Math.min(p.N, Math.floor((p.N * t) / SHOW));

function Pips({ x, y, value, ink }: { x: number; y: number; value: number; ink: string }) {
  const at: Record<number, [number, number][]> = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  return (
    <Group x={x} y={y} listening={false}>
      <KRect x={-34} y={-34} width={68} height={68} cornerRadius={10} fill="#ffffff" stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      {(at[value] ?? []).map(([a, b], i) => (
        <Circle key={i} x={a * 18} y={b * 18} radius={6} fill={ink} listening={false} />
      ))}
    </Group>
  );
}

function ExperimentShape({ o, ctx }: { o: BoardObject<ExperimentProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const e = experimentOf(p);
  const P = eventProb(e);
  const all = useMemo(() => trials(e, p.seed, p.N), [p.kind, p.red, p.blue, p.seed, p.N]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = usePlayTime(p.play, SHOW, p.speed);
  const n = doneAt(p, t);
  const fav = new Set(e.favourable);
  // Частоты: по исходам и накопленная частота события (не больше 400 точек на графике).
  const counts = e.outcomes.map(() => 0);
  let k = 0;
  const curve: number[] = [];
  const every = Math.max(1, Math.floor(p.N / 400));
  for (let i = 0; i < n; i++) {
    counts[all[i]!]!++;
    if (fav.has(all[i]!)) k++;
    if ((i + 1) % every === 0 || i === n - 1) curve.push(i + 1, k / (i + 1));
  }
  const last = n ? all[n - 1]! : null;
  const CW = 300;
  const CH = 150;
  const bw = CW / e.outcomes.length;
  const zoom = useZoom();
  return (
    <Group listening={false}>
      {/* Последний исход. */}
      <Group x={60} y={70} listening={false}>
        {p.kind === 'coin' && (
          <Group>
            <Circle radius={40} fill={last === null ? '#f3f4f6' : '#fcd34d'} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
            <Text x={-40} y={-14} width={80} align="center" text={last === null ? '?' : last === 0 ? 'О' : 'Р'} fontSize={28} fill={ink} listening={false} />
          </Group>
        )}
        {p.kind === 'die' && (last === null ? <Pips x={0} y={0} value={0} ink={ink} /> : <Pips x={0} y={0} value={last + 1} ink={ink} />)}
        {p.kind === 'urn' && (
          <Group>
            <Shape
              sceneFunc={(c, shape) => {
                const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
                g.beginPath();
                g.moveTo(-30, -45);
                g.lineTo(-30, -35);
                g.bezierCurveTo(-60, -20, -55, 40, -20, 45);
                g.lineTo(20, 45);
                g.bezierCurveTo(55, 40, 60, -20, 30, -35);
                g.lineTo(30, -45);
                c.strokeShape(shape);
              }}
              stroke={ink}
              strokeWidth={2}
              strokeScaleEnabled={false}
              listening={false}
            />
            {Array.from({ length: Math.min(30, p.red + p.blue) }, (_, i) => {
              const total = Math.min(30, p.red + p.blue);
              const isRed = i < Math.round((p.red / (p.red + p.blue)) * total);
              return <Circle key={i} x={-30 + (i % 6) * 12} y={35 - Math.floor(i / 6) * 12} radius={5} fill={isRed ? RED : BAR} listening={false} />;
            })}
            {last !== null && <Circle x={0} y={-62} radius={10} fill={last === 0 ? RED : BAR} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />}
          </Group>
        )}
        <Text x={-60} y={52} width={120} align="center" text={last === null ? 'опыт не начат' : `опыт № ${n}: ${e.outcomes[last]}`} fontSize={12} fill={muted} listening={false} />
      </Group>
      {/* Частоты исходов и вероятности (пунктир). */}
      <Group x={190} y={0} listening={false}>
        <Axes w={CW} h={CH} yMax={Math.max(0.6, ...e.probs)} ink={ink} muted={muted} xLabel="исход" yLabel="частота" />
        {e.outcomes.map((name, i) => {
          const f = n ? counts[i]! / n : 0;
          const yMax = Math.max(0.6, ...e.probs);
          return (
            <Group key={name}>
              <KRect x={i * bw + bw * 0.2} y={CH - (f / yMax) * CH} width={bw * 0.6} height={(f / yMax) * CH} fill={fav.has(i) ? HI : BAR} opacity={0.75} listening={false} />
              <Line points={[i * bw + bw * 0.12, CH - (e.probs[i]! / yMax) * CH, i * bw + bw * 0.88, CH - (e.probs[i]! / yMax) * CH]} stroke={ink} strokeWidth={1.5} dash={[5 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
              <Text x={i * bw} y={CH + 4} width={bw} align="center" text={name} fontSize={12} fill={ink} listening={false} />
            </Group>
          );
        })}
      </Group>
      {/* Частота события в зависимости от n. */}
      <Group x={60} y={220} listening={false}>
        <Axes w={430} h={130} yMax={1} ink={ink} muted={muted} xLabel="n" yLabel="k/n" />
        <Line points={[0, 130 - P * 130, 430, 130 - P * 130]} stroke={RED} strokeWidth={1.5} dash={[6 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
        <Text x={434} y={130 - P * 130 - 8} text={`P = ${num(P, 3)}`} fontSize={12} fill={RED} listening={false} />
        {curve.length > 2 && <Line points={curve.map((v, i) => (i % 2 ? 130 - v * 130 : (v / p.N) * 430))} stroke={HI} strokeWidth={1.8} strokeScaleEnabled={false} listening={false} />}
        <Text x={430 - 30} y={134} width={60} align="center" text={String(p.N)} fontSize={11} fill={muted} listening={false} />
      </Group>
      <Lines
        x={0}
        y={-96}
        ink={ink}
        muted={muted}
        lines={[
          `${p.play.running ? '▶' : '‖'} Опыт: ${KIND_TEXT[p.kind]}${p.kind === 'urn' ? ` (${p.red} красных, ${p.blue} синих)` : ''};  событие A — ${e.event}`,
          `P(A) = m/n = ${p.kind === 'urn' ? `${e.favourable[0] === 0 ? p.red : p.blue}/${p.red + p.blue}` : `${e.favourable.length}/${e.outcomes.length}`} = ${num(P, 4)} — классическое определение (m благоприятных из n равновозможных)`,
          `Проведено n = ${n} из ${p.N};  A наступило k = ${k} раз;  частота k/n = ${n ? num(k / n, 4) : '—'}`,
          'При большом n частота приближается к вероятности (закон больших чисел)',
        ]}
      />
    </Group>
  );
}

export const experimentModule: ObjectModule<ExperimentProps, ReactNode> = {
  type: EXPERIMENT_TYPE,
  title: 'Опыт: частота и вероятность',
  version: 1,
  propsSchema: experimentPropsSchema,
  createProps: () => ({ kind: 'die', event: 'e1', red: 3, blue: 7, N: 1000, seed: 1, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<ExperimentProps>,
  ...boxed(() => ({ x: -10, y: -100, width: 560, height: 480 })),
  render: (o, ctx) => <ExperimentShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'action', key: 'toggle', label: '▶ Пуск / пауза' },
    { kind: 'action', key: 'reset', label: '⟲ Сначала' },
    { kind: 'action', key: 'new', label: 'Новая серия' },
    { kind: 'select', key: 'kind', label: 'Опыт', options: [{ value: 'coin', label: 'Монета' }, { value: 'die', label: 'Кубик' }, { value: 'urn', label: 'Урна с шарами' }] },
    { kind: 'select', key: 'event', label: 'Событие A', options: [{ value: 'e1', label: 'орёл · шестёрка · красный шар' }, { value: 'e2', label: 'решка · чётное · синий шар' }, { value: 'e3', label: 'больше 4 (кубик)' }] },
    { kind: 'number', key: 'N', label: 'Опытов в серии', min: 10, max: 10000, step: 10 },
    { kind: 'number', key: 'red', label: 'Красных шаров', min: 1, max: 50, step: 1 },
    { kind: 'number', key: 'blue', label: 'Синих шаров', min: 1, max: 50, step: 1 },
    { kind: 'number', key: 'speed', label: 'Скорость показа', min: 0.1, max: 10, step: 0.1 },
  ],
  runAction: (o, key, ctx) => {
    if (key === 'new') {
      ctx.updateObject<ExperimentProps>(o.id, { props: { seed: (o.props.seed + 1) % 1e9, play: { running: true, t0: 0, at: ctx.now } } });
      return;
    }
    const play = playAction(key, o.props.play, SHOW, o.props.speed, ctx.now);
    if (play) ctx.updateObject<ExperimentProps>(o.id, { props: { play } });
  },
} as ObjectModule<ExperimentProps, ReactNode>;

// =====================================================================
//  Дерево вероятностей: полная вероятность и Байес
// =====================================================================

const prob01 = z.number().finite().min(0).max(1);
export const treePropsSchema = z.object({
  k: z.number().int().min(2).max(4),
  p1: prob01, p2: prob01, p3: prob01, p4: prob01,
  a1: prob01, a2: prob01, a3: prob01, a4: prob01,
  /** Для какой гипотезы показать формулу Байеса (0 — для всех кратко). */
  focus: z.number().int().min(0).max(4),
});
export type TreeProps = z.infer<typeof treePropsSchema>;
export const treeArrays = (p: TreeProps) => ({ pH: [p.p1, p.p2, p.p3, p.p4].slice(0, p.k), pA: [p.a1, p.a2, p.a3, p.a4].slice(0, p.k) });

function TreeShape({ o, ctx }: { o: BoardObject<TreeProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const { pH, pA } = treeArrays(p);
  const r = tree(pH, pA);
  const H = 70 * 2 * p.k;
  const root = { x: 0, y: H / 2 };
  const edge = (x1: number, y1: number, x2: number, y2: number, label: string, hot: boolean, key: string) => (
    <Group key={key}>
      <Line points={[x1, y1, x2, y2]} stroke={hot ? HI : ink} strokeWidth={hot ? 2.6 : 1.4} strokeScaleEnabled={false} listening={false} />
      <Text x={(x1 + x2) / 2 - 30} y={(y1 + y2) / 2 - 18} width={60} align="center" text={label} fontSize={13} fill={hot ? HI : ink} listening={false} />
    </Group>
  );
  return (
    <Group listening={false}>
      <Circle x={root.x} y={root.y} radius={5} fill={ink} listening={false} />
      {pH.map((ph, i) => {
        const hy = 70 + i * 140;
        const hot = p.focus === i + 1;
        return (
          <Group key={i}>
            {edge(root.x, root.y, 190, hy, num(ph, 3), hot, `h${i}`)}
            <Circle x={190} y={hy} radius={18} fill="#ffffff" stroke={hot ? HI : ink} strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />
            <Text x={172} y={hy - 9} width={36} align="center" text={`H${SUB[i]}`} fontSize={15} {...italic} fill={ink} listening={false} />
            {edge(208, hy, 380, hy - 38, num(pA[i]!, 3), hot, `a${i}`)}
            {edge(208, hy, 380, hy + 38, num(1 - pA[i]!, 3), false, `n${i}`)}
            <Text x={388} y={hy - 46} text={`A:  ${num(ph, 3)}·${num(pA[i]!, 3)} = ${num(r.joint[i]!, 4)}`} fontSize={14} fill={hot ? HI : BAR} listening={false} />
            <Text x={388} y={hy + 30} text={`Ā:  ${num(ph * (1 - pA[i]!), 4)}`} fontSize={14} fill={muted} listening={false} />
          </Group>
        );
      })}
      <Lines
        x={0}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `Полная вероятность: P(A) = ${pH.map((_, i) => `P(H${SUB[i]})P(A|H${SUB[i]})`).join(' + ')} = ${num(r.pA, 4)}`,
          Math.abs(r.sumH - 1) > 1e-9 ? `Внимание: P(H₁) + … = ${num(r.sumH, 4)} ≠ 1 — гипотезы должны составлять полную группу` : `Гипотезы — полная группа: ${pH.map((v) => num(v, 3)).join(' + ')} = 1`,
          p.focus >= 1 && p.focus <= p.k
            ? `Формула Байеса: P(H${SUB[p.focus - 1]}|A) = P(H${SUB[p.focus - 1]})P(A|H${SUB[p.focus - 1]}) / P(A) = ${num(r.joint[p.focus - 1]!, 4)} / ${num(r.pA, 4)} = ${num(r.posterior[p.focus - 1]!, 4)}`
            : `Байес (после того как A произошло): ${r.posterior.map((v, i) => `P(H${SUB[i]}|A) = ${num(v, 3)}`).join(',  ')}`,
          'На ветвях — вероятности; вероятность пути — произведение вероятностей на нём',
        ]}
      />
    </Group>
  );
}

const PH_FIELDS = [1, 2, 3, 4].flatMap((i) => [
  { kind: 'number' as const, key: `p${i}`, label: `P(H${SUB[i - 1]})`, min: 0, max: 1, step: 0.05 },
  { kind: 'number' as const, key: `a${i}`, label: `P(A|H${SUB[i - 1]})`, min: 0, max: 1, step: 0.05 },
]);

export const treeModule: ObjectModule<TreeProps, ReactNode> = {
  type: TREE_TYPE,
  title: 'Дерево вероятностей',
  version: 1,
  propsSchema: treePropsSchema,
  createProps: () => ({ k: 3, p1: 0.3, p2: 0.5, p3: 0.2, p4: 0, a1: 0.9, a2: 0.8, a3: 0.6, a4: 0.5, focus: 1 }),
  deserialize: (r) => r as unknown as BoardObject<TreeProps>,
  ...boxed((p) => ({ x: -10, y: -122, width: 640, height: 140 * p.k + 130 })),
  render: (o, ctx) => <TreeShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'number', key: 'k', label: 'Гипотез', min: 2, max: 4, step: 1, slider: true },
    { kind: 'number', key: 'focus', label: 'Байес для Hᵢ (0 — все)', min: 0, max: 4, step: 1 },
    ...PH_FIELDS,
  ],
} as ObjectModule<TreeProps, ReactNode>;

// =====================================================================
//  Распределения
// =====================================================================

export const distPropsSchema = z.object({
  kind: z.enum(['binomial', 'poisson', 'normal', 'uniform']),
  n: z.number().int().min(1).max(200),
  p: prob01,
  lambda: z.number().finite().min(0.01).max(100),
  mu: z.number().finite().min(-1e6).max(1e6),
  sigma: z.number().finite().min(1e-6).max(1e6),
  a: z.number().finite().min(-1e6).max(1e6),
  b: z.number().finite().min(-1e6).max(1e6),
  /** Интервал для P(lo ≤ X ≤ hi). */
  lo: z.number().finite().min(-1e6).max(1e6),
  hi: z.number().finite().min(-1e6).max(1e6),
});
export type DistProps = z.infer<typeof distPropsSchema>;
const DW = 460;
const DH = 220;
const DIST_TITLE: Record<DistKind, string> = { binomial: 'Биномиальное', poisson: 'Пуассона', normal: 'Нормальное', uniform: 'Равномерное' };

function DistShape({ o, ctx }: { o: BoardObject<DistProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const d = distribution(p.kind, p);
  if (p.kind === 'uniform' && !(p.b > p.a)) return <Text text="Ошибка: нужно a < b" fontSize={15} fill={RED} listening={false} />;
  const X = (v: number) => ((v - d.xMin) / (d.xMax - d.xMin)) * DW;
  const lo = Math.min(p.lo, p.hi);
  const hi = Math.max(p.lo, p.hi);
  const P = d.prob(lo, hi);
  let yMax = 0;
  const ks: number[] = [];
  if (d.discrete) for (let k = d.xMin; k <= d.xMax; k++) (ks.push(k), (yMax = Math.max(yMax, d.f(k))));
  else for (let i = 0; i <= 200; i++) yMax = Math.max(yMax, d.f(d.xMin + ((d.xMax - d.xMin) * i) / 200));
  yMax = yMax * 1.15 || 1;
  const Y = (v: number) => DH - (v / yMax) * DH;
  const xs = niceStep((d.xMax - d.xMin) / 8);
  const labels: number[] = [];
  for (let v = Math.ceil(d.xMin / xs) * xs; v <= d.xMax + 1e-9; v += xs) labels.push(Math.round(v / xs) * xs);
  const bw = Math.max(1, (DW / (d.xMax - d.xMin + 1)) * 0.8);
  const curve = Array.from({ length: 241 }, (_, i) => d.xMin + ((d.xMax - d.xMin) * i) / 240);
  const shade = curve.filter((x) => x >= lo && x <= hi);
  return (
    <Group listening={false}>
      <Axes w={DW} h={DH} yMax={yMax} ink={ink} muted={muted} xLabel="x" yLabel={d.discrete ? 'P(X = k)' : 'f(x)'} />
      {labels.map((v) => (
        <Text key={v} x={X(v) - 20} y={DH + 4} width={40} align="center" text={num(v, 4)} fontSize={11} fill={muted} listening={false} />
      ))}
      {d.discrete
        ? ks.map((k) => <KRect key={k} x={X(k) - bw / 2} y={Y(d.f(k))} width={bw} height={DH - Y(d.f(k))} fill={k >= lo && k <= hi ? HI : BAR} opacity={0.8} listening={false} />)
        : (
          <Group>
            {shade.length > 1 && <Line points={[X(shade[0]!), DH, ...shade.flatMap((x) => [X(x), Y(d.f(x))]), X(shade[shade.length - 1]!), DH]} closed fill={HI} opacity={0.35} listening={false} />}
            <Line points={curve.flatMap((x) => [X(x), Y(d.f(x))])} stroke={BAR} strokeWidth={2.2} strokeScaleEnabled={false} listening={false} />
          </Group>
        )}
      <Line points={[X(d.E), 0, X(d.E), DH]} stroke={RED} strokeWidth={1.2} dash={[5, 4]} strokeScaleEnabled={false} listening={false} />
      <Text x={X(d.E) + 4} y={2} text="E" fontSize={13} {...italic} fill={RED} listening={false} />
      <Lines
        x={-40}
        y={-100}
        ink={ink}
        muted={muted}
        lines={[
          `${DIST_TITLE[p.kind]} распределение: ${p.kind === 'binomial' ? `n = ${p.n}, p = ${num(p.p, 3)}` : p.kind === 'poisson' ? `λ = ${num(p.lambda, 4)}` : p.kind === 'normal' ? `μ = ${num(p.mu, 4)}, σ = ${num(p.sigma, 4)}` : `a = ${num(p.a, 4)}, b = ${num(p.b, 4)}`}`,
          d.formula,
          `E = ${num(d.E, 4)},  D = ${num(d.D, 4)},  σ = ${num(Math.sqrt(d.D), 4)}`,
          `P(${num(lo, 4)} ≤ X ≤ ${num(hi, 4)}) = ${num(P, 4)} — закрашено`,
        ]}
      />
    </Group>
  );
}

export const distModule: ObjectModule<DistProps, ReactNode> = {
  type: DIST_TYPE,
  title: 'Распределение случайной величины',
  version: 1,
  propsSchema: distPropsSchema,
  createProps: () => ({ kind: 'binomial', n: 10, p: 0.5, lambda: 3, mu: 5, sigma: 1.5, a: 2, b: 8, lo: 4, hi: 6 }),
  deserialize: (r) => r as unknown as BoardObject<DistProps>,
  ...boxed(() => ({ x: -50, y: -104, width: DW + 110, height: DH + 128 })),
  render: (o, ctx) => <DistShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'select', key: 'kind', label: 'Распределение', options: (Object.keys(DIST_TITLE) as DistKind[]).map((v) => ({ value: v, label: DIST_TITLE[v] })) },
    { kind: 'number', key: 'lo', label: 'Интервал от', min: -1e6, max: 1e6, step: 1 },
    { kind: 'number', key: 'hi', label: 'до', min: -1e6, max: 1e6, step: 1 },
    { kind: 'number', key: 'n', label: 'n', min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'p', label: 'p', min: 0, max: 1, step: 0.05, slider: true },
    { kind: 'number', key: 'lambda', label: 'λ', min: 0.01, max: 100, step: 0.5 },
    { kind: 'number', key: 'mu', label: 'μ', min: -1e6, max: 1e6, step: 1 },
    { kind: 'number', key: 'sigma', label: 'σ', min: 1e-6, max: 1e6, step: 0.5 },
    { kind: 'number', key: 'a', label: 'a', min: -1e6, max: 1e6, step: 1 },
    { kind: 'number', key: 'b', label: 'b', min: -1e6, max: 1e6, step: 1 },
  ],
} as ObjectModule<DistProps, ReactNode>;

// =====================================================================
//  Статистика по данным
// =====================================================================

export const statsPropsSchema = z.object({
  data: z.string().max(4000),
  chart: z.enum(['hist', 'bar', 'pie', 'box']),
  bins: z.number().int().min(2).max(20),
});
export type StatsProps = z.infer<typeof statsPropsSchema>;
const SW = 460;
const SH = 200;
const CHART_TITLE = { hist: 'Гистограмма', bar: 'Столбчатая диаграмма частот', pie: 'Круговая диаграмма', box: 'Ящик с усами' };

function StatsShape({ o, ctx }: { o: BoardObject<StatsProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const data = parseData(p.data);
  if ('error' in data) return <Text text={`Ошибка в данных: ${data.error}`} fontSize={15} fill={RED} listening={false} />;
  const s = stats(data);
  let chart: ReactNode = null;
  if (p.chart === 'hist') {
    const h = histogram(data, p.bins);
    const top = Math.max(...h.map((b) => b.count));
    const w = SW / h.length;
    chart = (
      <Group>
        <Axes w={SW} h={SH} yMax={top * 1.15} ink={ink} muted={muted} xLabel="x" yLabel="частота" />
        {h.map((b, i) => (
          <Group key={i}>
            <KRect x={i * w} y={SH - (b.count / (top * 1.15)) * SH} width={w} height={(b.count / (top * 1.15)) * SH} fill={BAR} opacity={0.7} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            <Text x={i * w - 20} y={SH + 4} width={40} align="center" text={num(b.from, 3)} fontSize={11} fill={muted} listening={false} />
          </Group>
        ))}
        <Text x={SW - 20} y={SH + 4} width={40} align="center" text={num(s.max, 3)} fontSize={11} fill={muted} listening={false} />
      </Group>
    );
  } else if (p.chart === 'bar') {
    const vals = s.values.slice(0, 30);
    const top = Math.max(...s.counts);
    const w = SW / vals.length;
    chart = (
      <Group>
        <Axes w={SW} h={SH} yMax={top * 1.15} ink={ink} muted={muted} xLabel="значение" yLabel="частота" />
        {vals.map((v, i) => (
          <Group key={v}>
            <KRect x={i * w + w * 0.15} y={SH - (s.counts[i]! / (top * 1.15)) * SH} width={w * 0.7} height={(s.counts[i]! / (top * 1.15)) * SH} fill={s.modes.includes(v) ? HI : BAR} opacity={0.8} listening={false} />
            <Text x={i * w} y={SH + 4} width={w} align="center" text={num(v, 4)} fontSize={11} fill={ink} listening={false} />
          </Group>
        ))}
        {s.values.length > 30 && <Text x={0} y={SH + 20} text={`показаны первые 30 из ${s.values.length} значений`} fontSize={11} fill={muted} listening={false} />}
      </Group>
    );
  } else if (p.chart === 'pie') {
    if (s.values.length > 12) chart = <Text text="Для круговой диаграммы слишком много разных значений (больше 12) — выберите гистограмму" fontSize={13} fill={muted} listening={false} />;
    else {
      let acc = -90;
      chart = (
        <Group x={110} y={SH / 2}>
          {s.values.map((v, i) => {
            const ang = (s.counts[i]! / s.n) * 360;
            const mid = ((acc + ang / 2) * Math.PI) / 180;
            const node = (
              <Group key={v}>
                <Wedge rotation={acc} angle={ang} radius={95} fill={PALETTE[i % PALETTE.length]} stroke="#ffffff" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
                {ang > 14 && <Text x={Math.cos(mid) * 62 - 24} y={Math.sin(mid) * 62 - 7} width={48} align="center" text={`${num((s.counts[i]! / s.n) * 100, 3)} %`} fontSize={12} fill="#ffffff" listening={false} />}
                <KRect x={140} y={-90 + i * 16} width={11} height={11} fill={PALETTE[i % PALETTE.length]} listening={false} />
                <Text x={156} y={-91 + i * 16} text={`${num(v, 4)} — ${s.counts[i]} (${num((s.counts[i]! / s.n) * 100, 3)} %)`} fontSize={12} fill={ink} listening={false} />
              </Group>
            );
            acc += ang;
            return node;
          })}
        </Group>
      );
    }
  } else {
    const pad = (s.range || 1) * 0.08;
    const lo = s.min - pad;
    const hi = s.max + pad;
    const X = (v: number) => ((v - lo) / (hi - lo)) * SW;
    const cy = SH / 2;
    const xs = niceStep((hi - lo) / 8);
    const marks: number[] = [];
    for (let v = Math.ceil(lo / xs) * xs; v <= hi; v += xs) marks.push(Math.round(v / xs) * xs);
    chart = (
      <Group>
        <Line points={[0, SH, SW, SH]} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
        {marks.map((v) => (
          <Group key={v}>
            <Line points={[X(v), SH - 4, X(v), SH + 4]} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            <Text x={X(v) - 20} y={SH + 6} width={40} align="center" text={num(v, 4)} fontSize={11} fill={muted} listening={false} />
          </Group>
        ))}
        <Line points={[X(s.min), cy, X(s.q1), cy]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        <Line points={[X(s.q3), cy, X(s.max), cy]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        <Line points={[X(s.min), cy - 18, X(s.min), cy + 18]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        <Line points={[X(s.max), cy - 18, X(s.max), cy + 18]} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        <KRect x={X(s.q1)} y={cy - 36} width={Math.max(1, X(s.q3) - X(s.q1))} height={72} fill={BAR} opacity={0.25} stroke={BAR} strokeWidth={1.8} strokeScaleEnabled={false} listening={false} />
        <Line points={[X(s.median), cy - 36, X(s.median), cy + 36]} stroke={HI} strokeWidth={2.6} strokeScaleEnabled={false} listening={false} />
        <Arc x={X(s.mean)} y={cy} innerRadius={0} outerRadius={5} angle={360} fill={RED} listening={false} />
        {[['min', s.min], ['Q₁', s.q1], ['медиана', s.median], ['Q₃', s.q3], ['max', s.max]].map(([label, v], i) => (
          <Text key={label as string} x={X(v as number) - 30} y={i % 2 ? cy + 42 : cy - 56} width={60} align="center" text={`${label} ${num(v as number, 4)}`} fontSize={11} fill={ink} listening={false} />
        ))}
      </Group>
    );
  }
  return (
    <Group listening={false}>
      {chart}
      <Lines
        x={-40}
        y={-138}
        ink={ink}
        muted={muted}
        lines={[
          `${CHART_TITLE[p.chart]};  n = ${s.n}`,
          `Среднее x̄ = ${num(s.mean)},  медиана = ${num(s.median)},  мода = ${s.modes.length ? s.modes.map((v) => num(v)).join('; ') : 'нет'}`,
          `min = ${num(s.min)},  max = ${num(s.max)},  размах = ${num(s.range)}`,
          `Дисперсия D = Σ(xᵢ − x̄)²/n = ${num(s.variance)},  σ = √D = ${num(s.sd)}`,
          p.chart === 'box' ? `Квартили: Q₁ = ${num(s.q1)}, Q₃ = ${num(s.q3)};  в «ящике» — средняя половина данных, красная точка — среднее` : 'Данные — в панели свойств: числа через пробел, «;» или «, »',
        ]}
      />
    </Group>
  );
}

export const statsModule: ObjectModule<StatsProps, ReactNode> = {
  type: STATS_TYPE,
  title: 'Статистика по данным',
  version: 1,
  propsSchema: statsPropsSchema,
  createProps: () => ({ data: '5, 4, 3, 5, 4, 5, 2, 4, 5, 3, 4, 4, 5, 3, 4', chart: 'bar', bins: 5 }),
  deserialize: (r) => r as unknown as BoardObject<StatsProps>,
  ...boxed(() => ({ x: -50, y: -142, width: SW + 110, height: SH + 180 })),
  render: (o, ctx) => <StatsShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'data', label: 'Данные', maxLength: 4000 },
    { kind: 'select', key: 'chart', label: 'Диаграмма', options: (Object.keys(CHART_TITLE) as (keyof typeof CHART_TITLE)[]).map((v) => ({ value: v, label: CHART_TITLE[v] })) },
    { kind: 'number', key: 'bins', label: 'Интервалов', min: 2, max: 20, step: 1, slider: true },
  ],
} as ObjectModule<StatsProps, ReactNode>;

export const probModules = [experimentModule, treeModule, distModule, statsModule];
