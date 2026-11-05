import { useState, type ReactNode } from 'react';
import { Arrow, Circle, Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, PluginEditorProps, Point, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { useBoard } from '../../store/board';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { parseNum } from '../common/si';
import { CELL_PX, withPrefix } from './field';
import { PART_KINDS, nodeKey, solve, type Part, type PartKind, type Solution } from './circuit';
import { PLUGIN_ID } from './objects';

export const CIRCUIT_TYPE = `${PLUGIN_ID}.circuit`;
export const CIRCUIT_EDITOR = 'physics.circuit';
export const MAX_PARTS = 60;

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;

export const PART_TITLES: Record<PartKind, string> = {
  wire: 'Провод',
  battery: 'Источник ЭДС',
  resistor: 'Резистор',
  rheostat: 'Реостат',
  lamp: 'Лампа',
  switch: 'Ключ',
  ammeter: 'Амперметр',
  voltmeter: 'Вольтметр',
};

const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
const sub = (n: number) => String(n).split('').map((d) => SUB[Number(d)]).join('');
const LETTER: Record<PartKind, string> = { wire: '', battery: 'ε', resistor: 'R', rheostat: 'R', lamp: 'L', switch: 'K', ammeter: 'A', voltmeter: 'V' };

/** Имена элементов: R₁, R₂ (резисторы и реостаты), L₁, ε₁, K₁, A₁, V₁. */
export function partNames(parts: readonly Part[]): Map<string, string> {
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  for (const p of parts) {
    const L = LETTER[p.kind];
    if (!L) continue;
    const k = (count.get(L) ?? 0) + 1;
    count.set(L, k);
    out.set(p.id, `${L}${sub(k)}`);
  }
  return out;
}

const cell: z.ZodType<[number, number]> = z.tuple([z.number().int().min(-500).max(500), z.number().int().min(-500).max(500)]);
const partSchema = z.object({
  id: z.string().min(1).max(16),
  kind: z.enum(PART_KINDS),
  a: cell,
  b: cell,
  v: z.number().finite().min(0).max(1e9),
  r: z.number().finite().min(0).max(1e9),
  closed: z.boolean(),
  pnom: z.number().finite().min(0.001).max(1e9),
});

export const circuitPropsSchema = z.object({
  parts: z.array(partSchema).max(MAX_PARTS),
  /** Токи на элементах (стрелка и значение). */
  currents: z.boolean(),
  /** Номиналы элементов (R = 4 Ом, ε = 12 В). */
  values: z.boolean(),
  color: z.string().max(32),
});
export type CircuitProps = z.infer<typeof circuitPropsSchema>;
type CircuitObject = BoardObject<CircuitProps>;

/** Номинал по умолчанию для нового элемента. */
export function newPart(kind: PartKind, id: string, a: [number, number], b: [number, number]): Part {
  const v = kind === 'battery' ? 12 : kind === 'resistor' ? 4 : kind === 'rheostat' ? 10 : kind === 'lamp' ? 6 : 0;
  return { id, kind, a, b, v, r: kind === 'battery' ? 1 : 0, closed: kind !== 'switch' ? true : false, pnom: 6 };
}

export function nextPartId(parts: readonly Part[]): string {
  let i = 1;
  while (parts.some((p) => p.id === `e${i}`)) i++;
  return `e${i}`;
}

const solutions = new WeakMap<CircuitProps, Solution>();
export function solutionOf(p: CircuitProps): Solution {
  let s = solutions.get(p);
  if (!s) solutions.set(p, (s = solve(p.parts as Part[])));
  return s;
}

const px = (q: [number, number]): Point => ({ x: q[0] * CELL_PX, y: q[1] * CELL_PX });
const BODY = 20;

/** Значение для подписи: «4 Ом», «12 В, r = 1 Ом». */
function nominal(p: Part): string {
  const n = (v: number) => String(v).replace('.', ',');
  if (p.kind === 'battery') return `${n(p.v)} В${p.r ? `, r = ${n(p.r)} Ом` : ''}`;
  if (p.kind === 'resistor' || p.kind === 'rheostat' || p.kind === 'lamp') return `${n(p.v)} Ом`;
  return '';
}

function PartShape({ p, name, res, ctx, color, currents, values }: { p: Part; name: string; res: { I: number; U: number; P: number } | undefined; ctx: RenderContext; color: string; currents: boolean; values: boolean }) {
  const zoom = useZoom();
  const A = px(p.a);
  const B = px(p.b);
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const n = { x: -u.y, y: u.x };
  const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const at = (s: number, t = 0) => ({ x: M.x + u.x * s + n.x * t, y: M.y + u.y * s + n.y * t });
  const line = (pts: Point[], extra: Record<string, unknown> = {}) => <Line points={pts.flatMap((q) => [q.x, q.y])} stroke={color} strokeWidth={2} strokeScaleEnabled={false} lineCap="round" listening={false} {...extra} />;
  const half = Math.min(BODY, L / 2);
  const els: ReactNode[] = [];
  // Подпись сбоку от элемента: у горизонтального — над или под ним по центру, у вертикального — слева или справа.
  const vertical = Math.abs(u.y) > 0.5;
  const side = (t: number, key: string, text: string, extra: Record<string, unknown>) => {
    const q = at(0, t);
    if (!vertical) return <Text key={key} x={q.x - 70} y={q.y - 8} width={140} align="center" text={text} listening={false} {...extra} />;
    const left = q.x < M.x;
    return <Text key={key} x={left ? M.x - 18 - 160 : M.x + 18} y={q.y - 8 + (t > 0 ? 10 : -10)} width={160} align={left ? 'right' : 'left'} text={text} listening={false} {...extra} />;
  };
  if (p.kind === 'wire') els.push(<Group key="w">{line([A, B])}</Group>);
  else {
    els.push(<Group key="l1">{line([A, at(-half)])}</Group>, <Group key="l2">{line([at(half), B])}</Group>);
    const ink = ctx.resolveColor('ink');
    switch (p.kind) {
      case 'resistor':
      case 'rheostat':
        els.push(<Group key="b">{line([at(-18, -7), at(18, -7), at(18, 7), at(-18, 7)], { closed: true })}</Group>);
        if (p.kind === 'rheostat') els.push(<Arrow key="ar" points={[at(-14, 14).x, at(-14, 14).y, at(14, -14).x, at(14, -14).y]} stroke={color} fill={color} strokeWidth={1.5} strokeScaleEnabled={false} pointerLength={7 / zoom} pointerWidth={6 / zoom} listening={false} />);
        if (half > 18) els.push(<Group key="f">{line([at(-half), at(-18)])}{line([at(18), at(half)])}</Group>);
        break;
      case 'lamp': {
        const b = res && p.pnom > 0 ? Math.min(1, res.P / p.pnom) : 0;
        if (b > 0.01) els.push(<Circle key="g" x={M.x} y={M.y} radius={24} fill="#facc15" opacity={0.15 + 0.6 * b} listening={false} />);
        els.push(<Circle key="c" x={M.x} y={M.y} radius={11} stroke={color} strokeWidth={2} fill={b > 0.01 ? '#fde68a' : undefined} strokeScaleEnabled={false} listening={false} />);
        els.push(<Group key="x">{line([at(-7.8, -7.8), at(7.8, 7.8)])}{line([at(-7.8, 7.8), at(7.8, -7.8)])}</Group>);
        if (half > 11) els.push(<Group key="f">{line([at(-half), at(-11)])}{line([at(11), at(half)])}</Group>);
        break;
      }
      case 'battery':
        // Длинная тонкая пластина — «+» (сторона b), короткая толстая — «−».
        els.push(<Group key="p">{line([at(4, -14), at(4, 14)])}</Group>, <Group key="m">{line([at(-4, -7), at(-4, 7)], { strokeWidth: 5 })}</Group>);
        els.push(<Group key="f">{line([at(-half), at(-4)])}{line([at(4), at(half)])}</Group>);
        // «+» — со стороны, противоположной подписи.
        els.push(<Text key="pl" x={at(12, 18).x - 5} y={at(12, 18).y - 8} text="+" fontSize={14} fill={ink} listening={false} />);
        break;
      case 'switch': {
        els.push(<Circle key="c1" x={at(-14).x} y={at(-14).y} radius={3} fill={color} listening={false} />, <Circle key="c2" x={at(14).x} y={at(14).y} radius={3} fill={color} listening={false} />);
        els.push(<Group key="bl">{line([at(-14), p.closed ? at(14) : at(10, -14)])}</Group>);
        if (half > 14) els.push(<Group key="f">{line([at(-half), at(-14)])}{line([at(14), at(half)])}</Group>);
        break;
      }
      case 'ammeter':
      case 'voltmeter': {
        els.push(<Circle key="c" x={M.x} y={M.y} radius={13} stroke={color} strokeWidth={2} fill={ctx.resolveColor('muted')} opacity={1} strokeScaleEnabled={false} listening={false} />);
        els.push(<Text key="t" x={M.x - 13} y={M.y - 8} width={26} align="center" text={p.kind === 'ammeter' ? 'A' : 'V'} fontSize={15} fontStyle="bold" fill="#ffffff" listening={false} />);
        if (half > 13) els.push(<Group key="f">{line([at(-half), at(-13)])}{line([at(13), at(half)])}</Group>);
        const reading = p.kind === 'ammeter' ? withPrefix(Math.abs(res?.I ?? 0), 'А') : withPrefix(Math.abs(res?.U ?? 0), 'В');
        els.push(side(26, 'r', reading, { fontSize: 14, fontStyle: 'bold', fill: ink }));
        break;
      }
    }
    // Имя и номинал — с другой стороны от показаний и тока.
    const text = values && nominal(p) ? `${name} = ${nominal(p)}` : name;
    els.push(side(-28, 'n', text, { fontSize: 14, ...italic, fill: ink }));
    // Ток: стрелка вдоль элемента и значение.
    if (currents && res && Math.abs(res.I) > 1e-6 && p.kind !== 'ammeter' && p.kind !== 'voltmeter') {
      const s = Math.sign(res.I) || 1;
      const c0 = at(-half - 4 * s);
      const c1 = at(-half + 8 * s);
      const f = '#16a34a';
      els.push(<Arrow key="i" points={[c0.x, c0.y, c1.x, c1.y]} stroke={f} fill={f} strokeWidth={2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={7 / zoom} listening={false} />);
      if (p.kind !== 'battery' && p.kind !== 'switch') {
        els.push(side(26, 'iv', `${withPrefix(Math.abs(res.I), 'А')}, ${withPrefix(Math.abs(res.U), 'В')}`, { fontSize: 12, fill: f }));
      }
    }
  }
  return <Group listening={false}>{els}</Group>;
}

function CircuitShape({ o, ctx }: { o: CircuitObject; ctx: RenderContext }) {
  const p = o.props;
  const s = solutionOf(p);
  const names = partNames(p.parts as Part[]);
  const color = ctx.resolveColor(p.color);
  const ink = ctx.resolveColor('ink');
  // Точки соединения: узлы, где сходятся три элемента и больше.
  const deg = new Map<string, number>();
  for (const q of p.parts) for (const k of [nodeKey(q.a), nodeKey(q.b)]) deg.set(k, (deg.get(k) ?? 0) + 1);
  const box = circuitBox(p);
  const info = s.short ?? (s.summary ? (Math.abs(s.summary.I) < 1e-6 ? 'Цепь разомкнута — тока нет' : `I = ${withPrefix(Math.abs(s.summary.I), 'А')},  R внешн. = ${Number.isFinite(s.summary.Rext) ? withPrefix(s.summary.Rext, 'Ом') : '∞'}`) : p.parts.some((q) => q.kind === 'battery') ? '' : 'Добавьте источник ЭДС');
  return (
    <Group listening={false}>
      {p.parts.map((q) => (
        <PartShape key={q.id} p={q as Part} name={names.get(q.id) ?? ''} res={s.results.get(q.id)} ctx={ctx} color={color} currents={p.currents && !s.short} values={p.values} />
      ))}
      {[...deg.entries()].filter(([, d]) => d >= 3).map(([k]) => {
        const [i, j] = k.split(',').map(Number) as [number, number];
        return <Circle key={k} x={i * CELL_PX} y={j * CELL_PX} radius={4} fill={color} listening={false} />;
      })}
      {info && <Text x={box.x} y={box.y - 4} text={info} fontSize={14} fill={s.short ? '#d13a3a' : ink} listening={false} />}
    </Group>
  );
}

/** Габарит: узлы ± 2 клетки и строка сведений сверху. */
export function circuitBox(p: CircuitProps) {
  if (!p.parts.length) return { x: -40, y: -60, width: 80, height: 80 };
  const xs = p.parts.flatMap((q) => [q.a[0], q.b[0]]);
  const ys = p.parts.flatMap((q) => [q.a[1], q.b[1]]);
  const x0 = (Math.min(...xs) - 2) * CELL_PX;
  const y0 = (Math.min(...ys) - 2) * CELL_PX - 18;
  return { x: x0, y: y0, width: (Math.max(...xs) + 2) * CELL_PX - x0, height: (Math.max(...ys) + 2) * CELL_PX - y0 };
}

function segDist(q: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
}

/** Элемент под точкой (локальные координаты), кроме проводов, если есть другой. */
export function partAt(p: CircuitProps, q: Point, tol: number): Part | undefined {
  const near = (p.parts as Part[]).filter((e) => segDist(q, px(e.a), px(e.b)) <= tol + (e.kind === 'wire' ? 4 : 14));
  return near.find((e) => e.kind !== 'wire') ?? near[0];
}

export const circuitModule: ObjectModule<CircuitProps, ReactNode> = {
  type: CIRCUIT_TYPE,
  title: 'Электрическая цепь',
  version: 1,
  propsSchema: circuitPropsSchema as unknown as z.ZodType<CircuitProps>,
  createProps: () => ({ parts: [], currents: true, values: true, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as CircuitObject,
  getLocalBounds: (o) => circuitBox(o.props),
  // Объект берётся за элементы и провода; пустые места внутри схемы прозрачны.
  hitTest: (o, point, tol) => !!partAt(o.props, toLocal(o, point), tol),
  // Ключи переключаются щелчком (ручка без выделения).
  hitPriority: 1,
  getHandles: (o) =>
    (o.props.parts as Part[])
      .filter((e) => e.kind === 'switch')
      .map((e) => ({ id: `sw:${e.id}`, kind: 'param' as const, position: toWorld(o, { x: ((e.a[0] + e.b[0]) / 2) * CELL_PX, y: ((e.a[1] + e.b[1]) / 2) * CELL_PX }), label: e.closed ? 'Разомкнуть ключ' : 'Замкнуть ключ', snap: false })),
  dragHandle: () => null,
  finishHandle: (o, id, ctx) => {
    if (!id.startsWith('sw:')) return;
    const sid = id.slice(3);
    ctx.updateObject<CircuitProps>(o.id, { props: { parts: o.props.parts.map((e) => (e.id === sid ? { ...e, closed: !e.closed } : e)) } });
  },
  getSnapPoints: (o) => {
    const seen = new Set<string>();
    return (o.props.parts as Part[]).flatMap((e) => [e.a, e.b]).filter((q) => !seen.has(nodeKey(q)) && seen.add(nodeKey(q))).map((q) => ({ kind: 'endpoint' as const, point: toWorld(o, px(q)) }));
  },
  render: (o, ctx) => <CircuitShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'toggle', key: 'currents', label: 'Токи' },
    { kind: 'toggle', key: 'values', label: 'Номиналы' },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
  editor: CIRCUIT_EDITOR,
  transform: { rotatable: false, resize: 'none' },
};

// =====================================================================
//  Диалог: элементы схемы
// =====================================================================

/** Список элементов: номиналы, внутреннее сопротивление, ключи, удаление. */
export function CircuitEditor({ objectId, ctx, close, readOnly }: PluginEditorProps) {
  const obj = objectId ? (ctx.resolve.getObject(objectId) as CircuitObject | undefined) : undefined;
  const [parts, setParts] = useState<(Part & { tv: string; tr: string; tp: string })[]>(() => (obj?.props.parts ?? []).map((e) => ({ ...(e as Part), tv: String(e.v).replace('.', ','), tr: String(e.r).replace('.', ','), tp: String(e.pnom).replace('.', ',') })));
  if (!obj) return null;
  const names = partNames(parts);
  const valued = (k: PartKind) => k === 'battery' || k === 'resistor' || k === 'rheostat' || k === 'lamp';
  const bad = parts.some((e) => valued(e.kind) && ((parseNum(e.tv) ?? -1) < 0 || (e.kind !== 'battery' && (parseNum(e.tv) ?? 0) <= 0) || (e.kind === 'battery' && (parseNum(e.tr) ?? -1) < 0) || (e.kind === 'lamp' && (parseNum(e.tp) ?? 0) <= 0)));
  const set = (i: number, patch: Partial<(typeof parts)[number]>) => setParts((ps) => ps.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const save = () => {
    if (bad || readOnly) return;
    const next: Part[] = parts.map(({ tv, tr, tp, ...e }) => (valued(e.kind) ? { ...e, v: parseNum(tv)!, r: e.kind === 'battery' ? parseNum(tr)! : e.r, pnom: e.kind === 'lamp' ? parseNum(tp)! : e.pnom } : e));
    ctx.updateObject<CircuitProps>(obj.id, { props: { parts: next } });
    close();
  };
  const field = (label: string, value: string, onChange: (v: string) => void, unit: string) => (
    <label className="row small" style={{ gap: 4 }}>
      {label}
      <input className="input" style={{ width: 70 }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {unit}
    </label>
  );
  const wires = parts.filter((e) => e.kind === 'wire').length;
  return (
    <Dialog
      open
      wide
      onClose={close}
      title="Электрическая цепь"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={bad || readOnly}>
            Сохранить
          </Button>
        </>
      }
    >
      {parts.map((e, i) =>
        e.kind === 'wire' ? null : (
          <div key={e.id} className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ width: 150 }}>
              {PART_TITLES[e.kind]} <i>{names.get(e.id)}</i>
            </span>
            {e.kind === 'battery' && (
              <>
                {field(`ЭДС ${names.get(e.id)}`, e.tv, (v) => set(i, { tv: v }), 'В')}
                {field(`r ${names.get(e.id)}`, e.tr, (v) => set(i, { tr: v }), 'Ом')}
              </>
            )}
            {(e.kind === 'resistor' || e.kind === 'rheostat' || e.kind === 'lamp') && field(`R ${names.get(e.id)}`, e.tv, (v) => set(i, { tv: v }), 'Ом')}
            {e.kind === 'lamp' && field(`Pном ${names.get(e.id)}`, e.tp, (v) => set(i, { tp: v }), 'Вт')}
            {e.kind === 'switch' && (
              <label className="row small" style={{ gap: 4 }}>
                <input type="checkbox" checked={e.closed} onChange={(ev) => set(i, { closed: ev.target.checked })} /> замкнут
              </label>
            )}
            <Button size="small" variant="ghost" aria-label={`Удалить ${names.get(e.id)}`} onClick={() => setParts((ps) => ps.filter((_, k) => k !== i))}>
              ✕
            </Button>
          </div>
        ),
      )}
      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 8 }}>
        <span className="small muted">Проводов: {wires}</span>
        {wires > 0 && (
          <Button size="small" onClick={() => setParts((ps) => ps.filter((e) => e.kind !== 'wire'))}>
            Удалить все провода
          </Button>
        )}
      </div>
      <p className="small" style={{ color: bad ? 'var(--danger)' : undefined }}>
        {bad ? 'Сопротивления — положительные числа, ЭДС и r — не меньше нуля.' : 'Элементы и провода добавляются инструментами раздела «Электричество» протяжкой по узлам сетки; ключ на доске переключается щелчком.'}
      </p>
    </Dialog>
  );
}
