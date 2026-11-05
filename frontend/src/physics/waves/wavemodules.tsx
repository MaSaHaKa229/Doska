import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { toast } from '../../store/toast';
import { fmt } from '../common/quantities';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { playText } from '../mechanics/objects';
import { Info, MiniPlot, PLAY_ONLY, PLUGIN_ID, boxed, num, useZoom } from './objects';
import { SOUND_V, condition, intensity, maximaCount, pathDiff, soundInfo, standing, travelling } from './wave';

export const WAVE_TYPE = `${PLUGIN_ID}.wave`;
export const STANDING_TYPE = `${PLUGIN_ID}.standing`;
export const SOUND_TYPE = `${PLUGIN_ID}.sound`;
export const INTERFERENCE_TYPE = `${PLUGIN_ID}.interference`;

const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const WAVE = '#2563eb';
const HI = '#d13a3a';

// =====================================================================
//  Бегущая волна
// =====================================================================

export const wavePropsSchema = z.object({
  longitudinal: z.boolean(),
  /** Амплитуда, см; длина волны, м; скорость, м/с. */
  A: z.number().finite().min(0.1).max(100),
  lambda: z.number().finite().min(0.01).max(1000),
  v: z.number().finite().min(0.01).max(1e5),
  /** Сколько длин волн на чертеже. */
  span: z.number().finite().min(1).max(6),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type WaveProps = z.infer<typeof wavePropsSchema>;
const WW = 520;
const WAVE_SHOW = 12;

function WaveShape({ o, ctx }: { o: BoardObject<WaveProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const tr = travelling(p.A, p.lambda, p.v);
  const ts = usePlayTime(p.play, WAVE_SHOW, p.speed);
  // Показ: один период — за секунду, если настоящий короче (звук и т. п.).
  const t = tr.T < 1 ? ts * tr.T : ts;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const L = p.lambda * p.span;
  const X = (x: number) => (x / L) * WW;
  const amp = 40;
  const s = (x: number) => tr.s(x, t) / p.A;
  const els: ReactNode[] = [];
  const n = p.longitudinal ? 60 : 40;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * L;
    const hi = i === Math.round(n / (2 * p.span));
    if (p.longitudinal) {
      // Продольная: частицы смещаются вдоль x — сгущения и разрежения.
      const dx = s(x) * 14;
      for (const yy of [-30, -10, 10, 30]) els.push(<Circle key={`${i}:${yy}`} x={X(x) + dx} y={yy} radius={hi ? 5 : 3} fill={hi ? HI : WAVE} listening={false} />);
    } else els.push(<Circle key={i} x={X(x)} y={-s(x) * amp} radius={hi ? 6 : 3.5} fill={hi ? HI : WAVE} listening={false} />);
  }
  return (
    <Group listening={false}>
      <Line points={[0, 0, WW, 0]} stroke={muted} strokeWidth={1} dash={[4 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      {!p.longitudinal && (
        <Shape
          sceneFunc={(c, shape) => {
            const g = raw(c);
            g.beginPath();
            for (let k = 0; k <= 200; k++) {
              const x = (k / 200) * L;
              if (k) g.lineTo(X(x), -s(x) * amp);
              else g.moveTo(X(x), -s(x) * amp);
            }
            c.strokeShape(shape);
          }}
          stroke={WAVE}
          opacity={0.5}
          strokeWidth={1.2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {els}
      <Arrow points={[X(0), 62, X(p.lambda), 62]} pointerAtBeginning stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={6 / zoom} listening={false} />
      <Text x={X(p.lambda / 2) - 6} y={66} text="λ" fontSize={16} {...italic} fill={ink} listening={false} />
      <Arrow points={[WW - 80, -70, WW - 20, -70]} stroke={ink} fill={ink} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={7 / zoom} listening={false} />
      <Text x={WW - 60} y={-92} text="v" fontSize={16} {...italic} fill={ink} listening={false} />
      {p.longitudinal && <MiniPlot x={0} y={110} w={WW} h={70} x0={0} x1={L} yMax={1.1} curves={[{ f: (x) => s(x), color: WAVE }]} xLabel="x" yLabel="s" ink={ink} />}
      <Info
        x={0}
        y={-150}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${p.longitudinal ? 'Продольная волна: частицы колеблются вдоль направления распространения' : 'Поперечная волна: частицы колеблются поперёк направления распространения'}`,
          `λ = ${fmt(p.lambda)} м, v = ${fmt(p.v)} м/с:  ν = v/λ = ${fmt(tr.nu)} Гц,  T = 1/ν = ${fmt(tr.T, 4)} с${tr.T < 1 ? ' (показ замедлен)' : ''}`,
          'Красная частица колеблется на месте — переносится энергия, а не вещество',
        ]}
      />
    </Group>
  );
}

export const waveModule: ObjectModule<WaveProps, ReactNode> = {
  type: WAVE_TYPE,
  title: 'Бегущая волна',
  version: 1,
  propsSchema: wavePropsSchema,
  createProps: () => ({ longitudinal: false, A: 2, lambda: 2, v: 2, span: 3, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<WaveProps>,
  ...boxed((p: WaveProps) => ({ x: -10, y: -154, width: WW + 40, height: p.longitudinal ? 350 : 250 })),
  render: (o, ctx) => <WaveShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, { kind: 'toggle', key: 'longitudinal', label: 'Продольная' }, num('lambda', 'λ, м', 0.01, 1000, 0.5), num('v', 'v, м/с', 0.01, 1e5, 0.5), num('span', 'Длин волн', 1, 6, 1)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, WAVE_SHOW, o.props.speed, ctx.now);
    if (play) ctx.updateObject<WaveProps>(o.id, { props: { play } });
  },
} as ObjectModule<WaveProps, ReactNode>;

// =====================================================================
//  Стоячая волна на струне
// =====================================================================

export const standingPropsSchema = z.object({ L: z.number().finite().min(0.01).max(1000), n: z.number().int().min(1).max(10), v: z.number().finite().min(0.01).max(1e5), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type StandingProps = z.infer<typeof standingPropsSchema>;
const SW = 480;
const STAND_SHOW = 12;

function StandingShape({ o, ctx }: { o: BoardObject<StandingProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const st = standing(p.L, p.n, p.v, 1);
  const ts = usePlayTime(p.play, STAND_SHOW, p.speed);
  // Показ: один период колебаний струны — за секунду.
  const t = (ts / 1) * (1 / st.nu);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const X = (x: number) => (x / p.L) * SW;
  const amp = 30;
  const curve = (f: (x: number) => number, color: string, dashed: boolean, key: string) => (
    <Shape
      key={key}
      sceneFunc={(c, shape) => {
        const g = raw(c);
        g.beginPath();
        for (let k = 0; k <= 240; k++) {
          const x = (k / 240) * p.L;
          if (k) g.lineTo(X(x), -f(x) * amp);
          else g.moveTo(X(x), -f(x) * amp);
        }
        c.strokeShape(shape);
      }}
      stroke={color}
      strokeWidth={dashed ? 1 : 2.2}
      dash={dashed ? [5 / zoom, 4 / zoom] : undefined}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
  return (
    <Group listening={false}>
      {curve(st.envelope, muted, true, 'e1')}
      {curve((x) => -st.envelope(x), muted, true, 'e2')}
      {curve((x) => st.y(x, t), WAVE, false, 'y')}
      {st.nodes.map((x, i) => (
        <Circle key={`n${i}`} x={X(x)} y={0} radius={4} fill={ink} listening={false} />
      ))}
      <Line points={[-8, -80, -8, 80]} stroke={ink} strokeWidth={4} strokeScaleEnabled={false} listening={false} />
      <Line points={[SW + 8, -80, SW + 8, 80]} stroke={ink} strokeWidth={4} strokeScaleEnabled={false} listening={false} />
      {st.antinodes.slice(0, 1).map((x) => (
        <Text key="a" x={X(x) - 30} y={-amp * 2 - 20} width={60} align="center" text="пучность" fontSize={12} fill={muted} listening={false} />
      ))}
      {p.n > 1 && <Text x={X(st.nodes[1]!) - 30} y={10} width={60} align="center" text="узел" fontSize={12} fill={muted} listening={false} />}
      <Info x={0} y={-130} ink={ink} muted={muted} lines={[`${playText(p.play)} Стоячая волна: ${p.n}-я гармоника, узлов ${st.nodes.length}, пучностей ${st.antinodes.length}`, `L = ${fmt(p.L)} м, v = ${fmt(p.v)} м/с:  λ = 2L/n = ${fmt(st.lambda)} м,  ν = nv/(2L) = ${fmt(st.nu)} Гц`]} />
    </Group>
  );
}

export const standingModule: ObjectModule<StandingProps, ReactNode> = {
  type: STANDING_TYPE,
  title: 'Стоячая волна',
  version: 1,
  propsSchema: standingPropsSchema,
  createProps: () => ({ L: 1, n: 3, v: 200, speed: 0.3, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<StandingProps>,
  ...boxed(() => ({ x: -20, y: -134, width: SW + 40, height: 230 })),
  render: (o, ctx) => <StandingShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('n', 'Гармоника n', 1, 10, 1, true), num('L', 'L, м', 0.01, 1000, 0.1), num('v', 'v, м/с', 0.01, 1e5, 10)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, STAND_SHOW, o.props.speed, ctx.now);
    if (play) ctx.updateObject<StandingProps>(o.id, { props: { play } });
  },
} as ObjectModule<StandingProps, ReactNode>;

// =====================================================================
//  Звук
// =====================================================================

export const soundPropsSchema = z.object({ nu: z.number().finite().min(1).max(40000), A: z.number().finite().min(0.05).max(1) });
export type SoundProps = z.infer<typeof soundPropsSchema>;

let audio: AudioContext | null = null;
/** Тон на 1,2 с у нажавшего (громкость — по амплитуде, но не громче 0,3). */
export function playTone(nu: number, A: number): boolean {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return false;
  audio ??= new Ctx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = nu;
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3 * A, now + 0.05);
  gain.gain.linearRampToValueAtTime(0, now + 1.2);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 1.25);
  return true;
}

function SoundShape({ o, ctx }: { o: BoardObject<SoundProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const si = soundInfo(p.nu);
  const T = 1 / p.nu;
  return (
    <Group listening={false}>
      <Line points={[0, -18, 14, -18, 34, -38, 34, 38, 14, 18, 0, 18]} closed fill={ink} listening={false} />
      {[1, 2, 3].map((k) => (
        <Shape
          key={k}
          sceneFunc={(c, shape) => {
            const g = raw(c);
            g.beginPath();
            g.arc(34, 0, 14 * k, -Math.PI / 4, Math.PI / 4);
            c.strokeShape(shape);
          }}
          stroke={ink}
          opacity={0.3 + 0.7 * p.A}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      <MiniPlot x={110} y={-50} w={340} h={100} x0={0} x1={3 * T} yMax={1.1} curves={[{ f: (t) => p.A * Math.sin(2 * Math.PI * p.nu * t), color: WAVE }]} xLabel="t" yLabel="p" ink={ink} />
      <Info
        x={0}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[`ν = ${fmt(p.nu)} Гц — ${si.pitch}; громкость — амплитуда ${fmt(p.A)}`, `λ = v/ν = ${fmt(si.lambda, 3)} м (v = ${SOUND_V} м/с);  на графике — 3 периода, T = ${fmt(T * 1000, 3)} мс`]}
      />
    </Group>
  );
}

export const soundModule: ObjectModule<SoundProps, ReactNode> = {
  type: SOUND_TYPE,
  title: 'Звук',
  version: 1,
  propsSchema: soundPropsSchema,
  createProps: () => ({ nu: 440, A: 0.6 }),
  deserialize: (r) => r as unknown as BoardObject<SoundProps>,
  ...boxed(() => ({ x: -10, y: -122, width: 500, height: 190 })),
  render: (o, ctx) => <SoundShape o={o} ctx={ctx} />,
  // «Послушать» звучит только у нажавшего: звук на всех устройствах класса сразу — неудобно.
  inspector: [{ kind: 'action', key: 'listen', label: '🔊 Послушать' }, num('nu', 'ν, Гц', 1, 40000, 10), num('A', 'Громкость', 0.05, 1, 0.05, true)],
  runAction: (o, key) => {
    if (key !== 'listen') return;
    if (o.props.nu < 20 || o.props.nu > 20000) toast.info('Этот звук человек не слышит');
    else if (!playTone(o.props.nu, o.props.A)) toast.info('Браузер не умеет воспроизводить звук');
  },
} as ObjectModule<SoundProps, ReactNode>;

// =====================================================================
//  Интерференция от двух источников
// =====================================================================

export const interferencePropsSchema = z.object({
  /** Расстояние между источниками и длина волны — в пикселях чертежа. */
  d: z.number().finite().min(10).max(400),
  lambda: z.number().finite().min(8).max(200),
  probe: z.object({ x: z.number().finite(), y: z.number().finite() }),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type InterferenceProps = z.infer<typeof interferencePropsSchema>;
const IW = 440;
const IH = 300;
const CELL = 6;
const INTER_SHOW = 20;

function InterferenceShape({ o, ctx }: { o: BoardObject<InterferenceProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const t = usePlayTime(p.play, INTER_SHOW, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  // Источники — внизу посередине; координаты относительно середины между ними.
  const ox = IW / 2;
  const oy = IH - 20;
  const dl = pathDiff(p.probe.x - ox, p.probe.y - oy, p.d);
  const cond = condition(dl, p.lambda);
  // Гребни: окружности радиусов vt + kλ (v — одна длина волны в секунду).
  const crest = (t * p.lambda) % p.lambda;
  const rings: ReactNode[] = [];
  for (const sx of [-p.d / 2, p.d / 2])
    for (let r = crest; r < Math.hypot(IW, IH); r += p.lambda) rings.push(<Circle key={`${sx}:${r}`} x={ox + sx} y={oy} radius={r} stroke={ink} opacity={0.18} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
  return (
    <Group listening={false}>
      <Shape
        sceneFunc={(c) => {
          const g = raw(c);
          for (let y = 0; y < IH; y += CELL)
            for (let x = 0; x < IW; x += CELL) {
              const I = intensity(pathDiff(x + CELL / 2 - ox, y + CELL / 2 - oy, p.d), p.lambda);
              g.fillStyle = `rgba(37, 99, 235, ${(0.08 + 0.55 * I).toFixed(3)})`;
              g.fillRect(x, y, CELL, CELL);
            }
        }}
        listening={false}
      />
      <Group clipX={0} clipY={0} clipWidth={IW} clipHeight={IH}>
        {rings}
      </Group>
      {[-1, 1].map((k) => (
        <Group key={k}>
          <Circle x={ox + (k * p.d) / 2} y={oy} radius={6} fill={HI} listening={false} />
          <Text x={ox + (k * p.d) / 2 - 8} y={oy + 6} text={k < 0 ? 'S₁' : 'S₂'} fontSize={14} {...italic} fill={ink} listening={false} />
        </Group>
      ))}
      <Line points={[ox - p.d / 2, oy, p.probe.x, p.probe.y, ox + p.d / 2, oy]} stroke={ink} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Circle x={p.probe.x} y={p.probe.y} radius={6} stroke={ink} strokeWidth={2} fill="#ffffff" strokeScaleEnabled={false} listening={false} />
      <Text x={p.probe.x + 10} y={p.probe.y - 8} text="M" fontSize={15} {...italic} fill={ink} listening={false} />
      <Info
        x={0}
        y={-80}
        ink={ink}
        muted={muted}
        lines={[
          `В точке M: Δ = d₂ − d₁ = ${fmt(Math.abs(dl) / p.lambda)}λ — ${cond.kind === 'max' ? `максимум (Δ = ${cond.order}λ)` : cond.kind === 'min' ? `минимум (Δ = (${cond.order} + ½)λ)` : 'ни максимум, ни минимум'}`,
          `d = ${fmt(p.d / p.lambda)}λ: на линии источников ${maximaCount(p.d, p.lambda)} максимумов. Максимумы — где Δ = kλ, минимумы — где Δ = (k + ½)λ`,
          `${playText(p.play)} Тёмные полосы — максимумы интенсивности, светлые — минимумы`,
        ]}
      />
    </Group>
  );
}

export const interferenceModule: ObjectModule<InterferenceProps, ReactNode> = {
  type: INTERFERENCE_TYPE,
  title: 'Интерференция волн',
  version: 1,
  propsSchema: interferencePropsSchema,
  createProps: () => ({ d: 120, lambda: 40, probe: { x: 300, y: 80 }, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<InterferenceProps>,
  ...boxed(() => ({ x: 0, y: -84, width: IW, height: IH + 84 })),
  // Точка M тянется без выделения.
  hitPriority: 1,
  getHandles: (o) => [{ id: 'probe', kind: 'point', position: toWorld(o, o.props.probe), label: 'Точка M', snap: false }],
  dragHandle: (o, id, to) => {
    if (id !== 'probe') return null;
    const q = toLocal(o, to);
    return { props: { probe: { x: Math.max(0, Math.min(IW, q.x)), y: Math.max(0, Math.min(IH, q.y)) } } };
  },
  render: (o, ctx) => <InterferenceShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('d', 'd, пикс.', 10, 400, 10, true), num('lambda', 'λ, пикс.', 8, 200, 2, true)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, INTER_SHOW, o.props.speed, ctx.now);
    if (play) ctx.updateObject<InterferenceProps>(o.id, { props: { play } });
  },
} as ObjectModule<InterferenceProps, ReactNode>;

export const waveModules = [waveModule, standingModule, soundModule, interferenceModule];
