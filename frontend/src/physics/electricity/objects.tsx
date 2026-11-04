import type { ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Rect as KRect, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Point, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { VecLabel } from '../common/vectors';
import { CELL_PX, capacitor, equipotentials, fieldAt, fieldLines, forces, pxToM, withPrefix, type Charge, type System } from './field';

export const PLUGIN_ID = 'physics.electricity';
export const SYSTEM_TYPE = `${PLUGIN_ID}.charges`;
export const CAPACITOR_TYPE = `${PLUGIN_ID}.capacitor`;
export const CHARGES_EDITOR = 'physics.charges';
export const MAX_CHARGES = 12;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const POS = '#d13a3a';
const NEG = '#2563eb';
const R = 13;

const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
/** «q₁», «q₁₂». */
export const qName = (i: number) => `q${String(i + 1).split('').map((d) => SUB[Number(d)]).join('')}`;
const sign = (q: number) => (q > 0 ? '+' : '−');
const qText = (q: number) => `${sign(q)}${String(Math.abs(q)).replace('.', ',')} нКл`;

// =====================================================================
//  Система зарядов
// =====================================================================

const chargeSchema = z.object({ id: z.string().min(1).max(16), x: z.number().finite().min(-1e5).max(1e5), y: z.number().finite().min(-1e5).max(1e5), q: z.number().finite().min(-1e6).max(1e6).refine((v) => v !== 0, 'Заряд не может быть нулём') });

export const systemPropsSchema = z.object({
  /** Рамка: в её пределах строятся линии и эквипотенциали. */
  w: z.number().finite().min(120).max(4000),
  h: z.number().finite().min(120).max(4000),
  charges: z.array(chargeSchema).max(MAX_CHARGES),
  /** Сантиметров в клетке (20 пикселей). */
  cell: z.number().finite().min(0.01).max(10000),
  eps: z.number().finite().min(1).max(1000),
  lines: z.boolean(),
  equip: z.boolean(),
  forces: z.boolean(),
  /** Пробная точка: напряжённость и потенциал. */
  probe: z.object({ x: z.number().finite(), y: z.number().finite() }),
  showProbe: z.boolean(),
});
export type SystemProps = z.infer<typeof systemPropsSchema>;
type SystemObject = BoardObject<SystemProps>;

interface Computed {
  lines: number[][];
  equip: { level: number; segs: number[] }[];
}
const cache = new WeakMap<SystemProps, Computed>();
/** Линии и эквипотенциали — по props (props при правке заменяется целиком). */
export function computed(p: SystemProps): Computed {
  let c = cache.get(p);
  if (!c) {
    const s = p as System;
    c = { lines: p.lines ? fieldLines(s, p.w, p.h) : [], equip: p.equip ? equipotentials(s, p.w, p.h) : [] };
    cache.set(p, c);
  }
  return c;
}

/** Сведения: для двух зарядов — закон Кулона, иначе силы на каждый заряд. */
export function systemInfo(p: SystemProps): string[] {
  const s = p as System;
  if (!p.charges.length) return ['Добавьте заряды инструментом «Заряд +» или «Заряд −»'];
  const fs = forces(s);
  if (p.charges.length === 2) {
    const [a, b] = p.charges as [Charge, Charge];
    const r = Math.hypot(a.x - b.x, a.y - b.y) * pxToM(s);
    const f = Math.hypot(fs[0]!.fx, fs[0]!.fy);
    return [`r = ${withPrefix(r, 'м')},  F = k|q₁q₂|/${p.eps === 1 ? 'r²' : '(εr²)'} = ${withPrefix(f, 'Н')} — ${a.q * b.q > 0 ? 'отталкиваются' : 'притягиваются'}`];
  }
  return [fs.map((f, i) => `F${qName(i).slice(1)} = ${withPrefix(Math.hypot(f.fx, f.fy), 'Н')}`).join(',  ')];
}

function SystemShape({ o, ctx }: { o: SystemObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const s = p as System;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const { lines, equip } = computed(p);
  const fs = p.forces ? forces(s) : [];
  const fMax = Math.max(...fs.map((f) => Math.hypot(f.fx, f.fy)), 1e-300);
  const head = { pointerLength: 10 / zoom, pointerWidth: 7 / zoom };
  const probe = p.showProbe ? fieldAt(s, p.probe.x, p.probe.y) : null;
  const eLen = probe ? Math.hypot(probe.ex, probe.ey) : 0;
  return (
    <Group listening={false}>
      <KRect width={p.w} height={p.h} stroke={ctx.selected ? muted : ctx.resolveColor('muted')} opacity={ctx.selected ? 1 : 0.35} strokeWidth={1} dash={[6 / zoom, 5 / zoom]} strokeScaleEnabled={false} listening={false} />
      {equip.map((e, i) => (
        <Shape
          key={`e${i}`}
          sceneFunc={(c, shape) => {
            const g = raw(c);
            g.beginPath();
            for (let k = 0; k + 3 < e.segs.length; k += 4) {
              g.moveTo(e.segs[k]!, e.segs[k + 1]!);
              g.lineTo(e.segs[k + 2]!, e.segs[k + 3]!);
            }
            c.strokeShape(shape);
          }}
          stroke="#16a34a"
          opacity={0.7}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {lines.map((l, i) => {
        // Стрелка направления — посередине линии.
        const n = l.length / 2;
        const m = Math.max(1, Math.floor(n / 2));
        const a = [l[2 * m - 2]!, l[2 * m - 1]!];
        const b = [l[2 * m]!, l[2 * m + 1]!];
        return (
          <Group key={`l${i}`}>
            <Line points={l} stroke={ink} opacity={0.75} strokeWidth={1.1} strokeScaleEnabled={false} listening={false} />
            {n > 4 && <Arrow points={[a[0]!, a[1]!, b[0]!, b[1]!]} stroke={ink} fill={ink} strokeWidth={1} strokeScaleEnabled={false} {...head} listening={false} />}
          </Group>
        );
      })}
      {fs.map((f, i) => {
        const c = p.charges[i]!;
        const l = Math.hypot(f.fx, f.fy);
        if (l <= 0) return null;
        const len = Math.max(16, (70 * l) / fMax);
        const dx = (f.fx / l) * (len + R);
        const dy = (f.fy / l) * (len + R);
        return (
          <Group key={`f${i}`}>
            <Arrow points={[c.x + (f.fx / l) * R, c.y + (f.fy / l) * R, c.x + dx, c.y + dy]} stroke="#7c3aed" fill="#7c3aed" strokeWidth={2.4} strokeScaleEnabled={false} {...head} listening={false} />
            <VecLabel x={c.x + dx + 4} y={c.y + dy - 20} label={`F_${i + 1}`} color="#7c3aed" size={15} />
          </Group>
        );
      })}
      {p.charges.map((c, i) => (
        <Group key={c.id}>
          <Circle x={c.x} y={c.y} radius={R} fill={c.q > 0 ? POS : NEG} stroke="#ffffff" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          <Text x={c.x - R} y={c.y - 9} width={R * 2} align="center" text={sign(c.q)} fontSize={18} fontStyle="bold" fill="#ffffff" listening={false} />
          <Text x={c.x + R + 3} y={c.y + R - 2} text={`${qName(i)} = ${qText(c.q)}`} fontSize={14} {...italic} fill={ink} listening={false} />
        </Group>
      ))}
      {probe && (
        <Group>
          <Circle x={p.probe.x} y={p.probe.y} radius={4} stroke={ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          {eLen > 0 && <Arrow points={[p.probe.x, p.probe.y, p.probe.x + (probe.ex / eLen) * 50, p.probe.y + (probe.ey / eLen) * 50]} stroke="#ea580c" fill="#ea580c" strokeWidth={2.2} strokeScaleEnabled={false} {...head} listening={false} />}
          <VecLabel x={p.probe.x + 8} y={p.probe.y + 6} label="E" color="#ea580c" size={15} />
          <Text x={p.probe.x + 8} y={p.probe.y + 26} text={`E = ${withPrefix(eLen, 'Н/Кл')}\nφ = ${withPrefix(probe.phi, 'В')}`} fontSize={13} lineHeight={1.3} fill="#ea580c" listening={false} />
        </Group>
      )}
      <Text x={6} y={6} text={[...systemInfo(p), `Масштаб: 1 клетка — ${String(p.cell).replace('.', ',')} см${p.eps !== 1 ? `, ε = ${String(p.eps).replace('.', ',')}` : ''}`].join('\n')} fontSize={13} lineHeight={1.35} fill={muted} listening={false} />
    </Group>
  );
}

const near = (a: Point, b: Point, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

export const systemModule: ObjectModule<SystemProps, ReactNode> = {
  type: SYSTEM_TYPE,
  title: 'Система зарядов',
  version: 1,
  propsSchema: systemPropsSchema as unknown as z.ZodType<SystemProps>,
  createProps: () => ({ w: 600, h: 400, charges: [], cell: 1, eps: 1, lines: true, equip: true, forces: true, probe: { x: 300, y: 80 }, showProbe: false }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as SystemObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: o.props.h }),
  // Объект берётся за заряды, пробную точку и край рамки — пустое поле внутри рамки «прозрачно».
  hitTest: (o, point, tol) => {
    const q = toLocal(o, point);
    const p = o.props;
    if (p.charges.some((c) => near(q, c, R + tol))) return true;
    if (p.showProbe && near(q, p.probe, 8 + tol)) return true;
    const inX = q.x >= -tol && q.x <= p.w + tol;
    const inY = q.y >= -tol && q.y <= p.h + tol;
    return (inX && inY && (Math.abs(q.x) <= tol + 4 || Math.abs(q.x - p.w) <= tol + 4 || Math.abs(q.y) <= tol + 4 || Math.abs(q.y - p.h) <= tol + 4)) || (q.x >= 0 && q.y >= 0 && q.x <= 360 && q.y <= 44);
  },
  hitTestRect: (o, rect, mode) => {
    const a = toWorld(o, { x: 0, y: 0 });
    const b = toWorld(o, { x: o.props.w, y: o.props.h });
    const inside = (q: Point) => q.x >= rect.x && q.y >= rect.y && q.x <= rect.x + rect.width && q.y <= rect.y + rect.height;
    return mode === 'contain' ? inside(a) && inside(b) : inside(a) || inside(b);
  },
  // Заряды и пробная точка тянутся сразу, без выделения (hitPriority).
  hitPriority: 1,
  getHandles: (o) => [
    ...o.props.charges.map((c, i) => ({ id: `c:${c.id}`, kind: 'point' as const, position: toWorld(o, c), label: qName(i) })),
    ...(o.props.showProbe ? [{ id: 'probe', kind: 'point' as const, position: toWorld(o, o.props.probe), label: 'Пробная точка' }] : []),
  ],
  dragHandle: (o, id, to) => {
    const p = o.props;
    const q = toLocal(o, to);
    const at = { x: Math.max(0, Math.min(p.w, q.x)), y: Math.max(0, Math.min(p.h, q.y)) };
    if (id === 'probe') return { props: { probe: at } };
    const cid = id.slice(2);
    if (!p.charges.some((c) => c.id === cid)) return null;
    return { props: { charges: p.charges.map((c) => (c.id === cid ? { ...c, ...at } : c)) } };
  },
  getSnapPoints: (o) => o.props.charges.map((c) => ({ kind: 'center' as const, point: toWorld(o, c) })),
  render: (o, ctx) => <SystemShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'toggle', key: 'lines', label: 'Силовые линии' },
    { kind: 'toggle', key: 'equip', label: 'Эквипотенциали' },
    { kind: 'toggle', key: 'forces', label: 'Силы Кулона' },
    { kind: 'toggle', key: 'showProbe', label: 'Пробная точка' },
    { kind: 'number', key: 'cell', label: 'См в клетке', min: 0.01, max: 10000, step: 0.5 },
    { kind: 'number', key: 'eps', label: 'ε среды', min: 1, max: 1000, step: 1 },
  ],
  editor: CHARGES_EDITOR,
  transform: { rotatable: false, resize: 'free' },
  // Растяжение меняет рамку (область линий); заряды остаются на местах.
  applyResize: (o, sx, sy) => ({ scaleX: 1, scaleY: 1, props: { w: Math.max(120, o.props.w * Math.abs(sx)), h: Math.max(120, o.props.h * Math.abs(sy)) } }),
};

/** Свободный id заряда. */
export function nextChargeId(cs: readonly Charge[]): string {
  let i = 1;
  while (cs.some((c) => c.id === `q${i}`)) i++;
  return `q${i}`;
}

// =====================================================================
//  Плоский конденсатор
// =====================================================================

export const capacitorPropsSchema = z.object({
  /** Площадь пластины, см². */
  S: z.number().finite().min(0.01).max(1e8),
  /** Расстояние между пластинами, мм. */
  d: z.number().finite().min(0.01).max(1e5),
  U: z.number().finite().min(-1e7).max(1e7),
  eps: z.number().finite().min(1).max(1000),
  color: z.string().max(32),
});
export type CapacitorProps = z.infer<typeof capacitorPropsSchema>;
type CapacitorObject = BoardObject<CapacitorProps>;

const PLATE = 160;
/** Зазор на доске: 8 пикселей на миллиметр, не меньше 30 и не больше 260. */
const gapPx = (d: number) => Math.max(30, Math.min(260, d * 8));

function CapacitorShape({ o, ctx }: { o: CapacitorObject; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const c = ctx.resolveColor(p.color);
  const g = gapPx(p.d);
  const r = capacitor(p.S, p.d, p.U, p.eps);
  const head = { pointerLength: 8 / zoom, pointerWidth: 6 / zoom };
  const plus = p.U >= 0;
  return (
    <Group listening={false}>
      {p.eps > 1 && <KRect x={0} y={0} width={g} height={PLATE} fill={c} opacity={0.12} listening={false} />}
      <Line points={[0, 0, 0, PLATE]} stroke={plus ? POS : NEG} strokeWidth={5} strokeScaleEnabled={false} listening={false} />
      <Line points={[g, 0, g, PLATE]} stroke={plus ? NEG : POS} strokeWidth={5} strokeScaleEnabled={false} listening={false} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Group key={i}>
          <Text x={-16} y={14 + i * 30} text={plus ? '+' : '−'} fontSize={16} fill={plus ? POS : NEG} listening={false} />
          <Text x={g + 6} y={14 + i * 30} text={plus ? '−' : '+'} fontSize={16} fill={plus ? NEG : POS} listening={false} />
          {Math.abs(p.U) > 0 && <Arrow points={plus ? [6, 22 + i * 30, g - 6, 22 + i * 30] : [g - 6, 22 + i * 30, 6, 22 + i * 30]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} {...head} listening={false} />}
        </Group>
      ))}
      <VecLabel x={g / 2 - 6} y={-24} label="E" color={ink} size={16} />
      <Line points={[0, PLATE + 14, g, PLATE + 14]} stroke={muted} strokeWidth={1} dash={[4 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />
      <Text x={g / 2 - 30} y={PLATE + 18} width={60} align="center" text={`d = ${String(p.d).replace('.', ',')} мм`} fontSize={13} fill={muted} listening={false} />
      <Text
        x={g + 30}
        y={10}
        text={[
          `S = ${String(p.S).replace('.', ',')} см², U = ${String(p.U).replace('.', ',')} В${p.eps > 1 ? `, ε = ${p.eps}` : ''}`,
          `C = εε₀S/d = ${withPrefix(r.C, 'Ф')}`,
          `E = U/d = ${withPrefix(Math.abs(r.E), 'В/м')}`,
          `q = CU = ${withPrefix(Math.abs(r.q), 'Кл')}`,
          `W = CU²/2 = ${withPrefix(r.W, 'Дж')}`,
        ].join('\n')}
        fontSize={14}
        lineHeight={1.45}
        fill={ink}
        listening={false}
      />
    </Group>
  );
}

const capBox = (p: CapacitorProps) => ({ x: -24, y: -30, width: gapPx(p.d) + 300, height: PLATE + 70 });

export const capacitorModule: ObjectModule<CapacitorProps, ReactNode> = {
  type: CAPACITOR_TYPE,
  title: 'Плоский конденсатор',
  version: 1,
  propsSchema: capacitorPropsSchema,
  createProps: () => ({ S: 100, d: 5, U: 100, eps: 1, color: 'accent-6' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as CapacitorObject,
  getLocalBounds: (o) => capBox(o.props),
  hitTest: (o, point, tol) => {
    const b = capBox(o.props);
    const q = toLocal(o, point);
    return q.x >= b.x - tol && q.y >= b.y - tol && q.x <= b.x + b.width + tol && q.y <= b.y + b.height + tol;
  },
  // Правая пластина — ручка: расстояние d с шагом 0,5 мм.
  getHandles: (o) => [{ id: 'd', kind: 'param', position: toWorld(o, { x: gapPx(o.props.d), y: PLATE / 2 }), label: 'Расстояние d', snap: false }],
  dragHandle: (o, id, to) => {
    if (id !== 'd') return null;
    const q = toLocal(o, to);
    return { props: { d: Math.max(0.5, Math.min(1e5, Math.round((Math.max(30, q.x) / 8) * 2) / 2)) } };
  },
  render: (o, ctx) => <CapacitorShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'number', key: 'S', label: 'S, см²', min: 0.01, max: 1e8, step: 10 },
    { kind: 'number', key: 'd', label: 'd, мм', min: 0.01, max: 1e5, step: 0.5 },
    { kind: 'number', key: 'U', label: 'U, В', min: -1e7, max: 1e7, step: 10 },
    { kind: 'number', key: 'eps', label: 'ε', min: 1, max: 1000, step: 1 },
    { kind: 'color', key: 'color', label: 'Диэлектрик' },
  ],
  transform: { rotatable: true, resize: 'none' },
};

export const electricityModules = [systemModule, capacitorModule];
export { CELL_PX };
