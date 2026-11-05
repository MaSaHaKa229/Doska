import { type ReactNode, useMemo } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { Plot } from '../common/plot';
import { fmt, sci, seeded } from '../common/quantities';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { playText } from '../mechanics/objects';
import { Info, PLAY_ONLY, boxed, num, useZoom } from '../waves/objects';
import { PLUGIN_ID } from './objects';
import { ELEMENT_TITLE, MASSES, M_H, M_N, type Nuclide, RADIOACTIVE, SERIES, U_MEV, binding, closest, daughter, level, lifetime, orbit, parseReaction, remaining, scatterAngle, symbolOf, trajectory, transition, zOf } from './nuclear';
import { wavelengthColor } from './quantum';

export const BOHR_TYPE = `${PLUGIN_ID}.bohr`;
export const RUTHERFORD_TYPE = `${PLUGIN_ID}.rutherford`;
export const NUCLEUS_TYPE = `${PLUGIN_ID}.nucleus`;
export const DECAY_TYPE = `${PLUGIN_ID}.decay`;
export const REACTION_TYPE = `${PLUGIN_ID}.reaction`;

const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const ELECTRON = '#2563eb';
const PROTON = '#d13a3a';
const NEUTRON = '#9ca3af';
const HI = '#ea580c';
const OK = '#16a34a';

const elementName = (Z: number) => ELEMENT_TITLE[symbolOf(Z)] ?? symbolOf(Z);
const photonColor = (nm: number) => wavelengthColor(nm) ?? (nm < 380 ? '#8b5cf6' : '#b91c1c');

/** Обозначение нуклида: массовое число сверху, зарядовое снизу, слева от символа. */
export function NuclideLabel({ x, y, A, Z, sym, size = 26, color, count = 1 }: { x: number; y: number; A: number | null; Z: number | null; sym: string; size?: number; color: string; count?: number }) {
  const pre = count > 1 ? `${count}` : '';
  const preW = pre ? pre.length * size * 0.6 + 4 : 0;
  const zs = Z === null ? '' : Z < 0 ? `−${-Z}` : String(Z);
  const nw = Math.max(String(A ?? '').length, zs.length) * size * 0.34 + 2;
  return (
    <Group x={x} y={y} listening={false}>
      {pre && <Text x={0} y={0} text={pre} fontSize={size} fill={color} listening={false} />}
      {A !== null && <Text x={preW} y={-size * 0.18} width={nw} align="right" text={String(A)} fontSize={size * 0.55} fill={color} listening={false} />}
      {Z !== null && <Text x={preW} y={size * 0.62} width={nw} align="right" text={zs} fontSize={size * 0.55} fill={color} listening={false} />}
      <Text x={preW + nw + 2} y={0} text={sym} fontSize={size} fill={color} listening={false} />
    </Group>
  );
}

export function nuclideWidth(A: number | null, Z: number | null, sym: string, size: number, count = 1): number {
  const preW = count > 1 ? String(count).length * size * 0.6 + 4 : 0;
  const zs = Z === null ? '' : Z < 0 ? `−${-Z}` : String(Z);
  const nw = Math.max(String(A ?? '').length, zs.length) * size * 0.34 + 2;
  return preW + nw + 2 + sym.length * size * 0.62;
}

/** Как записывать частицу в уравнении: α — ⁴₂He, p — ¹₁p, γ — без чисел. */
function display(n: Nuclide): { A: number | null; Z: number | null; sym: string } {
  if (n.sym === 'α') return { A: 4, Z: 2, sym: 'He' };
  if (n.sym === 'd' || n.sym === 't') return { A: n.A, Z: 1, sym: 'H' };
  if (n.sym === 'γ') return { A: null, Z: null, sym: 'γ' };
  return { A: n.A, Z: n.Z, sym: n.sym };
}

/** Строка уравнения из нуклидов: слева, стрелка, справа. */
function Equation({ x, y, left, right, size, ink, mark }: { x: number; y: number; left: Nuclide[]; right: Nuclide[]; size: number; ink: string; mark?: Nuclide | null }) {
  const items: ReactNode[] = [];
  let cx = 0;
  const put = (arr: Nuclide[]) =>
    arr.forEach((n, i) => {
      if (i) {
        items.push(<Text key={`p${items.length}`} x={cx + 4} y={0} text="+" fontSize={size} fill={ink} listening={false} />);
        cx += size * 0.9 + 8;
      }
      const d = display(n);
      items.push(<NuclideLabel key={`n${items.length}`} x={cx} y={0} {...d} size={size} color={mark === n ? HI : ink} count={n.count} />);
      cx += nuclideWidth(d.A, d.Z, d.sym, size, n.count) + 4;
    });
  put(left);
  items.push(<Text key="arrow" x={cx + 6} y={0} text="→" fontSize={size} fill={ink} listening={false} />);
  cx += size * 1.3 + 12;
  put(right);
  return (
    <Group x={x} y={y} listening={false}>
      {items}
    </Group>
  );
}

// =====================================================================
//  Атом водорода по Бору
// =====================================================================

export const bohrPropsSchema = z.object({
  /** Верхний и нижний уровни перехода. */
  n: z.number().int().min(2).max(7),
  k: z.number().int().min(1).max(6),
  /** Поглощение (k → n) вместо излучения (n → k). */
  absorb: z.boolean(),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type BohrProps = z.infer<typeof bohrPropsSchema>;
const BOHR_END = 5;
const JUMP = 2;
const rDisp = (n: number) => 14 + 21 * (n - 1);
const levelY = (n: number) => 330 / n - 165;

function BohrShape({ o, ctx }: { o: BoardObject<BohrProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const t = usePlayTime(p.play, BOHR_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const k = Math.min(p.k, p.n - 1);
  const tr = transition(p.n, k);
  const col = photonColor(tr.lambda);
  const from = p.absorb ? k : p.n;
  const to = p.absorb ? p.n : k;
  const cur = t < JUMP ? from : to;
  const ang = t * (6 / cur) - Math.PI / 4;
  const ex = Math.cos(ang) * rDisp(cur);
  const ey = Math.sin(ang) * rDisp(cur);
  // Фотон: при излучении улетает после скачка, при поглощении прилетает до скачка.
  const ph = p.absorb ? (t < JUMP ? t / JUMP : null) : t >= JUMP ? (t - JUMP) / (BOHR_END - JUMP) : null;
  const phR = ph === null ? 0 : p.absorb ? 200 - (200 - rDisp(k)) * ph : rDisp(k) + 200 * ph;
  const LX = 230;
  const balmer = [3, 4, 5, 6, 7].map((n) => transition(n, 2).lambda);
  return (
    <Group listening={false}>
      {/* Атом. */}
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <Circle key={n} radius={rDisp(n)} stroke={n === p.n || n === k ? ink : muted} strokeWidth={n === p.n || n === k ? 1.4 : 0.8} dash={n === p.n || n === k ? undefined : [3 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
      ))}
      <Circle radius={5} fill={PROTON} listening={false} />
      <Circle x={ex} y={ey} radius={5} fill={ELECTRON} listening={false} />
      {ph !== null && (
        <Shape
          sceneFunc={(c, shape) => {
            const g = raw(c);
            const a0 = -Math.PI / 4;
            g.beginPath();
            for (let s = 0; s <= 40; s++) {
              const r = phR + s - 20;
              const w = Math.sin(s * 0.9) * 5;
              const x = Math.cos(a0) * r - Math.sin(a0) * w;
              const y = Math.sin(a0) * r + Math.cos(a0) * w;
              if (s) g.lineTo(x, y);
              else g.moveTo(x, y);
            }
            c.strokeShape(shape);
          }}
          stroke={col}
          strokeWidth={2.4}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      <Text x={-120} y={rDisp(7) + 8} width={240} align="center" text="радиусы не в масштабе (rₙ ∝ n²)" fontSize={11} fill={muted} listening={false} />
      {/* Уровни энергии. */}
      <Group x={LX} y={0} listening={false}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <Group key={n}>
            <Line points={[0, levelY(n), 150, levelY(n)]} stroke={n === p.n || n === k ? ink : muted} strokeWidth={n === p.n || n === k ? 2 : 1} strokeScaleEnabled={false} listening={false} />
            {(n <= 4 || n === p.n) && <Text x={156} y={levelY(n) - 7} text={`n = ${n}${n <= 4 || n === p.n ? `   ${fmt(level(n), 2)} эВ` : ''}`} fontSize={11} fill={ink} listening={false} />}
          </Group>
        ))}
        <Line points={[0, -165, 150, -165]} stroke={muted} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
        <Text x={156} y={-172} text="n = ∞   0 эВ" fontSize={11} fill={muted} listening={false} />
        <Arrow points={[75, levelY(from), 75, levelY(to)]} stroke={col} fill={col} strokeWidth={2.5} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />
        <Text x={0} y={180} width={260} text="шкала энергии не линейная" fontSize={11} fill={muted} listening={false} />
      </Group>
      {/* Линейчатый спектр: видимая часть, линии серии Бальмера. */}
      <Group x={-160} y={225} listening={false}>
        <KRect width={560} height={34} fill="#111827" listening={false} />
        {balmer.map((l, i) => (
          <Line key={i} points={[((l - 380) / 380) * 560, 0, ((l - 380) / 380) * 560, 34]} stroke={wavelengthColor(l) ?? '#fff'} strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />
        ))}
        {tr.lambda >= 380 && tr.lambda <= 760 && <Line points={[((tr.lambda - 380) / 380) * 560, -8, ((tr.lambda - 380) / 380) * 560, 0]} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />}
        {[400, 500, 600, 700].map((v) => (
          <Text key={v} x={((v - 380) / 380) * 560 - 20} y={38} width={40} align="center" text={`${v} нм`} fontSize={11} fill={muted} listening={false} />
        ))}
        <Text x={0} y={54} width={560} text={p.absorb ? 'Спектр поглощения — тёмные линии на тех же местах' : 'Линейчатый спектр водорода (серия Бальмера — видимые линии)'} fontSize={12} fill={muted} listening={false} />
      </Group>
      <Info
        x={-160}
        y={-262}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${p.absorb ? `Поглощение: k = ${k} → n = ${p.n}` : `Излучение: n = ${p.n} → k = ${k}`}${p.k >= p.n ? ' (нижний уровень взят на 1 ниже верхнего)' : ''}`,
          `hν = Eₙ − Eₖ = ${fmt(level(p.n), 3)} − (${fmt(level(k), 3)}) = ${fmt(tr.E, 3)} эВ`,
          `λ = hc/(Eₙ − Eₖ) = ${fmt(tr.lambda, 0)} нм — серия ${tr.series} (${SERIES[k]?.range ?? ''}),  ν = ${sci(tr.nu)} Гц`,
          `Eₙ = −13,6/n² эВ,  rₙ = 0,053·n² нм: при n = ${p.n} — ${fmt(orbit(p.n), 3)} нм`,
        ]}
      />
    </Group>
  );
}

export const bohrModule: ObjectModule<BohrProps, ReactNode> = {
  type: BOHR_TYPE,
  title: 'Атом водорода (модель Бора)',
  version: 1,
  propsSchema: bohrPropsSchema,
  createProps: () => ({ n: 3, k: 2, absorb: false, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<BohrProps>,
  ...boxed(() => ({ x: -170, y: -266, width: 600, height: 560 })),
  render: (o, ctx) => <BohrShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('n', 'Верхний уровень n', 2, 7, 1, true), num('k', 'Нижний уровень k', 1, 6, 1, true), { kind: 'toggle', key: 'absorb', label: 'Поглощение' }],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, BOHR_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<BohrProps>(o.id, { props: { play } });
  },
} as ObjectModule<BohrProps, ReactNode>;

// =====================================================================
//  Опыт Резерфорда
// =====================================================================

export const rutherfordPropsSchema = z.object({
  /** Заряд ядра мишени, энергия α-частиц (МэВ), число частиц. */
  Z: z.number().int().min(1).max(92),
  E: z.number().finite().min(0.5).max(50),
  count: z.number().int().min(3).max(41),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type RutherfordProps = z.infer<typeof rutherfordPropsSchema>;
const RW = 400;
const RH = 200;
/** 1 пикс. = 1 фм; частица проходит 80 пикс. за секунду показа. */
const RV = 80;
const RUTH_END = 12;

function RutherfordShape({ o, ctx }: { o: BoardObject<RutherfordProps>; ctx: RenderContext }) {
  const p = o.props;
  const t = usePlayTime(p.play, RUTH_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const d = closest(p.Z, p.E);
  const dpx = d / 1e-15;
  const paths = useMemo(() => {
    const bs = Array.from({ length: p.count }, (_, i) => -RH * 0.75 + (1.5 * RH * i) / (p.count - 1));
    return bs.map((b) => ({ b, pts: trajectory(b === 0 ? 0.01 : b, dpx, RW, 6000) }));
  }, [p.count, dpx]);
  const tau = t * RV;
  const back = paths.filter((q) => scatterAngle(q.b, dpx) > Math.PI / 2).length;
  const rNuc = 1.2 * Math.cbrt(2.5 * p.Z);
  return (
    <Group listening={false}>
      <Group clipX={-RW} clipY={-RH} clipWidth={2 * RW} clipHeight={2 * RH} listening={false}>
        <KRect x={-RW} y={-RH} width={2 * RW} height={2 * RH} stroke={muted} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        {paths.map((q, i) => {
          const done = q.pts.filter((s) => s.t <= tau);
          const head = done[done.length - 1];
          return (
            <Group key={i}>
              <Line points={q.pts.flatMap((s) => [s.x, s.y])} stroke={muted} opacity={0.35} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
              {done.length > 1 && <Line points={done.flatMap((s) => [s.x, s.y])} stroke={PROTON} strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />}
              {head && t > 0 && <Circle x={head.x} y={head.y} radius={3.5} fill={PROTON} listening={false} />}
            </Group>
          );
        })}
        <Circle radius={Math.max(3, rNuc)} fill="#f59e0b" stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        <Circle radius={dpx} stroke={ink} strokeWidth={1} dash={[3, 3]} strokeScaleEnabled={false} listening={false} />
        <Text x={dpx * 0.72 + 4} y={-dpx * 0.72 - 14} text="d" fontSize={14} {...italic} fill={ink} listening={false} />
      </Group>
      <Text x={-RW} y={RH + 6} text="1 клетка рисунка = 1 фм = 10⁻¹⁵ м; ядро золота — около 7 фм, атом — около 10⁵ фм" fontSize={12} fill={muted} listening={false} />
      <Info
        x={-RW}
        y={-RH - 82}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} α-частицы ${fmt(p.E, 1)} МэВ и ядро ${elementName(p.Z)} (Z = ${p.Z})`,
          `Наибольшее сближение: d = k·2Ze²/E = ${sci(d)} м`,
          `tg(θ/2) = d/(2b): назад (θ > 90°) отражаются частицы с b < d/2 — здесь ${back} из ${p.count}`,
          'Вывод: заряд и почти вся масса атома сосредоточены в крошечном ядре',
        ]}
      />
    </Group>
  );
}

export const rutherfordModule: ObjectModule<RutherfordProps, ReactNode> = {
  type: RUTHERFORD_TYPE,
  title: 'Опыт Резерфорда',
  version: 1,
  propsSchema: rutherfordPropsSchema,
  createProps: () => ({ Z: 79, E: 5, count: 21, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<RutherfordProps>,
  ...boxed(() => ({ x: -RW - 6, y: -RH - 86, width: 2 * RW + 12, height: 2 * RH + 110 })),
  render: (o, ctx) => <RutherfordShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('E', 'E α-частиц, МэВ', 0.5, 50, 0.5, true), num('Z', 'Z ядра', 1, 92, 1), num('count', 'Частиц', 3, 41, 2)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, RUTH_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<RutherfordProps>(o.id, { props: { play } });
  },
} as ObjectModule<RutherfordProps, ReactNode>;

// =====================================================================
//  Ядро: состав, дефект масс, энергия связи
// =====================================================================

const isotopeKeys = Object.keys(MASSES).filter((k) => k !== 'n-1' && k !== 'H-1') as [string, ...string[]];
const parseIso = (key: string) => {
  const [sym, a] = key.split('-');
  const Z = zOf(sym!);
  return { Z, A: Number(a) };
};

export const nucleusPropsSchema = z.object({ iso: z.enum(isotopeKeys) });
export type NucleusProps = z.infer<typeof nucleusPropsSchema>;

function NucleusShape({ o, ctx }: { o: BoardObject<NucleusProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const { Z, A } = parseIso(p.iso);
  const b = binding(Z, A, MASSES[p.iso]!);
  // Нуклоны спиралью Фогеля; какие из них протоны — псевдослучайно от номера.
  const r = seeded(A * 7 + Z);
  const order = Array.from({ length: A }, (_, i) => ({ i, k: r() })).sort((u, v) => u.k - v.k);
  const isProton = new Set(order.slice(0, Z).map((u) => u.i));
  const s = A > 100 ? 4.6 : 6;
  const all = isotopeKeys.map((key) => {
    const q = parseIso(key);
    return { key, A: q.A, e: binding(q.Z, q.A, MASSES[key]!).perNucleon };
  });
  return (
    <Group listening={false}>
      <Group x={90} y={110} listening={false}>
        {Array.from({ length: A }, (_, i) => {
          const rr = s * 1.05 * Math.sqrt(i + 0.5);
          const a = i * 2.39996;
          return <Circle key={i} x={Math.cos(a) * rr} y={Math.sin(a) * rr} radius={s} fill={isProton.has(i) ? PROTON : NEUTRON} stroke={ink} strokeWidth={0.5} strokeScaleEnabled={false} listening={false} />;
        })}
      </Group>
      <NuclideLabel x={20} y={200} A={A} Z={Z} sym={symbolOf(Z)} size={30} color={ink} />
      <Circle x={110} y={218} radius={6} fill={PROTON} listening={false} />
      <Text x={120} y={211} text={`протонов Z = ${Z}`} fontSize={13} fill={ink} listening={false} />
      <Circle x={110} y={238} radius={6} fill={NEUTRON} listening={false} />
      <Text x={120} y={231} text={`нейтронов N = ${A - Z}`} fontSize={13} fill={ink} listening={false} />
      <Plot
        x={300}
        y={20}
        w={300}
        h={200}
        xMax={250}
        yMax={10}
        curves={[]}
        points={all.map((q) => (q.key === p.iso ? { x: q.A, y: q.e, color: HI, label: symbolOf(Z), guides: true, xText: String(A), yText: fmt(q.e, 2) } : { x: q.A, y: q.e, color: muted }))}
        xLabel="A"
        yLabel="Eсв/A, МэВ"
        ink={ink}
      />
      <Info
        x={0}
        y={-84}
        ink={ink}
        muted={muted}
        lines={[
          `${elementName(Z)}-${A}: A = Z + N = ${Z} + ${A - Z};  M = ${fmt(MASSES[p.iso]!, 6)} а. е. м.`,
          `Δm = Z·m(¹H) + N·mₙ − M = ${Z}·${fmt(M_H, 6)} + ${A - Z}·${fmt(M_N, 6)} − ${fmt(MASSES[p.iso]!, 6)} = ${fmt(b.dm, 6)} а. е. м.`,
          `E_св = Δm·c² = Δm·${fmt(U_MEV, 1)} МэВ = ${fmt(b.E, 1)} МэВ;  на нуклон — ${fmt(b.perNucleon, 2)} МэВ`,
          'Прочнее всего ядра около железа: деление тяжёлых и синтез лёгких ядер выделяют энергию',
        ]}
      />
    </Group>
  );
}

export const nucleusModule: ObjectModule<NucleusProps, ReactNode> = {
  type: NUCLEUS_TYPE,
  title: 'Ядро и энергия связи',
  version: 1,
  propsSchema: nucleusPropsSchema,
  createProps: () => ({ iso: 'He-4' }),
  deserialize: (r) => r as unknown as BoardObject<NucleusProps>,
  ...boxed(() => ({ x: -10, y: -88, width: 700, height: 360 })),
  render: (o, ctx) => <NucleusShape o={o} ctx={ctx} />,
  inspector: [{ kind: 'select', key: 'iso', label: 'Ядро', options: isotopeKeys.map((k) => ({ value: k, label: `${elementName(parseIso(k).Z)}-${parseIso(k).A}` })) }],
} as ObjectModule<NucleusProps, ReactNode>;

// =====================================================================
//  Радиоактивный распад
// =====================================================================

const radioKeys = Object.keys(RADIOACTIVE) as [string, ...string[]];
export const decayPropsSchema = z.object({
  iso: z.enum(radioKeys),
  /** Сколько ядер на рисунке. */
  N0: z.number().int().min(16).max(400),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type DecayProps = z.infer<typeof decayPropsSchema>;
/** Период полураспада на показе — 2 с, всего 5 периодов. */
const HALF = 2;
const DECAY_END = 5 * HALF;

/** Сколько ядер (из N0 на рисунке) уже распалось к моменту τ (в периодах). */
export function decayedAt(N0: number, tau: number, seed: number): boolean[] {
  return Array.from({ length: N0 }, (_, j) => lifetime(seeded(seed * 1000 + j)()) <= tau);
}

function DecayShape({ o, ctx }: { o: BoardObject<DecayProps>; ctx: RenderContext }) {
  const p = o.props;
  const t = usePlayTime(p.play, DECAY_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const iso = RADIOACTIVE[p.iso]!;
  const tau = t / HALF;
  const seed = iso.A + iso.Z;
  const gone = decayedAt(p.N0, tau, seed);
  const left = gone.filter((g) => !g).length;
  const cols = Math.ceil(Math.sqrt(p.N0 * 1.6));
  const cell = 240 / cols;
  const dgt = daughter(iso.Z, iso.A, iso.kind);
  const parent: Nuclide = { Z: iso.Z, A: iso.A, sym: symbolOf(iso.Z), mass: null, count: 1 };
  const child: Nuclide = { Z: dgt.Z, A: dgt.A, sym: symbolOf(dgt.Z), mass: null, count: 1 };
  const particle: Nuclide = iso.kind === 'alpha' ? { Z: 2, A: 4, sym: 'α', mass: null, count: 1 } : { Z: -1, A: 0, sym: 'e', mass: null, count: 1 };
  return (
    <Group listening={false}>
      {gone.map((g, j) => (
        <Circle key={j} x={(j % cols) * cell + cell / 2} y={Math.floor(j / cols) * cell + cell / 2} radius={cell * 0.36} fill={g ? NEUTRON : PROTON} opacity={g ? 0.45 : 1} listening={false} />
      ))}
      <Plot
        x={300}
        y={10}
        w={280}
        h={170}
        xMax={5}
        yMax={p.N0 * 1.1}
        curves={[{ pts: Array.from({ length: 101 }, (_, i) => [i / 20, remaining(p.N0, i / 20, 1)] as [number, number]), color: ELECTRON }]}
        points={[{ x: tau, y: left, color: HI, guides: true, xText: fmt(tau, 2), yText: String(left) }, ...[1, 2, 3].map((k) => ({ x: k, y: p.N0 / 2 ** k, color: muted }))]}
        xLabel="t / T"
        yLabel="N"
        ink={ink}
      />
      <Equation x={0} y={Math.ceil(p.N0 / cols) * cell + 24} left={[parent]} right={[child, particle]} size={24} ink={ink} />
      {iso.kind === 'beta' && <Text x={nuclideWidth(iso.A, iso.Z, parent.sym, 24) + nuclideWidth(dgt.A, dgt.Z, child.sym, 24) + nuclideWidth(0, -1, 'e', 24) + 70} y={Math.ceil(p.N0 / cols) * cell + 24} text="+ ν̃" fontSize={24} fill={ink} listening={false} />}
      <Info
        x={0}
        y={-84}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${elementName(iso.Z)}-${iso.A}: ${iso.kind === 'alpha' ? 'α' : 'β⁻'}-распад, период полураспада T = ${iso.Ttext}`,
          `t = ${fmt(tau, 2)}T:  N = N₀·2^(−t/T) = ${fmt(remaining(p.N0, tau, 1), 1)};  на рисунке осталось ${left} из ${p.N0}`,
          'За каждый период полураспада распадается половина оставшихся ядер — какое именно ядро распадётся, предсказать нельзя',
          iso.kind === 'alpha' ? 'α-распад: Z уменьшается на 2, A — на 4' : 'β⁻-распад: нейтрон → протон + электрон + антинейтрино; Z растёт на 1, A не меняется',
        ]}
      />
    </Group>
  );
}

export const decayModule: ObjectModule<DecayProps, ReactNode> = {
  type: DECAY_TYPE,
  title: 'Радиоактивный распад',
  version: 1,
  propsSchema: decayPropsSchema,
  createProps: () => ({ iso: 'Rn-222', N0: 200, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<DecayProps>,
  ...boxed(() => ({ x: -10, y: -88, width: 680, height: 420 })),
  render: (o, ctx) => <DecayShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, { kind: 'select', key: 'iso', label: 'Изотоп', options: radioKeys.map((k) => ({ value: k, label: `${elementName(RADIOACTIVE[k]!.Z)}-${RADIOACTIVE[k]!.A} (${RADIOACTIVE[k]!.Ttext})` })) }, num('N0', 'Ядер на рисунке', 16, 400, 8)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, DECAY_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<DecayProps>(o.id, { props: { play } });
  },
} as ObjectModule<DecayProps, ReactNode>;

// =====================================================================
//  Ядерная реакция
// =====================================================================

export const reactionPropsSchema = z.object({ eq: z.string().max(200) });
export type ReactionProps = z.infer<typeof reactionPropsSchema>;

/** Готовые реакции — кнопки панели свойств. */
export const REACTION_PRESETS: Record<string, { label: string; eq: string }> = {
  li: { label: 'Литий + протон (1932)', eq: 'Li7 + p -> 2 He4' },
  rutherford: { label: 'Открытие протона (1919)', eq: 'N14 + a -> O17 + X' },
  chadwick: { label: 'Открытие нейтрона (1932)', eq: 'Be9 + a -> C12 + X' },
  fission: { label: 'Деление урана', eq: 'U235 + n -> Ba141 + Kr92 + X' },
  fusion: { label: 'Синтез d + t', eq: 'H2 + H3 -> He4 + X' },
};

function ReactionShape({ o, ctx }: { o: BoardObject<ReactionProps>; ctx: RenderContext }) {
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const r = parseReaction(o.props.eq);
  if ('error' in r)
    return (
      <Group listening={false}>
        <Text text={o.props.eq || '—'} fontSize={22} fill={ink} listening={false} />
        <Text y={36} text={`Ошибка записи: ${r.error}`} fontSize={14} fill={PROTON} listening={false} />
        <Text y={58} text="Пример: Li7 + p -> 2 He4;  частицы: p, n, a (α), d, t, e, e+, g (γ); неизвестное — X" fontSize={12} fill={muted} listening={false} />
      </Group>
    );
  const zs = (arr: Nuclide[]) => arr.map((n) => (n.count > 1 ? `${n.count}·${n.Z}` : n.Z < 0 ? `(−${-n.Z})` : String(n.Z))).join(' + ');
  const as = (arr: Nuclide[]) => arr.map((n) => (n.count > 1 ? `${n.count}·${n.A}` : String(n.A))).join(' + ');
  const zOk = r.zl === r.zr;
  const aOk = r.al === r.ar;
  const q = r.Q;
  return (
    <Group listening={false}>
      <Equation x={0} y={0} left={r.left} right={r.right} size={30} ink={ink} mark={r.unknown} />
      {r.unknown && <Text x={0} y={58} text={`Неизвестное X = ${display(r.unknown).sym === 'He' ? '⁴₂He (α-частица)' : r.unknown.sym === 'n' ? (r.unknown.count > 1 ? `${r.unknown.count} нейтрона` : 'нейтрон') : r.unknown.sym === 'p' ? 'протон' : r.unknown.sym === 'e' ? 'электрон' : r.unknown.sym}: найдено из законов сохранения`} fontSize={14} fill={HI} listening={false} />}
      <Text x={0} y={84} text={`Зарядовое число:  ${zs(r.left)} = ${r.zl};  ${zs(r.right)} = ${r.zr}  ${zOk ? '✓' : '✗ не сохраняется'}`} fontSize={14} fill={zOk ? OK : PROTON} listening={false} />
      <Text x={0} y={106} text={`Массовое число:  ${as(r.left)} = ${r.al};  ${as(r.right)} = ${r.ar}  ${aOk ? '✓' : '✗ не сохраняется'}`} fontSize={14} fill={aOk ? OK : PROTON} listening={false} />
      <Text
        x={0}
        y={132}
        text={q === null ? (zOk && aOk ? 'Выход энергии не посчитан: нет масс некоторых ядер в таблице' : 'Такая реакция невозможна') : `Q = (Σm до − Σm после)·931,5 МэВ = ${fmt(q, 2)} МэВ — энергия ${q >= 0 ? 'выделяется' : 'поглощается'}`}
        fontSize={15}
        fill={ink}
        listening={false}
      />
      <Text x={0} y={156} text="Массы — атомные (а. е. м.), электроны при этом сокращаются" fontSize={11} fill={muted} listening={false} />
    </Group>
  );
}

export const reactionModule: ObjectModule<ReactionProps, ReactNode> = {
  type: REACTION_TYPE,
  title: 'Ядерная реакция',
  version: 1,
  propsSchema: reactionPropsSchema,
  createProps: () => ({ eq: REACTION_PRESETS.li!.eq }),
  deserialize: (r) => r as unknown as BoardObject<ReactionProps>,
  ...boxed(() => ({ x: -6, y: -14, width: 640, height: 190 })),
  render: (o, ctx) => <ReactionShape o={o} ctx={ctx} />,
  inspector: [{ kind: 'text', key: 'eq', label: 'Реакция', maxLength: 200 }, ...Object.entries(REACTION_PRESETS).map(([key, v]) => ({ kind: 'action' as const, key, label: v.label }))],
  runAction: (o, key, ctx) => {
    const preset = REACTION_PRESETS[key];
    if (preset) ctx.updateObject<ReactionProps>(o.id, { props: { eq: preset.eq } });
  },
} as ObjectModule<ReactionProps, ReactNode>;

export const atomModules = [bohrModule, rutherfordModule, nucleusModule, decayModule, reactionModule];
