import type { ReactNode } from 'react';
import { Circle, Group, Line, Rect as KRect, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { fmt } from '../common/quantities';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { playText } from '../mechanics/objects';
import { Info, PLAY_ONLY, boxed, num, useZoom } from '../waves/objects';
import { Plot, type PlotPoint, niceMax, valueText } from '../common/plot';
import { GASES, PROCESS_TITLE, R, type PV, type ProcessKind, type Segment, bounce, carnotCycle, cycleInfo, gasState, processInfo, rectCycle, sci, seeded, triangleCycle } from './thermo';

export const PLUGIN_ID = 'physics.thermo';
export const GAS_TYPE = `${PLUGIN_ID}.gas`;
export const PROCESS_TYPE = `${PLUGIN_ID}.process`;
export const CYCLE_TYPE = `${PLUGIN_ID}.cycle`;

const C1 = '#2563eb';
const C2 = '#d13a3a';
const CUR = '#ea580c';
const WORK = '#16a34a';

// =====================================================================
//  Газ в цилиндре с поршнем
// =====================================================================

const gasKeys = Object.keys(GASES) as [string, ...string[]];
export const gasPropsSchema = z.object({
  gas: z.enum(gasKeys),
  /** Количество вещества, моль; объём, л; температура, К. */
  nu: z.number().finite().min(0.001).max(1000),
  V: z.number().finite().min(1).max(50),
  T: z.number().finite().min(10).max(3000),
  /** Что постоянно, когда поршень двигают мышью: температура или давление. */
  hold: z.enum(['T', 'p']),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type GasProps = z.infer<typeof gasPropsSchema>;

const CH = 170;
const MOL = 40;
const MR = 5;
const GAS_END = 3600;
const cylLen = (V: number) => 60 + V * 8;
const gasBox = () => ({ x: -10, y: -104, width: cylLen(50) + 110, height: CH + 120 });

function GasShape({ o, ctx }: { o: BoardObject<GasProps>; ctx: RenderContext }) {
  const p = o.props;
  const zoom = useZoom();
  const g = GASES[p.gas]!;
  const st = gasState(g, p.nu, p.V * 1e-3, p.T);
  const t = usePlayTime(p.play, GAS_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const L = cylLen(p.V);
  const W = L - 2 * MR;
  const H = CH - 2 * MR;
  // Скорость на рисунке пропорциональна средней квадратичной: √T/√M.
  const pxs = Math.min(st.vrms * 0.15, 600);
  const mols = Array.from({ length: MOL }, (_, j) => {
    const r = seeded(j + 1);
    const x0 = r() * W;
    const y0 = r() * H;
    const a = r() * 2 * Math.PI;
    const f = 0.35 + r() * 1.3;
    return { x: MR + bounce(x0 + Math.cos(a) * f * pxs * t, W), y: MR + bounce(y0 + Math.sin(a) * f * pxs * t, H), f };
  });
  const heat = Math.max(0, Math.min(1, (p.T - 200) / 800));
  return (
    <Group listening={false}>
      <KRect x={0} y={0} width={L} height={CH} fill={`rgba(${Math.round(80 + 175 * heat)}, ${Math.round(140 - 60 * heat)}, ${Math.round(235 - 175 * heat)}, 0.12)`} listening={false} />
      <Line points={[L + 30, 0, 0, 0, 0, CH, L + 30, CH]} stroke={ink} strokeWidth={3} strokeScaleEnabled={false} listening={false} />
      <Line points={[L + 30, 0, cylLen(50) + 30, 0]} stroke={muted} strokeWidth={1} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Line points={[L + 30, CH, cylLen(50) + 30, CH]} stroke={muted} strokeWidth={1} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      {mols.map((m, j) => (
        <Circle key={j} x={m.x} y={m.y} radius={MR} fill={m.f < 0.75 ? '#3b82f6' : m.f > 1.3 ? '#ef4444' : '#f59e0b'} listening={false} />
      ))}
      <KRect x={L} y={2} width={14} height={CH - 4} fill={ctx.resolveColor('muted')} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      <KRect x={L + 14} y={CH / 2 - 4} width={70} height={8} fill={ctx.resolveColor('muted')} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text x={L / 2 - 30} y={CH + 8} width={60} align="center" text={`V = ${fmt(p.V, 1)} л`} fontSize={14} fill={ink} listening={false} />
      <Text x={L + 20} y={CH / 2 + 10} text="поршень" fontSize={12} fill={muted} listening={false} />
      <Info
        x={0}
        y={-100}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${g.title}: ν = ${fmt(p.nu, 3)} моль, M = ${fmt(g.M * 1000, 1)} г/моль, T = ${fmt(p.T, 0)} К (${fmt(p.T - 273, 0)} °C)`,
          `pV = νRT:  p = νRT/V = ${sci(st.p / 1000)} кПа,  ρ = m/V = ${sci(st.rho)} кг/м³`,
          `v_кв = √(3RT/M) = ${fmt(st.vrms, 0)} м/с,  Eₖ = (3/2)kT = ${sci(st.ek)} Дж`,
          `n = N/V = ${sci(st.n)} м⁻³,  U = (${g.i}/2)νRT = ${sci(st.U)} Дж${g.i === 3 ? ' (одноатомный)' : ' (двухатомный)'}`,
        ]}
      />
    </Group>
  );
}

export const gasModule: ObjectModule<GasProps, ReactNode> = {
  type: GAS_TYPE,
  title: 'Газ в цилиндре',
  version: 1,
  propsSchema: gasPropsSchema,
  createProps: () => ({ gas: 'N2', nu: 1, V: 25, T: 300, hold: 'T', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<GasProps>,
  ...boxed(gasBox),
  // Поршень тянется без выделения: объём меняется при постоянной T или p.
  hitPriority: 1,
  getHandles: (o) => [{ id: 'piston', kind: 'param', position: toWorld(o, { x: cylLen(o.props.V) + 7, y: CH / 2 }), label: 'Поршень: объём V', snap: false }],
  dragHandle: (o, id, to) => {
    if (id !== 'piston') return null;
    const p = o.props;
    const V = Math.round(Math.max(1, Math.min(50, (toLocal(o, to).x - 7 - 60) / 8)) * 10) / 10;
    if (p.hold === 'T') return { props: { V } };
    // Изобарно: T = pV/(νR) при прежнем давлении; температура в допустимых пределах.
    const T = Math.max(10, Math.min(3000, (p.T * V) / p.V));
    return { props: { V: Math.round(((T * p.V) / p.T) * 10) / 10, T: Math.round(T * 10) / 10 } };
  },
  render: (o, ctx) => <GasShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_ONLY,
    { kind: 'select', key: 'gas', label: 'Газ', options: Object.entries(GASES).map(([value, g]) => ({ value, label: g.title })) },
    num('nu', 'ν, моль', 0.001, 1000, 0.1),
    num('V', 'V, л', 1, 50, 0.5, true),
    num('T', 'T, К', 10, 3000, 10, true),
    { kind: 'select', key: 'hold', label: 'Поршень двигается', options: [{ value: 'T', label: 'при T = const' }, { value: 'p', label: 'при p = const' }] },
  ],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, GAS_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<GasProps>(o.id, { props: { play } });
  },
} as ObjectModule<GasProps, ReactNode>;

// =====================================================================
//  Общее для диаграмм: оси pV, pT, VT
// =====================================================================

type Axes = 'pV' | 'pT' | 'VT';
const AXES: Record<Axes, { x: string; y: string; xs: (s: PV, nuR: number) => number; ys: (s: PV, nuR: number) => number; xu: string; yu: string }> = {
  pV: { x: 'V, л', y: 'p, кПа', xs: (s) => s.V, ys: (s) => s.p, xu: 'л', yu: 'кПа' },
  pT: { x: 'T, К', y: 'p, кПа', xs: (s, n) => (s.p * s.V) / n, ys: (s) => s.p, xu: 'К', yu: 'кПа' },
  VT: { x: 'T, К', y: 'V, л', xs: (s, n) => (s.p * s.V) / n, ys: (s) => s.V, xu: 'К', yu: 'л' },
};
const DW = 380;
const DH = 260;
const sample = (f: (s: number) => PV, n = 120) => Array.from({ length: n + 1 }, (_, k) => f(k / n));

// =====================================================================
//  Изопроцесс
// =====================================================================

export const processPropsSchema = z.object({
  kind: z.enum(['T', 'p', 'V', 'Q']),
  axes: z.enum(['pV', 'pT', 'VT']),
  nu: z.number().finite().min(0.001).max(1000),
  /** Начальное состояние: кПа и л (тогда pV — в джоулях). */
  p1: z.number().finite().min(0.1).max(1e5),
  V1: z.number().finite().min(0.01).max(1e5),
  /** V₂/V₁, а для изохорного процесса — T₂/T₁. */
  ratio: z.number().finite().min(0.2).max(5),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type ProcessProps = z.infer<typeof processPropsSchema>;
const PROC_END = 6;
const procBox = () => ({ x: -80, y: -112, width: DW + 160, height: DH + 150 });

function ProcessShape({ o, ctx }: { o: BoardObject<ProcessProps>; ctx: RenderContext }) {
  const p = o.props;
  const t = usePlayTime(p.play, PROC_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const info = processInfo(p.kind as ProcessKind, p.p1, p.V1, p.ratio);
  const nuR = p.nu * R;
  const ax = AXES[p.axes];
  const states = sample(info.at);
  const xy = (s: PV): [number, number] => [ax.xs(s, nuR), ax.ys(s, nuR)];
  const pts = states.map(xy);
  const xMax = niceMax(Math.max(...pts.map((q) => q[0])) * 1.2);
  const yMax = niceMax(Math.max(...pts.map((q) => q[1])) * 1.2);
  const s1 = info.at(0);
  const s2 = info.at(1);
  const cur = info.at(t / PROC_END);
  const T = (s: PV) => (s.p * s.V) / nuR;
  const point = (s: PV, label: string, color: string): PlotPoint => {
    const [x, y] = xy(s);
    return { x, y, label, color, guides: true, xText: valueText(x), yText: valueText(y) };
  };
  const fills = p.axes === 'pV' && p.kind !== 'V' ? [{ pts: [[s1.V, 0] as [number, number], ...pts, [s2.V, 0] as [number, number]], color: WORK }] : [];
  return (
    <Group listening={false}>
      <Plot x={0} y={0} w={DW} h={DH} xMax={xMax} yMax={yMax} curves={[{ pts, color: C1, arrow: true, width: 2.4 }]} fills={fills} points={[point(s1, '1', ink), point(s2, '2', ink), { ...point(cur, '', CUR), guides: false }]} xLabel={ax.x} yLabel={ax.y} ink={ink} />
      <Info
        x={-70}
        y={-108}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${PROCESS_TITLE[p.kind as ProcessKind]} процесс, ν = ${fmt(p.nu, 3)} моль одноатомного газа:  ${info.law}`,
          `1: p = ${valueText(s1.p)} кПа, V = ${valueText(s1.V)} л, T = ${valueText(T(s1))} К    2: p = ${valueText(s2.p)} кПа, V = ${valueText(s2.V)} л, T = ${valueText(T(s2))} К`,
          `Сейчас: p = ${valueText(cur.p)} кПа, V = ${valueText(cur.V)} л, T = ${valueText(T(cur))} К`,
          `A = ${sci(info.A)} Дж${p.axes === 'pV' && p.kind !== 'V' ? ' (площадь под графиком)' : ''},  ΔU = ${sci(info.dU)} Дж,  Q = ΔU + A = ${sci(info.Q)} Дж`,
        ]}
      />
    </Group>
  );
}

export const processModule: ObjectModule<ProcessProps, ReactNode> = {
  type: PROCESS_TYPE,
  title: 'Изопроцесс',
  version: 1,
  propsSchema: processPropsSchema,
  createProps: () => ({ kind: 'T', axes: 'pV', nu: 1, p1: 200, V1: 10, ratio: 2.5, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<ProcessProps>,
  ...boxed(procBox),
  render: (o, ctx) => <ProcessShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_ONLY,
    { kind: 'select', key: 'kind', label: 'Процесс', options: (['T', 'p', 'V', 'Q'] as const).map((k) => ({ value: k, label: PROCESS_TITLE[k] })) },
    { kind: 'select', key: 'axes', label: 'Оси', options: [{ value: 'pV', label: 'p(V)' }, { value: 'pT', label: 'p(T)' }, { value: 'VT', label: 'V(T)' }] },
    num('p1', 'p₁, кПа', 0.1, 1e5, 10),
    num('V1', 'V₁, л', 0.01, 1e5, 1),
    num('ratio', 'V₂/V₁ (изохора: T₂/T₁)', 0.2, 5, 0.1, true),
    num('nu', 'ν, моль', 0.001, 1000, 0.1),
  ],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, PROC_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<ProcessProps>(o.id, { props: { play } });
  },
} as ObjectModule<ProcessProps, ReactNode>;

// =====================================================================
//  Цикл: работа за цикл, КПД, сравнение с циклом Карно
// =====================================================================

export const cyclePropsSchema = z.object({
  preset: z.enum(['rect', 'triangle', 'carnot']),
  nu: z.number().finite().min(0.001).max(1000),
  p1: z.number().finite().min(0.1).max(1e5),
  p2: z.number().finite().min(0.1).max(1e5),
  V1: z.number().finite().min(0.01).max(1e5),
  V2: z.number().finite().min(0.01).max(1e5),
  /** Температуры нагревателя и холодильника для цикла Карно, К. */
  T1: z.number().finite().min(1).max(1e5),
  T2: z.number().finite().min(1).max(1e5),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type CycleProps = z.infer<typeof cyclePropsSchema>;
const SEG_TIME = 2;
const CYCLE_TITLE = { rect: 'Цикл из двух изохор и двух изобар', triangle: 'Треугольный цикл', carnot: 'Цикл Карно' };
const cycleBox = () => ({ x: -80, y: -112, width: DW + 470, height: DH + 150 });

export function cycleSegments(p: CycleProps): Segment[] {
  if (p.preset === 'rect') return rectCycle(p.p1, p.p2, p.V1, p.V2);
  if (p.preset === 'triangle') return triangleCycle(p.p1, p.p2, p.V1, p.V2);
  return carnotCycle(p.nu * R * p.T1, p.nu * R * p.T2, p.V1, p.V2);
}

/** Точка на цикле в момент t: участки проходятся за равное время. */
const cycleAt = (segs: Segment[], t: number): PV => {
  const k = Math.min(segs.length - 1, Math.floor(t / SEG_TIME));
  return segs[k]!.at(Math.min(1, t / SEG_TIME - k));
};

function CycleShape({ o, ctx }: { o: BoardObject<CycleProps>; ctx: RenderContext }) {
  const p = o.props;
  const segs = cycleSegments(p);
  const tEnd = segs.length * SEG_TIME;
  const t = usePlayTime(p.play, tEnd, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const ci = cycleInfo(segs, 800);
  const nuR = p.nu * R;
  const paths = segs.map((s) => sample(s.at, 60).map((q) => [q.V, q.p] as [number, number]));
  const all = paths.flat();
  const xMax = niceMax(Math.max(...all.map((q) => q[0])) * 1.2);
  const yMax = niceMax(Math.max(...all.map((q) => q[1])) * 1.2);
  const cur = t > 0 && t < tEnd ? cycleAt(segs, t) : null;
  const vertices: PlotPoint[] = segs.map((s, i) => {
    const v = s.at(0);
    return { x: v.V, y: v.p, label: String(i + 1), color: ink, guides: true, xText: valueText(v.V), yText: valueText(v.p) };
  });
  const tMax = ci.pvMax / nuR;
  const tMin = ci.pvMin / nuR;
  const reverse = ci.A <= 0;
  return (
    <Group listening={false}>
      <Plot
        x={0}
        y={0}
        w={DW}
        h={DH}
        xMax={xMax}
        yMax={yMax}
        curves={paths.map((pts, i) => ({ pts, color: (ci.perSegment[i] ?? 0) >= 0 ? C2 : C1, arrow: true, width: 2.4 }))}
        fills={[{ pts: all, color: WORK }]}
        points={[...vertices, ...(cur ? [{ x: cur.V, y: cur.p, color: CUR }] : [])]}
        xLabel="V, л"
        yLabel="p, кПа"
        ink={ink}
      />
      <Info
        x={-70}
        y={-108}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${CYCLE_TITLE[p.preset]}, ν = ${fmt(p.nu, 3)} моль одноатомного газа`,
          `A = площадь цикла = ${sci(ci.A)} Дж${reverse ? ' — обход против часовой стрелки: работа газа отрицательна' : ''}`,
          `Q₁ (от нагревателя) = ${sci(ci.Qin)} Дж,  Q₂ (холодильнику) = ${sci(ci.Qout)} Дж`,
          reverse ? 'КПД не определяется: это не тепловой двигатель' : `η = A/Q₁ = ${fmt(ci.eta * 100, 1)} %;  Карно при T от ${fmt(tMin, 0)} до ${fmt(tMax, 0)} К: 1 − T₂/T₁ = ${fmt((1 - tMin / tMax) * 100, 1)} %`,
        ]}
      />
      <Group x={DW + 70} y={10} listening={false}>
        <Text text="Участки (красным — газ получает тепло):" fontSize={14} fill={ink} listening={false} />
        {segs.map((s, i) => (
          <Text key={i} y={26 + i * 22} text={`${s.name}:  Q = ${sci(ci.perSegment[i] ?? 0)} Дж`} fontSize={13} fill={(ci.perSegment[i] ?? 0) >= 0 ? C2 : C1} listening={false} />
        ))}
        <Text y={36 + segs.length * 22} text="Q = ΔU + A,  ΔU = (3/2)Δ(pV)" fontSize={13} fill={muted} listening={false} />
      </Group>
    </Group>
  );
}

export const cycleModule: ObjectModule<CycleProps, ReactNode> = {
  type: CYCLE_TYPE,
  title: 'Цикл тепловой машины',
  version: 1,
  propsSchema: cyclePropsSchema,
  createProps: () => ({ preset: 'rect', nu: 1, p1: 100, p2: 300, V1: 10, V2: 30, T1: 600, T2: 300, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<CycleProps>,
  ...boxed(cycleBox),
  render: (o, ctx) => <CycleShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_ONLY,
    { kind: 'select', key: 'preset', label: 'Цикл', options: [{ value: 'rect', label: 'Две изохоры и две изобары' }, { value: 'triangle', label: 'Треугольный' }, { value: 'carnot', label: 'Карно' }] },
    num('p1', 'p₁, кПа', 0.1, 1e5, 10),
    num('p2', 'p₂, кПа', 0.1, 1e5, 10),
    num('V1', 'V₁, л', 0.01, 1e5, 1),
    num('V2', 'V₂, л', 0.01, 1e5, 1),
    num('T1', 'Карно: T₁, К', 1, 1e5, 10),
    num('T2', 'Карно: T₂, К', 1, 1e5, 10),
    num('nu', 'ν, моль', 0.001, 1000, 0.1),
  ],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, cycleSegments(o.props).length * SEG_TIME, o.props.speed, ctx.now);
    if (play) ctx.updateObject<CycleProps>(o.id, { props: { play } });
  },
} as ObjectModule<CycleProps, ReactNode>;

export const gasModules = [gasModule, processModule, cycleModule];
