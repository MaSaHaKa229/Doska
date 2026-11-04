import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { Plot } from '../common/plot';
import { fmt, sci, seeded, sup } from '../common/quantities';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { playText } from '../mechanics/objects';
import { Info, MiniPlot, PLAY_ONLY, boxed, num, useZoom } from '../waves/objects';
import { C, EM_BANDS, METALS, PARTICLES, SIZES, addVelocities, bandOf, deBroglie, gamma, photoCurrent, photoeffect, photon, relativity, speedAfter, wavelengthColor } from './quantum';

export const PLUGIN_ID = 'physics.modern';
export const RELATIVITY_TYPE = `${PLUGIN_ID}.relativity`;
export const PHOTOEFFECT_TYPE = `${PLUGIN_ID}.photoeffect`;
export const SPECTRUM_TYPE = `${PLUGIN_ID}.spectrum`;
export const DEBROGLIE_TYPE = `${PLUGIN_ID}.debroglie`;

const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const ELECTRON = '#2563eb';
const HI = '#d13a3a';

/** Циферблат со стрелкой: angle — доля оборота. */
function Clock({ x, y, r, turn, ink, fill, label }: { x: number; y: number; r: number; turn: number; ink: string; fill: string; label: string }) {
  const a = turn * 2 * Math.PI - Math.PI / 2;
  return (
    <Group x={x} y={y} listening={false}>
      <Circle radius={r} fill={fill} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      {Array.from({ length: 12 }, (_, i) => {
        const b = (i / 12) * 2 * Math.PI;
        return <Line key={i} points={[Math.cos(b) * r * 0.8, Math.sin(b) * r * 0.8, Math.cos(b) * r, Math.sin(b) * r]} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />;
      })}
      <Line points={[0, 0, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75]} stroke={HI} strokeWidth={2.2} strokeScaleEnabled={false} listening={false} />
      <Text x={-50} y={r + 4} width={100} align="center" text={label} fontSize={12} fill={ink} listening={false} />
    </Group>
  );
}

// =====================================================================
//  Специальная теория относительности
// =====================================================================

export const relativityPropsSchema = z.object({
  /** v/c. */
  beta: z.number().finite().min(0).max(0.995),
  /** Собственное время, с; собственная длина, м; масса, кг. */
  t0: z.number().finite().min(1e-9).max(1e9),
  l0: z.number().finite().min(1e-6).max(1e9),
  m: z.number().finite().min(1e-31).max(1e30),
  /** Скорость тела относительно ракеты, в долях c. */
  u1: z.number().finite().min(0).max(1),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type RelativityProps = z.infer<typeof relativityPropsSchema>;
const TW = 560;
const ROCKET = 160;
const REL_END = 600;
/** Оборот часов Земли на показе — 4 с. */
const TURN = 4;

function RelativityShape({ o, ctx }: { o: BoardObject<RelativityProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const r = relativity(p.beta, p.t0, p.l0, p.m);
  const t = usePlayTime(p.play, REL_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const len = ROCKET / r.gamma;
  // Ракета пролетает дорожку за 4 с при v = c и возвращается слева.
  const run = TW + 60 + ROCKET;
  const x = ((60 + ROCKET + p.beta * (run / 4) * t) % run) - ROCKET;
  const u = addVelocities(p.u1, p.beta);
  const rocket = (rx: number, l: number, dash: boolean, top = 70) => (
    <Shape
      sceneFunc={(c, shape) => {
        const g = raw(c);
        g.beginPath();
        g.moveTo(rx, top);
        g.lineTo(rx + l * 0.82, top);
        g.lineTo(rx + l, top + 15);
        g.lineTo(rx + l * 0.82, top + 30);
        g.lineTo(rx, top + 30);
        g.closePath();
        c.fillStrokeShape(shape);
      }}
      fill={dash ? undefined : ctx.resolveColor('accent-3')}
      stroke={dash ? muted : ink}
      strokeWidth={1.3}
      dash={dash ? [5 / zoom, 4 / zoom] : undefined}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
  return (
    <Group listening={false}>
      <Group clipX={0} clipY={0} clipWidth={TW + 60} clipHeight={170} listening={false}>
        <Line points={[0, 140, TW + 60, 140]} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
        {rocket(x, len, false)}
        {p.beta > 0 && <Arrow points={[x + len + 6, 85, x + len + 46, 85]} stroke={ELECTRON} fill={ELECTRON} strokeWidth={2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />}
        <Text x={x + len + 10} y={60} text="v" fontSize={15} {...italic} fill={ELECTRON} listening={false} />
        <Circle x={x + len * 0.4} y={85} radius={9} fill="#ffffff" stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        <Line points={[x + len * 0.4, 85, x + len * 0.4 + 7 * Math.cos((t / (TURN * r.gamma)) * 2 * Math.PI - Math.PI / 2), 85 + 7 * Math.sin((t / (TURN * r.gamma)) * 2 * Math.PI - Math.PI / 2)]} stroke={HI} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      </Group>
      {/* Сравнение: та же ракета в покое. */}
      {rocket(60, ROCKET, true, 0)}
      <Text x={60 + ROCKET + 10} y={10} text={`в покое: l₀ = ${sci(p.l0)} м`} fontSize={12} fill={muted} listening={false} />
      <Clock x={TW + 120} y={40} r={28} turn={t / TURN} ink={ink} fill="#ffffff" label="часы Земли" />
      <Clock x={TW + 120} y={130} r={28} turn={t / (TURN * r.gamma)} ink={ink} fill="#fef3c7" label="часы в ракете" />
      <MiniPlot x={0} y={230} w={300} h={110} x0={0} x1={1} yMax={8} positive curves={[{ f: (b) => gamma(Math.min(b, 0.9999)), color: HI }]} cursor={p.beta} xLabel="v/c" yLabel="γ" ink={ink} />
      <Info
        x={0}
        y={-104}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} v = ${fmt(p.beta, 3)}c = ${sci(p.beta * C)} м/с:  γ = 1/√(1 − v²/c²) = ${fmt(r.gamma, 3)}`,
          `Время: Δt₀ = ${sci(p.t0)} с в ракете → Δt = γΔt₀ = ${sci(r.t)} с на Земле;  длина: l = l₀/γ = ${sci(r.l)} м`,
          `m = ${sci(p.m)} кг: E₀ = mc² = ${sci(r.E0)} Дж,  E = γmc² = ${sci(r.E)} Дж,  Eₖ = (γ − 1)mc² = ${sci(r.Ek)} Дж (по Ньютону mv²/2 = ${sci(r.EkClassic)} Дж)`,
          `Сложение скоростей: u′ = ${fmt(p.u1, 3)}c в ракете → u = (u′ + v)/(1 + u′v/c²) = ${fmt(u, 4)}c${p.u1 + p.beta > 1 ? ` (не ${fmt(p.u1 + p.beta, 3)}c)` : ''}`,
        ]}
      />
    </Group>
  );
}

export const relativityModule: ObjectModule<RelativityProps, ReactNode> = {
  type: RELATIVITY_TYPE,
  title: 'Теория относительности',
  version: 1,
  propsSchema: relativityPropsSchema,
  createProps: () => ({ beta: 0.8, t0: 1, l0: 10, m: 1, u1: 0.5, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<RelativityProps>,
  ...boxed(() => ({ x: -10, y: -108, width: TW + 190, height: 470 })),
  render: (o, ctx) => <RelativityShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, num('beta', 'v/c', 0, 0.995, 0.005, true), num('t0', 'Δt₀, с', 1e-9, 1e9, 1), num('l0', 'l₀, м', 1e-6, 1e9, 1), num('m', 'm, кг', 1e-31, 1e30, 1), num('u1', 'u′/c (тело в ракете)', 0, 1, 0.05, true)],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, REL_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<RelativityProps>(o.id, { props: { play } });
  },
} as ObjectModule<RelativityProps, ReactNode>;

// =====================================================================
//  Фотоэффект
// =====================================================================

const metalKeys = Object.keys(METALS) as [string, ...string[]];
export const photoPropsSchema = z.object({
  metal: z.enum(metalKeys),
  /** Длина волны, нм; интенсивность, %; напряжение анод − катод, В. */
  lambda: z.number().finite().min(100).max(1000),
  intensity: z.number().finite().min(0).max(100),
  U: z.number().finite().min(-5).max(5),
  speed: z.number().finite().min(0.1).max(10),
  play: playSchema,
});
export type PhotoProps = z.infer<typeof photoPropsSchema>;
const GAP = 220;
const CAT = 60;
const PHOTO_END = 600;
const CYCLE = 2.5;
/** Скорость на рисунке: 90 пикс./с при 1 эВ. */
const KV = 90;

const lightColor = (nm: number) => wavelengthColor(nm) ?? (nm < 380 ? '#8b5cf6' : '#b91c1c');
const lightName = (nm: number) => (nm < 380 ? 'ультрафиолет' : nm > 760 ? 'инфракрасный' : nm < 450 ? 'фиолетовый' : nm < 485 ? 'синий' : nm < 500 ? 'голубой' : nm < 565 ? 'зелёный' : nm < 590 ? 'жёлтый' : nm < 625 ? 'оранжевый' : 'красный');

function PhotoShape({ o, ctx }: { o: BoardObject<PhotoProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const metal = METALS[p.metal]!;
  const pe = photoeffect(p.lambda, metal.A);
  const t = usePlayTime(p.play, PHOTO_END, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const col = lightColor(p.lambda);
  const I = photoCurrent(p.U, pe.Ustop, p.intensity / 100, pe.happens);
  const n = pe.happens ? Math.round((p.intensity / 100) * 26) : 0;
  const a = (KV * KV * p.U) / (2 * GAP);
  const electrons: { x: number; y: number }[] = [];
  for (let j = 0; j < n; j++) {
    const r = seeded(j + 11);
    const phase = r();
    const E0 = pe.Ek * (0.25 + 0.75 * r());
    const y = -50 + r() * 100;
    const age = (t + phase * CYCLE) % CYCLE;
    const xx = KV * Math.sqrt(E0) * age + (a * age * age) / 2;
    if (xx >= 0 && xx <= GAP) electrons.push({ x: CAT + 6 + xx, y });
  }
  const nuMax = Math.max(pe.nu, pe.nuMin) * 1.5;
  const ekLine = (nu: number) => (nu * 6.63e-34) / 1.6e-19 - metal.A;
  return (
    <Group listening={false}>
      {/* Колба, катод, анод. */}
      <KRect x={CAT - 40} y={-80} width={GAP + 92} height={160} cornerRadius={70} stroke={muted} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      <KRect x={CAT} y={-60} width={6} height={120} fill={ctx.resolveColor('muted')} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <KRect x={CAT + 6 + GAP} y={-60} width={6} height={120} fill={ctx.resolveColor('muted')} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text x={CAT - 24} y={-76} text="К" fontSize={14} fill={ink} listening={false} />
      <Text x={CAT + GAP + 16} y={-76} text="А" fontSize={14} fill={ink} listening={false} />
      {/* Свет. */}
      {p.intensity > 0 &&
        [-40, 0, 40].map((dy) => (
          <Shape
            key={dy}
            sceneFunc={(c, shape) => {
              const g = raw(c);
              g.beginPath();
              for (let k = 0; k <= 60; k++) {
                const s = k / 60;
                const bx = CAT + 120 - 114 * s;
                const by = -150 + dy * 0.3 + (150 + dy) * s;
                const w = Math.sin(s * 14 * Math.PI) * 4;
                if (k) g.lineTo(bx + w * 0.7, by + w * 0.7);
                else g.moveTo(bx, by);
              }
              c.strokeShape(shape);
            }}
            stroke={col}
            strokeWidth={2}
            opacity={0.3 + (0.7 * p.intensity) / 100}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
      <Text x={CAT + 110} y={-158} text={`λ = ${fmt(p.lambda, 0)} нм`} fontSize={13} fill={ink} listening={false} />
      {electrons.map((e, i) => (
        <Circle key={i} x={e.x} y={e.y} radius={3.5} fill={ELECTRON} listening={false} />
      ))}
      {/* Цепь: источник и амперметр. */}
      <Line points={[CAT + 3, 60, CAT + 3, 120, CAT + GAP + 9, 120, CAT + GAP + 9, 60]} stroke={ink} strokeWidth={1.3} strokeScaleEnabled={false} listening={false} />
      <Line points={[CAT + 80, 110, CAT + 80, 130]} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Line points={[CAT + 88, 115, CAT + 88, 125]} stroke={ink} strokeWidth={4} strokeScaleEnabled={false} listening={false} />
      <Text x={CAT + 60} y={132} text={`U = ${fmt(p.U, 2)} В`} fontSize={13} fill={ink} listening={false} />
      <Circle x={CAT + 170} y={120} radius={13} fill="#ffffff" stroke={ink} strokeWidth={1.3} strokeScaleEnabled={false} listening={false} />
      <Text x={CAT + 163} y={113} text="A" fontSize={14} fill={ink} listening={false} />
      <Plot
        x={0}
        y={210}
        w={250}
        h={150}
        xMax={nuMax / 1e14}
        yMin={-metal.A * 1.25}
        yMax={Math.max(ekLine(nuMax), 1) * 1.15}
        curves={[
          { pts: [[pe.nuMin / 1e14, 0], [nuMax / 1e14, ekLine(nuMax)]], color: HI },
          { pts: [[0, -metal.A], [pe.nuMin / 1e14, 0]], color: muted, dash: true },
        ]}
        points={[{ x: pe.nuMin / 1e14, y: 0, label: 'ν_min', color: muted }, { x: pe.nu / 1e14, y: pe.happens ? pe.Ek : 0, color: col, guides: true }]}
        xLabel="ν, 10¹⁴ Гц"
        yLabel="Eₖ, эВ"
        ink={ink}
      />
      <Plot
        x={370}
        y={210}
        w={230}
        h={150}
        xMin={-5}
        xMax={5}
        yMax={1.15}
        curves={[{ pts: Array.from({ length: 201 }, (_, k) => { const U = -5 + k * 0.05; return [U, photoCurrent(U, pe.Ustop, p.intensity / 100, pe.happens)] as [number, number]; }), color: ELECTRON }]}
        points={[{ x: p.U, y: I, color: HI, guides: true }, ...(pe.happens ? [{ x: -pe.Ustop, y: 0, label: '−U₃', color: muted }] : [])]}
        xLabel="U, В"
        yLabel="I"
        ink={ink}
        origin={false}
      />
      <Info
        x={0}
        y={-260}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${metal.title}: работа выхода A = ${fmt(metal.A, 2)} эВ;  свет ${fmt(p.lambda, 0)} нм (${lightName(p.lambda)}): hν = hc/λ = ${fmt(pe.Ephoton, 2)} эВ`,
          pe.happens ? `hν = A + Eₖ:  Eₖ = ${fmt(pe.Ek, 2)} эВ,  v_max = √(2Eₖ/m) = ${sci(pe.vMax)} м/с,  U₃ = Eₖ/e = ${fmt(pe.Ustop, 2)} В` : `Фотоэффекта нет: hν < A — сколько ни увеличивай интенсивность`,
          `Красная граница: ν_min = A/h = ${sci(pe.nuMin)} Гц,  λ_max = hc/A = ${fmt(pe.lambdaMax, 0)} нм`,
          `Ток: ${fmt(I * 100, 0)} % от наибольшего;  ток насыщения ∝ интенсивности (${fmt(p.intensity, 0)} %), Eₖ от интенсивности не зависит`,
        ]}
      />
      {!pe.happens && <Text x={CAT + 30} y={20} width={GAP - 40} align="center" text="hν < A — электроны не вылетают" fontSize={13} fill={HI} listening={false} />}
      {pe.happens && p.U < -pe.Ustop && <Text x={CAT + 30} y={20} width={GAP - 40} align="center" text="eU > Eₖ — электроны не долетают" fontSize={13} fill={HI} listening={false} />}
      <Arrow points={[CAT + GAP / 2 - 30, 70, CAT + GAP / 2 + 30, 70]} stroke={p.U >= 0 ? muted : HI} fill={p.U >= 0 ? muted : HI} strokeWidth={1} strokeScaleEnabled={false} pointerLength={6 / zoom} pointerWidth={5 / zoom} opacity={Math.abs(p.U) > 0.01 ? 1 : 0} listening={false} />
    </Group>
  );
}

export const photoModule: ObjectModule<PhotoProps, ReactNode> = {
  type: PHOTOEFFECT_TYPE,
  title: 'Фотоэффект',
  version: 1,
  propsSchema: photoPropsSchema,
  createProps: () => ({ metal: 'K', lambda: 400, intensity: 60, U: 0, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<PhotoProps>,
  ...boxed(() => ({ x: -10, y: -264, width: 700, height: 640 })),
  render: (o, ctx) => <PhotoShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_ONLY,
    { kind: 'select', key: 'metal', label: 'Металл катода', options: Object.entries(METALS).map(([value, m]) => ({ value, label: `${m.title} (${String(m.A).replace('.', ',')} эВ)` })) },
    num('lambda', 'λ, нм', 100, 1000, 10, true),
    num('intensity', 'Интенсивность, %', 0, 100, 5, true),
    num('U', 'U анод − катод, В', -5, 5, 0.1, true),
  ],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, PHOTO_END, o.props.speed, ctx.now);
    if (play) ctx.updateObject<PhotoProps>(o.id, { props: { play } });
  },
} as ObjectModule<PhotoProps, ReactNode>;

// =====================================================================
//  Фотон: шкала электромагнитных волн
// =====================================================================

export const spectrumPropsSchema = z.object({
  /** lg(λ/м). */
  lg: z.number().finite().min(-14).max(4),
});
export type SpectrumProps = z.infer<typeof spectrumPropsSchema>;
const SW = 640;
const LG0 = -14;
const LG1 = 4;
const SX = (lg: number) => ((lg - LG0) / (LG1 - LG0)) * SW;

function SpectrumShape({ o, ctx }: { o: BoardObject<SpectrumProps>; ctx: RenderContext }) {
  const p = o.props;
  const lambda = 10 ** p.lg;
  const ph = photon(lambda);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const nm = lambda * 1e9;
  const visible = wavelengthColor(nm);
  const mx = SX(p.lg);
  const rainbow = (x0: number, w: number, y: number, h: number) => (
    <Shape
      sceneFunc={(c) => {
        const g = raw(c);
        for (let k = 0; k < w; k++) {
          g.fillStyle = wavelengthColor(380 + (380 * k) / w) ?? '#000';
          g.fillRect(x0 + k, y, 1.5, h);
        }
      }}
      listening={false}
    />
  );
  const lam = lambda >= 1e-9 && lambda < 1e-3 ? `${fmt(nm, nm < 10 ? 2 : 0)} нм` : `${sci(lambda)} м`;
  return (
    <Group listening={false}>
      {EM_BANDS.map((b) => {
        const x0 = SX(Math.max(LG0, Math.log10(b.from)));
        const x1 = SX(Math.min(LG1, Math.log10(b.to)));
        // Узкая полоса видимого света — подпись выше, ультрафиолет — под шкалой, остальные — над ней.
        const vis = b.title === 'Видимый свет';
        const y = vis ? -38 : b.title === 'Ультрафиолет' ? 46 : -20;
        return (
          <Group key={b.title}>
            {vis ? rainbow(x0, x1 - x0, 0, 40) : <KRect x={x0} y={0} width={x1 - x0} height={40} fill={b.color} opacity={0.55} listening={false} />}
            <Text x={vis ? (x0 + x1) / 2 - 50 : x0 - 10} y={y} width={vis ? 100 : x1 - x0 + 20} align="center" text={b.title} fontSize={12} fill={ink} listening={false} />
          </Group>
        );
      })}
      <KRect x={0} y={0} width={SW} height={40} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      {Array.from({ length: (LG1 - LG0) / 2 + 1 }, (_, k) => LG0 + 2 * k).map((lg) => (
        <Group key={lg}>
          <Line points={[SX(lg), 40, SX(lg), 70]} stroke={muted} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          <Text x={SX(lg) - 24} y={72} width={48} align="center" text={`10${sup(lg)}`} fontSize={11} fill={muted} listening={false} />
        </Group>
      ))}
      <Text x={SW + 8} y={72} text="λ, м" fontSize={12} {...italic} fill={muted} listening={false} />
      <Text x={-60} y={14} text="ν растёт ←" fontSize={11} fill={muted} listening={false} />
      {/* Видимая часть крупно. */}
      {rainbow(0, SW, 110, 26)}
      {[400, 500, 600, 700].map((v) => (
        <Text key={v} x={((v - 380) / 380) * SW - 20} y={140} width={40} align="center" text={`${v} нм`} fontSize={11} fill={muted} listening={false} />
      ))}
      <Line points={[SX(Math.log10(3.8e-7)), 40, 0, 110]} stroke={muted} strokeWidth={1} dash={[3, 3]} strokeScaleEnabled={false} listening={false} />
      <Line points={[SX(Math.log10(7.6e-7)), 40, SW, 110]} stroke={muted} strokeWidth={1} dash={[3, 3]} strokeScaleEnabled={false} listening={false} />
      {visible && <Line points={[((nm - 380) / 380) * SW, 104, ((nm - 380) / 380) * SW, 142]} stroke={ink} strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />}
      {/* Отметка — тянется мышью. */}
      <Line points={[mx, -6, mx, 46]} stroke={ink} strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />
      <Circle x={mx} y={-6} radius={6} fill={visible ?? '#ffffff'} stroke={ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      <Info
        x={0}
        y={-130}
        ink={ink}
        muted={muted}
        lines={[`λ = ${lam} — ${bandOf(lambda).toLowerCase()}`, `ν = c/λ = ${sci(ph.nu)} Гц`, `E = hν = ${sci(ph.E)} Дж = ${sci(ph.eV)} эВ`, `p = h/λ = ${sci(ph.p)} кг·м/с,  m = E/c² = ${sci(ph.m)} кг (масса покоя фотона — 0)`]}
      />
    </Group>
  );
}

export const spectrumModule: ObjectModule<SpectrumProps, ReactNode> = {
  type: SPECTRUM_TYPE,
  title: 'Фотон и шкала электромагнитных волн',
  version: 1,
  propsSchema: spectrumPropsSchema,
  createProps: () => ({ lg: Math.log10(5e-7) }),
  deserialize: (r) => r as unknown as BoardObject<SpectrumProps>,
  ...boxed(() => ({ x: -64, y: -134, width: SW + 110, height: 300 })),
  // Отметку длины волны тянут без выделения.
  hitPriority: 1,
  getHandles: (o) => [{ id: 'lg', kind: 'param', position: toWorld(o, { x: SX(o.props.lg), y: -6 }), label: 'Длина волны', snap: false }],
  dragHandle: (o, id, to) => {
    if (id !== 'lg') return null;
    const lg = LG0 + (Math.max(0, Math.min(SW, toLocal(o, to).x)) / SW) * (LG1 - LG0);
    return { props: { lg: Math.round(lg * 100) / 100 } };
  },
  render: (o, ctx) => <SpectrumShape o={o} ctx={ctx} />,
  inspector: [num('lg', 'lg(λ / 1 м)', -14, 4, 0.05, true)],
} as ObjectModule<SpectrumProps, ReactNode>;

// =====================================================================
//  Волны де Бройля
// =====================================================================

const particleKeys = Object.keys(PARTICLES) as [string, ...string[]];
export const dbPropsSchema = z.object({
  particle: z.enum(particleKeys),
  /** Масса тела (для «Тела»), кг. */
  m: z.number().finite().min(1e-30).max(1e30),
  /** Скорость задана (v) или частица разогнана напряжением (U). */
  mode: z.enum(['v', 'U']),
  v: z.number().finite().min(1e-6).max(2.99e8),
  U: z.number().finite().min(1e-3).max(1e9),
});
export type DbProps = z.infer<typeof dbPropsSchema>;
const DW = 600;
const DLG0 = -36;
const DLG1 = -2;
const DX = (lg: number) => ((Math.max(DLG0, Math.min(DLG1, lg)) - DLG0) / (DLG1 - DLG0)) * DW;

export function dbOf(p: DbProps) {
  const part = PARTICLES[p.particle]!;
  const m = p.particle === 'body' ? p.m : part.m;
  const byU = p.mode === 'U' && part.q > 0;
  const v = byU ? speedAfter(m, part.q, p.U) : p.v;
  return { part, m, byU, ...deBroglie(m, v) };
}

function DbShape({ o, ctx }: { o: BoardObject<DbProps>; ctx: RenderContext }) {
  const p = o.props;
  const d = dbOf(p);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const lg = Math.log10(d.lambda);
  const verdict =
    d.lambda > 1e-11 && d.lambda < 1e-6 ? 'λ сравнима с расстоянием между атомами — дифракция на кристалле заметна (опыт Дэвиссона — Джермера)'
    : d.lambda <= 1e-20 ? 'λ ничтожно мала по сравнению с любыми препятствиями — волновые свойства незаметны'
    : 'λ много меньше атома: дифракция заметна только на ядрах';
  return (
    <Group listening={false}>
      <Circle x={20} y={30} radius={p.particle === 'body' ? 16 : 9} fill={p.particle === 'electron' ? ELECTRON : p.particle === 'body' ? ctx.resolveColor('accent-4') : HI} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Shape
        sceneFunc={(c, shape) => {
          const g = raw(c);
          g.beginPath();
          for (let k = 0; k <= 400; k++) {
            const x = 44 + k;
            const env = Math.exp(-(((k - 200) / 120) ** 2));
            const y = 30 + 16 * env * Math.sin((k / 400) * 16 * Math.PI);
            if (k) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          c.strokeShape(shape);
        }}
        stroke={ELECTRON}
        strokeWidth={1.6}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Text x={250} y={52} text="λ = h/p" fontSize={14} {...italic} fill={ink} listening={false} />
      {/* Логарифмическая шкала размеров. */}
      <Group y={110}>
        <Line points={[0, 0, DW, 0]} stroke={ink} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
        {Array.from({ length: (DLG1 - DLG0) / 4 + 1 }, (_, k) => DLG0 + 4 * k).map((e) => (
          <Group key={e}>
            <Line points={[DX(e), -4, DX(e), 4]} stroke={ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            <Text x={DX(e) - 24} y={8} width={48} align="center" text={`10${sup(e)}`} fontSize={11} fill={muted} listening={false} />
          </Group>
        ))}
        <Text x={DW + 8} y={6} text="м" fontSize={12} fill={muted} listening={false} />
        {SIZES.map((s, i) => (
          <Group key={s.title}>
            <Circle x={DX(Math.log10(s.size))} y={0} radius={3} fill={muted} listening={false} />
            <Text x={DX(Math.log10(s.size)) - 30} y={i % 2 ? 24 : -18} width={60} align="center" text={s.title} fontSize={11} fill={muted} listening={false} />
          </Group>
        ))}
        <Line points={[DX(lg), -26, DX(lg), 0]} stroke={HI} strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />
        <Text x={DX(lg) - 30} y={-44} width={60} align="center" text="λ" fontSize={15} {...italic} fill={HI} listening={false} />
      </Group>
      <Info
        x={0}
        y={-92}
        ink={ink}
        muted={muted}
        lines={[
          `${d.part.title}: m = ${sci(d.m)} кг,  v = ${sci(d.v)} м/с${d.byU ? ` (после разгона U = ${sci(p.U)} В)` : ''}${p.mode === 'U' && !d.byU ? ' — частица не заряжена, напряжение её не разгоняет' : ''}`,
          `p = ${d.relativistic ? 'γmv' : 'mv'} = ${sci(d.p)} кг·м/с,  λ = h/p = ${sci(d.lambda)} м`,
          verdict,
        ]}
      />
    </Group>
  );
}

export const debroglieModule: ObjectModule<DbProps, ReactNode> = {
  type: DEBROGLIE_TYPE,
  title: 'Волны де Бройля',
  version: 1,
  propsSchema: dbPropsSchema,
  createProps: () => ({ particle: 'electron', m: 0.1, mode: 'U', v: 1e6, U: 100 }),
  deserialize: (r) => r as unknown as BoardObject<DbProps>,
  ...boxed(() => ({ x: -10, y: -96, width: DW + 60, height: 250 })),
  render: (o, ctx) => <DbShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'select', key: 'particle', label: 'Частица', options: Object.entries(PARTICLES).map(([value, x]) => ({ value, label: x.title })) },
    { kind: 'select', key: 'mode', label: 'Скорость', options: [{ value: 'U', label: 'после разгона напряжением U' }, { value: 'v', label: 'задана' }] },
    num('U', 'U, В', 1e-3, 1e9, 10),
    num('v', 'v, м/с', 1e-6, 2.99e8, 100),
    num('m', 'm тела, кг', 1e-30, 1e30, 0.1),
  ],
} as ObjectModule<DbProps, ReactNode>;

export const modernModules = [relativityModule, photoModule, spectrumModule, debroglieModule];
