import type { ReactNode } from 'react';
import { Arrow, Circle, Ellipse, Group, Line, Rect as KRect, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { useBoard } from '../../store/board';
import { fmt } from '../common/quantities';
import { VecLabel } from '../common/vectors';
import { fieldLines, withPrefix } from '../electricity/field';
import { PLAY0, playAction, playSchema, usePlayTime } from '../mechanics/playback';
import { PLAY_FIELDS, placeGraphs, playText } from '../mechanics/objects';
import { numText } from '../mechanics/kinematics';
import { PARTICLES, bz, crossZ, lenz, orbit, rotor, wireTangent, type Out, type ParticleKind } from './magnet';

export const PLUGIN_ID = 'physics.magnetism';
export const WIRE_TYPE = `${PLUGIN_ID}.wire`;
export const COIL_TYPE = `${PLUGIN_ID}.coil`;
export const MAGNET_TYPE = `${PLUGIN_ID}.magnet`;
export const LORENTZ_TYPE = `${PLUGIN_ID}.lorentz`;
export const AMPERE_TYPE = `${PLUGIN_ID}.ampere`;
export const ROTOR_TYPE = `${PLUGIN_ID}.rotor`;
export const LENZ_TYPE = `${PLUGIN_ID}.lenz`;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const FIELD = '#2563eb';
const FORCE = '#d13a3a';
const CURRENT = '#ea580c';
const N_COL = '#d13a3a';
const S_COL = '#2563eb';
const INFO = 14;
const outSchema = z.enum(['out', 'in']);
const PLAY_ONLY = PLAY_FIELDS.filter((f) => f.key !== 'graphs');
const dirSelect = (key: string, label: string) => ({ kind: 'select' as const, key, label, options: [{ value: 'out', label: 'на нас (·)' }, { value: 'in', label: 'от нас (×)' }] });
const num = (key: string, label: string, min: number, max: number, step: number) => ({ kind: 'number' as const, key, label, min, max, step });

// =====================================================================
//  Общие части
// =====================================================================

/** Ток или поле перпендикулярно доске: точка «на нас», крестик «от нас». */
export function Mark({ x, y, dir, r, color }: { x: number; y: number; dir: Out; r: number; color: string }) {
  const d = r * 0.6;
  return (
    <Group x={x} y={y} listening={false}>
      <Circle radius={r} stroke={color} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />
      {dir === 'out' ? <Circle radius={r * 0.28} fill={color} listening={false} /> : <Line points={[-d, -d, d, d, 0, 0, -d, d, d, -d]} stroke={color} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />}
    </Group>
  );
}

/** Однородное поле, перпендикулярное доске: точки или крестики сеткой. */
function FieldGrid({ w, h, dir }: { w: number; h: number; dir: Out }) {
  const els: ReactNode[] = [];
  // Метки крупные: крестик и точку надо различать и при уменьшенном масштабе.
  for (let y = 22; y < h; y += 44) for (let x = 22; x < w; x += 44) els.push(<Mark key={`${x},${y}`} x={x} y={y} dir={dir} r={8} color={FIELD} />);
  return (
    <Group listening={false} opacity={0.6}>
      <KRect width={w} height={h} stroke={FIELD} strokeWidth={1} dash={[4, 4]} strokeScaleEnabled={false} listening={false} />
      {els}
    </Group>
  );
}

function Vec({ x, y, dx, dy, label, color }: { x: number; y: number; dx: number; dy: number; label: string; color: string }) {
  const zoom = useZoom();
  if (Math.hypot(dx, dy) < 2) return null;
  return (
    <Group listening={false}>
      <Arrow points={[x, y, x + dx, y + dy]} stroke={color} fill={color} strokeWidth={2.4} strokeScaleEnabled={false} pointerLength={11 / zoom} pointerWidth={8 / zoom} listening={false} />
      <VecLabel x={x + dx + (dx >= 0 ? 4 : -28)} y={y + dy + (dy >= 0 ? 0 : -22)} label={label} color={color} size={16} />
    </Group>
  );
}

function Info({ x, y, lines, ink, muted }: { x: number; y: number; lines: string[]; ink: string; muted: string }) {
  return (
    <Group listening={false}>
      {lines.map((l, i) => (
        <Text key={i} x={x} y={y + i * INFO * 1.35} text={l} fontSize={i ? INFO * 0.92 : INFO} fill={i ? muted : ink} listening={false} />
      ))}
    </Group>
  );
}

/** Модуль с прямоугольной областью: габарит, попадание по габариту, без ручек. */
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
  };
}

/** Линии двухполюсного поля (магнит, катушка): «магнитные заряды» в полюсах, из N в S. */
const poleCache = new Map<string, number[][]>();
function poleLines(len: number, w: number, h: number): number[][] {
  const key = `${len}:${w}:${h}`;
  let l = poleCache.get(key);
  if (!l) {
    l = fieldLines({ charges: [{ id: 'n', x: w / 2 + len / 2, y: h / 2, q: 1 }, { id: 's', x: w / 2 - len / 2, y: h / 2, q: -1 }], cell: 1, eps: 1 }, w, h, 14).map((pts) => pts.map((v, i) => v - (i % 2 ? h / 2 : w / 2)));
    poleCache.set(key, l);
  }
  return l;
}

function PoleLines({ len, color, flip }: { len: number; color: string; flip: boolean }) {
  const zoom = useZoom();
  const lines = poleLines(len, 480, 320);
  return (
    <Group scaleX={flip ? -1 : 1} listening={false}>
      {lines.map((l, i) => {
        const m = Math.max(1, Math.floor(l.length / 4));
        return (
          <Group key={i}>
            <Line points={l} stroke={color} opacity={0.7} strokeWidth={1.1} strokeScaleEnabled={false} listening={false} />
            {l.length > 8 && <Arrow points={[l[2 * m - 2]!, l[2 * m - 1]!, l[2 * m]!, l[2 * m + 1]!]} stroke={color} fill={color} strokeWidth={1} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />}
          </Group>
        );
      })}
    </Group>
  );
}

// =====================================================================
//  Прямой ток перпендикулярно доске
// =====================================================================

export const wirePropsSchema = z.object({ dir: outSchema, I: z.number().finite().min(0).max(1e6), rings: z.number().int().min(1).max(8) });
export type WireProps = z.infer<typeof wirePropsSchema>;

function WireShape({ o, ctx }: { o: BoardObject<WireProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const els: ReactNode[] = [];
  for (let k = 1; k <= p.rings; k++) {
    const r = 22 + k * 26;
    els.push(<Circle key={`c${k}`} radius={r} stroke={FIELD} opacity={0.7} strokeWidth={1.1} strokeScaleEnabled={false} listening={false} />);
    // Стрелки на окружности — направление линий (правило буравчика).
    for (const a of [Math.PI / 4 + k * 0.4, (5 * Math.PI) / 4 + k * 0.4]) {
      const t = wireTangent(a, p.dir);
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      els.push(<Arrow key={`a${k}${a}`} points={[x - t.x * 5, y - t.y * 5, x + t.x * 5, y + t.y * 5]} stroke={FIELD} fill={FIELD} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={7 / zoom} listening={false} />);
    }
  }
  const R = 22 + p.rings * 26;
  return (
    <Group listening={false}>
      {els}
      <Mark x={0} y={0} dir={p.dir} r={12} color={CURRENT} />
      <Text x={16} y={-28} text={`I = ${fmt(p.I)} А ${p.dir === 'out' ? '(на нас)' : '(от нас)'}`} fontSize={14} fill={ink} listening={false} />
      <VecLabel x={R * 0.72 + 6} y={-R * 0.72 - 22} label="B" color={FIELD} size={16} />
    </Group>
  );
}

const wireBox = (p: WireProps): Rect => {
  const R = 22 + p.rings * 26 + 10;
  return { x: -R, y: -R, width: 2 * R, height: 2 * R };
};

export const wireModule: ObjectModule<WireProps, ReactNode> = {
  type: WIRE_TYPE,
  title: 'Прямой ток',
  version: 1,
  propsSchema: wirePropsSchema,
  createProps: () => ({ dir: 'out', I: 5, rings: 4 }),
  deserialize: (r) => r as unknown as BoardObject<WireProps>,
  ...boxed(wireBox),
  render: (o, ctx) => <WireShape o={o} ctx={ctx} />,
  inspector: [dirSelect('dir', 'Ток'), num('I', 'I, А', 0, 1e6, 1), num('rings', 'Линий', 1, 8, 1)],
  transform: { rotatable: false, resize: 'none' },
} as ObjectModule<WireProps, ReactNode>;

// =====================================================================
//  Катушка с током и постоянный магнит
// =====================================================================

export const coilPropsSchema = z.object({ topOut: z.boolean(), turns: z.number().int().min(2).max(16), lines: z.boolean() });
export type CoilProps = z.infer<typeof coilPropsSchema>;
const CL = 200;
const CH = 70;

function CoilShape({ o, ctx }: { o: BoardObject<CoilProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  // Верхние витки «на нас» — поле внутри вправо, N справа.
  const nRight = p.topOut;
  const marks: ReactNode[] = [];
  for (let i = 0; i < p.turns; i++) {
    const x = -CL / 2 + ((i + 0.5) * CL) / p.turns;
    marks.push(<Mark key={`t${i}`} x={x} y={-CH / 2} dir={p.topOut ? 'out' : 'in'} r={7} color={CURRENT} />, <Mark key={`b${i}`} x={x} y={CH / 2} dir={p.topOut ? 'in' : 'out'} r={7} color={CURRENT} />);
  }
  return (
    <Group listening={false}>
      {p.lines && <PoleLines len={CL} color={FIELD} flip={!nRight} />}
      {p.lines &&
        [-14, 0, 14].map((y) => (
          <Arrow key={y} points={nRight ? [-CL / 2 + 20, y, CL / 2 - 20, y] : [CL / 2 - 20, y, -CL / 2 + 20, y]} stroke={FIELD} fill={FIELD} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />
        ))}
      <KRect x={-CL / 2} y={-CH / 2} width={CL} height={CH} stroke={ink} strokeWidth={1.2} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      {marks}
      <Text x={CL / 2 + 10} y={-10} text={nRight ? 'N' : 'S'} fontSize={20} fontStyle="bold" fill={nRight ? N_COL : S_COL} listening={false} />
      <Text x={-CL / 2 - 26} y={-10} text={nRight ? 'S' : 'N'} fontSize={20} fontStyle="bold" fill={nRight ? S_COL : N_COL} listening={false} />
    </Group>
  );
}

export const coilModule: ObjectModule<CoilProps, ReactNode> = {
  type: COIL_TYPE,
  title: 'Катушка с током',
  version: 1,
  propsSchema: coilPropsSchema,
  createProps: () => ({ topOut: true, turns: 8, lines: true }),
  deserialize: (r) => r as unknown as BoardObject<CoilProps>,
  ...boxed(() => ({ x: -240, y: -160, width: 480, height: 320 })),
  render: (o, ctx) => <CoilShape o={o} ctx={ctx} />,
  inspector: [{ kind: 'toggle', key: 'topOut', label: 'Ток сверху на нас' }, num('turns', 'Витков', 2, 16, 1), { kind: 'toggle', key: 'lines', label: 'Линии поля' }],
  transform: { rotatable: true, resize: 'none' },
} as ObjectModule<CoilProps, ReactNode>;

export const magnetPropsSchema = z.object({ nRight: z.boolean(), lines: z.boolean() });
export type MagnetProps = z.infer<typeof magnetPropsSchema>;
const ML = 160;
const MH = 40;

function MagnetBar({ x, nRight, label = true }: { x: number; nRight: boolean; label?: boolean }) {
  return (
    <Group x={x} listening={false}>
      <KRect x={-ML / 2} y={-MH / 2} width={ML / 2} height={MH} fill={nRight ? S_COL : N_COL} listening={false} />
      <KRect x={0} y={-MH / 2} width={ML / 2} height={MH} fill={nRight ? N_COL : S_COL} listening={false} />
      {label && <Text x={-ML / 2 + 10} y={-10} text={nRight ? 'S' : 'N'} fontSize={20} fontStyle="bold" fill="#ffffff" listening={false} />}
      {label && <Text x={ML / 2 - 24} y={-10} text={nRight ? 'N' : 'S'} fontSize={20} fontStyle="bold" fill="#ffffff" listening={false} />}
    </Group>
  );
}

export const magnetModule: ObjectModule<MagnetProps, ReactNode> = {
  type: MAGNET_TYPE,
  title: 'Постоянный магнит',
  version: 1,
  propsSchema: magnetPropsSchema,
  createProps: () => ({ nRight: true, lines: true }),
  deserialize: (r) => r as unknown as BoardObject<MagnetProps>,
  ...boxed(() => ({ x: -240, y: -160, width: 480, height: 320 })),
  render: (o) => (
    <Group listening={false}>
      {o.props.lines && <PoleLines len={ML - 20} color={FIELD} flip={!o.props.nRight} />}
      <MagnetBar x={0} nRight={o.props.nRight} />
    </Group>
  ),
  inspector: [{ kind: 'toggle', key: 'nRight', label: 'N справа' }, { kind: 'toggle', key: 'lines', label: 'Линии поля' }],
  transform: { rotatable: true, resize: 'none' },
} as ObjectModule<MagnetProps, ReactNode>;

// =====================================================================
//  Заряд в однородном магнитном поле (сила Лоренца)
// =====================================================================

export const lorentzPropsSchema = z.object({ particle: z.enum(['electron', 'proton', 'alpha']), v: z.number().finite().min(1).max(3e8), B: z.number().finite().min(1e-6).max(100), dir: outSchema, speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type LorentzProps = z.infer<typeof lorentzPropsSchema>;
const LW = 440;
const LH = 320;
const LR = 110;
/** Один оборот на доске показывается за 4 с (настоящий период — наносекунды). */
const SHOW_T = 4;

function LorentzShape({ o, ctx }: { o: BoardObject<LorentzProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const pt = PARTICLES[p.particle as ParticleKind];
  const orb = orbit(pt.q, pt.m, p.v, p.B, p.dir);
  const t = usePlayTime(p.play, SHOW_T * 2, p.speed);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  // Начало — вверху окружности, скорость вправо; центр — в сторону силы.
  const cx = LW / 2;
  const cy = LH / 2 + 10;
  const th = -Math.PI / 2 + (orb.turn * 2 * Math.PI * t) / SHOW_T;
  const x = cx + LR * Math.cos(th);
  const y = cy + LR * Math.sin(th);
  const tx = -Math.sin(th) * orb.turn;
  const ty = Math.cos(th) * orb.turn;
  return (
    <Group listening={false}>
      <FieldGrid w={LW} h={LH} dir={p.dir} />
      <Circle x={cx} y={cy} radius={LR} stroke={muted} strokeWidth={1} dash={[6 / zoom, 5 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Circle x={cx} y={cy} radius={2.5} fill={muted} listening={false} />
      <Vec x={x} y={y} dx={tx * 60} dy={ty * 60} label="v" color={FIELD} />
      <Vec x={x} y={y} dx={(cx - x) * 0.45} dy={(cy - y) * 0.45} label="F_Л" color={FORCE} />
      <Circle x={x} y={y} radius={10} fill={pt.q > 0 ? N_COL : S_COL} listening={false} />
      <Text x={x - 10} y={y - 9} width={20} align="center" text={pt.q > 0 ? '+' : '−'} fontSize={16} fontStyle="bold" fill="#ffffff" listening={false} />
      <Info
        x={0}
        y={-58}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${pt.title}: v = ${withPrefix(p.v, 'м/с')}, B = ${withPrefix(p.B, 'Тл')} ${p.dir === 'out' ? '(на нас)' : '(от нас)'}`,
          `F = |q|vB = ${withPrefix(orb.F, 'Н')},  r = mv/(|q|B) = ${withPrefix(orb.r, 'м')},  T = 2πm/(|q|B) = ${withPrefix(orb.T, 'с')}`,
          'Направление силы — по правилу левой руки (для отрицательного заряда — наоборот)',
        ]}
      />
    </Group>
  );
}

export const lorentzModule: ObjectModule<LorentzProps, ReactNode> = {
  type: LORENTZ_TYPE,
  title: 'Заряд в магнитном поле',
  version: 1,
  propsSchema: lorentzPropsSchema,
  createProps: () => ({ particle: 'proton', v: 1e6, B: 0.1, dir: 'in', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<LorentzProps>,
  ...boxed(() => ({ x: 0, y: -62, width: LW + 120, height: LH + 62 })),
  render: (o, ctx) => <LorentzShape o={o} ctx={ctx} />,
  inspector: [
    ...PLAY_ONLY,
    { kind: 'select', key: 'particle', label: 'Частица', options: Object.entries(PARTICLES).map(([value, x]) => ({ value, label: x.title })) },
    num('v', 'v, м/с', 1, 3e8, 1e5),
    num('B', 'B, Тл', 1e-6, 100, 0.01),
    dirSelect('dir', 'Поле'),
  ],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, SHOW_T * 2, o.props.speed, ctx.now);
    if (play) ctx.updateObject<LorentzProps>(o.id, { props: { play } });
  },
  transform: { rotatable: false, resize: 'none' },
} as ObjectModule<LorentzProps, ReactNode>;

// =====================================================================
//  Проводник с током в поле (сила Ампера)
// =====================================================================

export const amperePropsSchema = z.object({ B: z.number().finite().min(0).max(100), I: z.number().finite().min(0).max(1e6), L: z.number().finite().min(0.001).max(1000), dir: outSchema, toRight: z.boolean() });
export type AmpereProps = z.infer<typeof amperePropsSchema>;
const AW = 400;
const AH = 260;

function AmpereShape({ o, ctx }: { o: BoardObject<AmpereProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const s = p.toRight ? 1 : -1;
  const f = crossZ(s, 0, bz(1, p.dir));
  const F = p.B * p.I * p.L;
  const y = AH / 2;
  return (
    <Group listening={false}>
      <FieldGrid w={AW} h={AH} dir={p.dir} />
      <Line points={[40, y, AW - 40, y]} stroke={ink} strokeWidth={5} lineCap="round" strokeScaleEnabled={false} listening={false} />
      <Arrow points={p.toRight ? [AW / 2 - 70, y - 14, AW / 2 - 20, y - 14] : [AW / 2 + 20, y - 14, AW / 2 - 30, y - 14]} stroke={CURRENT} fill={CURRENT} strokeWidth={2} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />
      <Text x={AW / 2 - 70} y={y - 36} text="I" fontSize={16} {...italic} fill={CURRENT} listening={false} />
      {F > 0 && <Vec x={AW / 2 + 40} y={y} dx={f.x * 70} dy={f.y * 70} label="F_A" color={FORCE} />}
      <Info x={0} y={-48} ink={ink} muted={muted} lines={[`F_A = BIL = ${withPrefix(F, 'Н')}  (B = ${withPrefix(p.B, 'Тл')}, I = ${fmt(p.I)} А, L = ${fmt(p.L)} м)`, 'Направление — по правилу левой руки']} />
    </Group>
  );
}

export const ampereModule: ObjectModule<AmpereProps, ReactNode> = {
  type: AMPERE_TYPE,
  title: 'Проводник в магнитном поле',
  version: 1,
  propsSchema: amperePropsSchema,
  createProps: () => ({ B: 0.5, I: 4, L: 0.2, dir: 'in', toRight: true }),
  deserialize: (r) => r as unknown as BoardObject<AmpereProps>,
  ...boxed(() => ({ x: 0, y: -52, width: AW, height: AH + 52 })),
  render: (o, ctx) => <AmpereShape o={o} ctx={ctx} />,
  inspector: [num('B', 'B, Тл', 0, 100, 0.1), num('I', 'I, А', 0, 1e6, 1), num('L', 'L, м', 0.001, 1000, 0.05), dirSelect('dir', 'Поле'), { kind: 'toggle', key: 'toRight', label: 'Ток вправо' }],
  transform: { rotatable: true, resize: 'none' },
} as ObjectModule<AmpereProps, ReactNode>;

// =====================================================================
//  Рамка, вращающаяся в магнитном поле (индукция)
// =====================================================================

export const rotorPropsSchema = z.object({ B: z.number().finite().min(0).max(100), S: z.number().finite().min(0.01).max(1e7), N: z.number().int().min(1).max(100000), f: z.number().finite().min(0.01).max(100), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type RotorProps = z.infer<typeof rotorPropsSchema>;
/** Показ: 3 оборота; при частоте больше 1 об/с — замедленно, один оборот за секунду. */
const shownF = (f: number) => Math.min(f, 1);
const rotorEnd = (p: RotorProps) => 3 / shownF(p.f);

function RotorShape({ o, ctx }: { o: BoardObject<RotorProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ts = usePlayTime(p.play, rotorEnd(p), p.speed);
  // Настоящее время модели: показ замедлен в f / shownF раз.
  const t = (ts * shownF(p.f)) / p.f;
  const r = rotor(p.B, p.S, p.N, p.f);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const ang = r.omega * t;
  const half = 70 * Math.abs(Math.cos(ang));
  const emf = r.emf(t);
  const els: ReactNode[] = [];
  for (const y of [-90, -45, 0, 45, 90]) els.push(<Arrow key={y} points={[-200, y, 200, y]} stroke={FIELD} opacity={0.5} strokeWidth={1.1} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />);
  return (
    <Group listening={false}>
      {els}
      <VecLabel x={190} y={-118} label="B" color={FIELD} size={16} />
      <Line points={[0, -130, 0, 130]} stroke={muted} strokeWidth={1} dash={[6 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
      {/* Рамка сбоку: ширина видна как |cos ωt| — плоскость рамки поворачивается вокруг вертикальной оси. */}
      <KRect x={-half} y={-80} width={2 * half} height={160} stroke={ink} strokeWidth={3} fill={CURRENT} opacity={0.15 + 0.15 * Math.abs(Math.cos(ang))} strokeScaleEnabled={false} listening={false} />
      {Math.abs(emf) > 1e-9 * Math.max(1, r.emfMax) && half > 6 && <Arrow points={emf > 0 ? [-half, 40, -half, -40] : [-half, -40, -half, 40]} stroke={CURRENT} fill={CURRENT} strokeWidth={2} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />}
      <Info
        x={-200}
        y={-196}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} t = ${withPrefix(t, 'с')}   Φ = BS cos ωt = ${withPrefix(r.flux(t), 'Вб')}   ε = ${withPrefix(emf, 'В')}`,
          `B = ${withPrefix(p.B, 'Тл')}, S = ${fmt(p.S)} см², N = ${p.N}, ${fmt(p.f)} об/с:  εmax = NBSω = ${withPrefix(r.emfMax, 'В')}`,
          'Индукционный ток противодействует изменению потока (правило Ленца)',
        ]}
      />
    </Group>
  );
}

export const rotorModule: ObjectModule<RotorProps, ReactNode> = {
  type: ROTOR_TYPE,
  title: 'Рамка в магнитном поле',
  version: 1,
  propsSchema: rotorPropsSchema,
  createProps: () => ({ B: 0.2, S: 400, N: 100, f: 0.5, speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<RotorProps>,
  ...boxed(() => ({ x: -210, y: -200, width: 460, height: 340 })),
  render: (o, ctx) => <RotorShape o={o} ctx={ctx} />,
  inspector: [...PLAY_FIELDS, num('B', 'B, Тл', 0, 100, 0.05), num('S', 'S, см²', 0.01, 1e7, 50), num('N', 'Витков', 1, 100000, 10), num('f', 'Об/с', 0.01, 100, 0.5)],
  runAction: (o, key, ctx) => {
    const p = o.props;
    if (key === 'graphs') {
      const r = rotor(p.B, p.S, p.N, p.f);
      const base = { xSym: 't', xUnit: 'с', from: '0', to: String(Math.round((2 / p.f) * 1000) / 1000) };
      const w = numText(r.omega);
      placeGraphs(o, { x: -210, y: -200, width: 460, height: 340 }, [{ ...base, ySym: 'Φ', yUnit: 'Вб', expr: `${numText(p.B * p.S * 1e-4)}cos(${w}t)` }, { ...base, ySym: 'ε', yUnit: 'В', expr: `${numText(r.emfMax)}sin(${w}t)` }], ctx);
      return;
    }
    const play = playAction(key, p.play, rotorEnd(p), p.speed, ctx.now);
    if (play) ctx.updateObject<RotorProps>(o.id, { props: { play } });
  },
  transform: { rotatable: false, resize: 'none' },
} as ObjectModule<RotorProps, ReactNode>;

// =====================================================================
//  Правило Ленца: магнит и кольцо
// =====================================================================

export const lenzPropsSchema = z.object({ facing: z.enum(['N', 'S']), speed: z.number().finite().min(0.1).max(10), play: playSchema });
export type LenzProps = z.infer<typeof lenzPropsSchema>;
const LENZ_T = 4;

function LenzShape({ o, ctx }: { o: BoardObject<LenzProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const t = usePlayTime(p.play, LENZ_T, p.speed);
  const s = lenz(t, LENZ_T, p.facing);
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const mx = -300 + s.x * 170;
  // Обращённый к магниту (левый) полюс кольца N — поле внутри кольца влево: ток сверху «от нас».
  const top: Out = s.ringPole === 'N' ? 'in' : 'out';
  const moving = t > 0 && t < LENZ_T;
  return (
    <Group listening={false}>
      <MagnetBar x={mx} nRight={p.facing === 'N'} />
      {moving && <Vec x={mx} y={-34} dx={s.approaching ? 50 : -50} dy={0} label="v" color={FIELD} />}
      <Ellipse x={0} y={0} radiusX={14} radiusY={60} stroke={ink} strokeWidth={4} strokeScaleEnabled={false} listening={false} />
      {moving && <Mark x={0} y={-60} dir={top} r={9} color={CURRENT} />}
      {moving && <Mark x={0} y={60} dir={top === 'out' ? 'in' : 'out'} r={9} color={CURRENT} />}
      {moving && <Text x={-36} y={-10} text={s.ringPole} fontSize={20} fontStyle="bold" fill={s.ringPole === 'N' ? N_COL : S_COL} listening={false} />}
      {moving && <Text x={22} y={-10} text={s.ringPole === 'N' ? 'S' : 'N'} fontSize={20} fontStyle="bold" fill={s.ringPole === 'N' ? S_COL : N_COL} listening={false} />}
      <Info
        x={-400}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `${playText(p.play)} ${!moving ? 'Нажмите «Пуск»: магнит приблизится к кольцу и удалится' : s.approaching ? 'Магнит приближается — поток растёт' : 'Магнит удаляется — поток убывает'}`,
          !moving ? 'Правило Ленца: индукционный ток своим полем препятствует изменению потока' : s.approaching ? `Ток в кольце создаёт навстречу магниту полюс ${s.ringPole} — кольцо отталкивает магнит` : `Ток в кольце создаёт со стороны магнита полюс ${s.ringPole} — кольцо притягивает магнит`,
        ]}
      />
      <Line points={[-400, 80, 60, 80]} stroke={muted} strokeWidth={0.6} dash={[3 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />
    </Group>
  );
}

export const lenzModule: ObjectModule<LenzProps, ReactNode> = {
  type: LENZ_TYPE,
  title: 'Правило Ленца',
  version: 1,
  propsSchema: lenzPropsSchema,
  createProps: () => ({ facing: 'N', speed: 1, play: PLAY0 }),
  deserialize: (r) => r as unknown as BoardObject<LenzProps>,
  ...boxed(() => ({ x: -400, y: -122, width: 470, height: 210 })),
  render: (o, ctx) => <LenzShape o={o} ctx={ctx} />,
  inspector: [...PLAY_ONLY, { kind: 'select', key: 'facing', label: 'К кольцу обращён', options: [{ value: 'N', label: 'северный полюс N' }, { value: 'S', label: 'южный полюс S' }] }],
  runAction: (o, key, ctx) => {
    const play = playAction(key, o.props.play, LENZ_T, o.props.speed, ctx.now);
    if (play) ctx.updateObject<LenzProps>(o.id, { props: { play } });
  },
  transform: { rotatable: false, resize: 'none' },
} as ObjectModule<LenzProps, ReactNode>;

export const magnetismModules = [wireModule, coilModule, magnetModule, lorentzModule, ampereModule, rotorModule, lenzModule];
