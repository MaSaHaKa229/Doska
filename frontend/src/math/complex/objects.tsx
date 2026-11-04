import { type ReactNode, useMemo } from 'react';
import { Arrow, Circle, Group, Line, Shape, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, Rect, RenderContext } from '@doska/shared';
import { toLocal, toWorld } from '../../objects/util';
import { getMath, niceStep, useMathReady } from '../analysis/expr';
import { marchingSquares } from '../analysis/plot';
import type { Range2 } from '../multivar/multivar';
import { Lines, PH, PW, PlaneFrame, Status, boxed, map2, useZoom } from '../multivar/objects';
import { type Cx, abs, add, algebraic, angleText, arg, compileRegion, conj, div, forms, mul, num, power, roots, sub } from './complex';

export const PLUGIN_ID = 'math.complex';
export const PLANE_TYPE = `${PLUGIN_ID}.plane`;
export const REGION_TYPE = `${PLUGIN_ID}.region`;

const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;
const COLORS = ['#2563eb', '#16a34a', '#9333ea', '#0891b2'];
const RESULT = '#ea580c';
const SUB = '₁₂₃₄';
const BOX: Rect = { x: -50, y: -122, width: PW + 70, height: PH + 142 };
const sym = (r: number): Range2 => ({ xMin: -r, xMax: r, yMin: -r, yMax: r });

// =====================================================================
//  Комплексная плоскость: числа и действия
// =====================================================================

const OPS = ['none', 'sum', 'diff', 'mul', 'div', 'conj', 'power', 'roots'] as const;
type Op = (typeof OPS)[number];
const OP_TITLE: Record<Op, string> = {
  none: 'Без действия',
  sum: 'Сумма z₁ + z₂',
  diff: 'Разность z₁ − z₂',
  mul: 'Произведение z₁·z₂',
  div: 'Частное z₁ / z₂',
  conj: 'Сопряжённое z̄₁',
  power: 'Степень z₁ⁿ',
  roots: 'Корни ⁿ√z₁',
};

export const planePropsSchema = z.object({
  /** Половина стороны области, единиц. */
  R: z.number().finite().min(0.5).max(1000),
  numbers: z.array(z.object({ re: z.number().finite(), im: z.number().finite() })).min(1).max(4),
  op: z.enum(OPS),
  n: z.number().int().min(2).max(12),
});
export type PlaneProps = z.infer<typeof planePropsSchema>;

/** Результат действия и строки пояснения. */
export function operate(p: PlaneProps): { w: Cx[]; lines: string[] } {
  const [a, b] = p.numbers as [Cx, Cx | undefined];
  const need2 = (p.op === 'sum' || p.op === 'diff' || p.op === 'mul' || p.op === 'div') && !b;
  if (p.op === 'none') return { w: [], lines: [] };
  if (need2) return { w: [], lines: ['Нужно второе число — «＋ Число» на панели свойств'] };
  const fa = forms(a);
  switch (p.op) {
    case 'sum':
      return { w: [add(a, b!)], lines: [`w = z₁ + z₂ = ${algebraic(add(a, b!))} — диагональ параллелограмма (векторы складываются)`] };
    case 'diff':
      return { w: [sub(a, b!)], lines: [`w = z₁ − z₂ = ${algebraic(sub(a, b!))} = z₁ + (−z₂);  |z₁ − z₂| = ${num(abs(sub(a, b!)))} — расстояние между точками`] };
    case 'mul': {
      const w = mul(a, b!);
      return { w: [w], lines: [`w = z₁·z₂ = ${algebraic(w)} = ${forms(w).trig}`, `|w| = |z₁|·|z₂| = ${num(fa.r)}·${num(abs(b!))};  arg w = arg z₁ + arg z₂ = ${angleText(fa.phi).deg} + ${angleText(arg(b!)).deg} — поворот и растяжение`] };
    }
    case 'div': {
      const w = div(a, b!);
      if (!w) return { w: [], lines: ['Деление на ноль невозможно: z₂ = 0'] };
      return { w: [w], lines: [`w = z₁/z₂ = ${algebraic(w)} = z₁·z̄₂/|z₂|²`, `|w| = |z₁|/|z₂|;  arg w = arg z₁ − arg z₂`] };
    }
    case 'conj':
      return { w: [conj(a)], lines: [`z̄₁ = ${algebraic(conj(a))} — отражение относительно действительной оси;  z₁·z̄₁ = |z₁|² = ${num(fa.r ** 2)}`] };
    case 'power': {
      const w = power(a, p.n);
      return { w: [w], lines: [`w = z₁^${p.n} = ${algebraic(w)}`, `Формула Муавра: zⁿ = rⁿ(cos nφ + i·sin nφ):  r^${p.n} = ${num(fa.r ** p.n)},  ${p.n}φ = ${angleText(fa.phi * p.n).deg}`] };
    }
    case 'roots': {
      const w = roots(a, p.n);
      return { w, lines: [`${p.n} корней ${p.n}-й степени из z₁ — вершины правильного ${p.n}-угольника на окружности радиуса ${num(fa.r ** (1 / p.n))}`, `w_k = ⁿ√r·(cos((φ + 2πk)/n) + i·sin((φ + 2πk)/n)):  w₀ = ${algebraic(w[0]!)},  w₁ = ${algebraic(w[1]!)}${p.n > 2 ? ' …' : ''}`] };
    }
  }
  return { w: [], lines: [] };
}

function PlaneShape({ o, ctx }: { o: BoardObject<PlaneProps>; ctx: RenderContext }) {
  const zoom = useZoom();
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const r = sym(p.R);
  const m = map2(r);
  const O = { x: m.X(0), y: m.Y(0) };
  const P = (c: Cx) => ({ x: m.X(c.re), y: m.Y(c.im) });
  const res = operate(p);
  const [a, b] = p.numbers as [Cx, Cx | undefined];
  const vec = (c: Cx, color: string, label: string, width = 2.2, dash = false) => {
    const q = P(c);
    return (
      <Group key={label}>
        {abs(c) > 1e-12 && <Arrow points={[O.x, O.y, q.x, q.y]} stroke={color} fill={color} strokeWidth={width} dash={dash ? [6 / zoom, 4 / zoom] : undefined} strokeScaleEnabled={false} pointerLength={9 / zoom} pointerWidth={7 / zoom} listening={false} />}
        <Circle x={q.x} y={q.y} radius={4.5} fill={color} listening={false} />
        <Text x={q.x + 7} y={q.y - 19} text={label} fontSize={15} {...italic} fill={color} listening={false} />
      </Group>
    );
  };
  /** Дуга угла от действительной оси до φ на радиусе rad (в пикселях). */
  const angle = (phi: number, rad: number, color: string) => (
    <Shape
      key={`a${rad}`}
      sceneFunc={(c, shape) => {
        const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
        g.beginPath();
        g.arc(O.x, O.y, rad, 0, -phi, phi > 0);
        c.strokeShape(shape);
      }}
      stroke={color}
      strokeWidth={1.4}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
  const extra: ReactNode[] = [];
  const dashLine = (u: Cx, v: Cx, k: string) => {
    const s = P(u);
    const t = P(v);
    extra.push(<Line key={k} points={[s.x, s.y, t.x, t.y]} stroke={muted} strokeWidth={1.2} dash={[5 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />);
  };
  if (p.op === 'sum' && b) {
    dashLine(a, add(a, b), 'p1');
    dashLine(b, add(a, b), 'p2');
  }
  if (p.op === 'diff' && b) {
    extra.push(vec({ re: -b.re, im: -b.im }, muted, '−z₂', 1.4, true));
    dashLine(a, sub(a, b), 'd1');
    dashLine({ re: -b.re, im: -b.im }, sub(a, b), 'd2');
    dashLine(a, b, 'd3');
  }
  if ((p.op === 'mul' || p.op === 'div') && b && res.w[0]) {
    extra.push(angle(arg(a), 26, COLORS[0]!), angle(arg(b), 36, COLORS[1]!), angle(arg(res.w[0]), 46, RESULT));
  }
  if (p.op === 'conj') dashLine(a, conj(a), 'c');
  if (p.op === 'power' && res.w[0]) extra.push(angle(arg(a), 30, COLORS[0]!));
  if (p.op === 'roots' && res.w.length) {
    const rad = abs(res.w[0]!) * (PW / (2 * p.R));
    extra.push(<Circle key="rc" x={O.x} y={O.y} radius={rad} stroke={muted} strokeWidth={1} dash={[4 / zoom, 4 / zoom]} strokeScaleEnabled={false} listening={false} />);
    extra.push(<Line key="rp" points={res.w.flatMap((w) => { const q = P(w); return [q.x, q.y]; })} closed stroke={RESULT} strokeWidth={1.6} fill={RESULT} opacity={0.15} strokeScaleEnabled={false} listening={false} />);
  }
  const fa = forms(a);
  return (
    <Group listening={false}>
      <PlaneFrame r={r} ink={ink} muted={muted} xLabel="Re" yLabel="Im" />
      <Group clipX={0} clipY={0} clipWidth={PW} clipHeight={PH} listening={false}>
        {extra}
        {p.op === 'roots' ? res.w.map((w, k) => vec(w, RESULT, `w${'₀₁₂₃₄₅₆₇₈₉'[k] ?? ''}${k > 9 ? k : ''}`, 1.4)) : res.w.map((w) => vec(w, RESULT, p.op === 'conj' ? 'z̄₁' : 'w', 2.6))}
        {p.numbers.map((c, i) => vec(c, COLORS[i]!, `z${SUB[i]}`))}
      </Group>
      <Lines
        x={-40}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `z₁ = ${fa.alg} = ${fa.trig} = ${fa.exp}`,
          `|z₁| = ${num(fa.r)},  arg z₁ = ${angleText(fa.phi).rad}${angleText(fa.phi).rad.includes('π') ? '' : ' рад'} = ${angleText(fa.phi).deg}${b ? `;   z₂ = ${algebraic(b)}` : ''}${p.numbers[2] ? `,  z₃ = ${algebraic(p.numbers[2])}` : ''}`,
          ...(p.op === 'none' ? ['Точки z тянутся мышью; действие — на панели свойств'] : [`${OP_TITLE[p.op]}:`, ...res.lines]),
        ].slice(0, 5)}
      />
    </Group>
  );
}

export const planeModule: ObjectModule<PlaneProps, ReactNode> = {
  type: PLANE_TYPE,
  title: 'Комплексная плоскость',
  version: 1,
  propsSchema: planePropsSchema,
  createProps: () => ({ R: 5, numbers: [{ re: 3, im: 2 }, { re: 1, im: -1.5 }], op: 'sum', n: 3 }),
  deserialize: (r) => r as unknown as BoardObject<PlaneProps>,
  ...boxed(() => BOX),
  // Числа тянут без выделения.
  hitPriority: 1,
  getHandles: (o) => {
    const m = map2(sym(o.props.R));
    return o.props.numbers.map((c, i) => ({ id: `z:${i}`, kind: 'point' as const, position: toWorld(o, { x: m.X(c.re), y: m.Y(c.im) }), label: `z${SUB[i]}`, snap: false }));
  },
  dragHandle: (o, id, to) => {
    const i = Number(id.slice(2));
    if (!id.startsWith('z:') || !o.props.numbers[i]) return null;
    const R = o.props.R;
    const q = toLocal(o, to);
    const v = map2(sym(R)).inv(Math.max(0, Math.min(PW, q.x)), Math.max(0, Math.min(PH, q.y)));
    // Шаг — «круглый», около 1/40 области: целые при R = 5…10.
    const s = niceStep((2 * R) / 40);
    const round = (t: number) => Number((Math.round(t / s) * s).toPrecision(6));
    return { props: { numbers: o.props.numbers.map((c, k) => (k === i ? { re: round(v.x), im: round(v.y) } : c)) } };
  },
  render: (o, ctx) => <PlaneShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'select', key: 'op', label: 'Действие', options: OPS.map((v) => ({ value: v, label: OP_TITLE[v] })) },
    { kind: 'number', key: 'n', label: 'n (степень, корни)', min: 2, max: 12, step: 1, slider: true },
    { kind: 'action', key: 'add', label: '＋ Число' },
    { kind: 'action', key: 'remove', label: '− Число' },
    { kind: 'number', key: 'R', label: 'Область ±', min: 0.5, max: 1000, step: 1 },
  ],
  runAction: (o, key, ctx) => {
    const list = o.props.numbers;
    if (key === 'add' && list.length < 4) ctx.updateObject<PlaneProps>(o.id, { props: { numbers: [...list, [{ re: -2, im: 1 }, { re: -1, im: -3 }, { re: 2, im: -2 }, { re: 1, im: 1 }][list.length]!] } });
    if (key === 'remove' && list.length > 1) ctx.updateObject<PlaneProps>(o.id, { props: { numbers: list.slice(0, -1) } });
  },
} as ObjectModule<PlaneProps, ReactNode>;

// =====================================================================
//  Множество точек на плоскости
// =====================================================================

export const regionPropsSchema = z.object({
  cond: z.string().max(200),
  R: z.number().finite().min(0.5).max(1000),
  color: z.string().max(32),
});
export type RegionProps = z.infer<typeof regionPropsSchema>;
const CELLS = 160;

function RegionShape({ o, ctx }: { o: BoardObject<RegionProps>; ctx: RenderContext }) {
  const p = o.props;
  const ink = ctx.resolveColor('ink');
  const muted = ctx.resolveColor('muted');
  const ready = useMathReady();
  const r = sym(p.R);
  const data = useMemo(() => {
    if (!ready) return null;
    const f = compileRegion(getMath()!, p.cond);
    if ('error' in f) return f;
    // Значения в узлах: 1 — условие выполнено; граница — изолиния 0,5.
    const g: number[][] = [];
    let count = 0;
    for (let i = 0; i <= CELLS; i++) {
      const col: number[] = [];
      for (let j = 0; j <= CELLS; j++) {
        const inside = f(-p.R + (2 * p.R * i) / CELLS, -p.R + (2 * p.R * j) / CELLS);
        col.push(inside ? 0.5 : -0.5);
        if (inside) count++;
      }
      g.push(col);
    }
    const m = map2(r);
    const h = (2 * p.R) / CELLS;
    const raw = marchingSquares(g, CELLS, CELLS, (i, j) => ({ x: -p.R + h * i, y: -p.R + h * j }));
    // Узлы дают границу «ступеньками»: точку на ребре клетки уточняем делением пополам.
    const refine = (x: number, y: number) => {
      const fi = (x + p.R) / h;
      const fj = (y + p.R) / h;
      const horizontal = Math.abs(fj - Math.round(fj)) < 1e-6;
      let a = horizontal ? -p.R + Math.floor(fi) * h : -p.R + Math.floor(fj) * h;
      let b = a + h;
      const at = (t: number) => (horizontal ? f(t, y) : f(x, t));
      const fa = at(a);
      if (fa === at(b)) return { x, y };
      for (let k = 0; k < 18; k++) {
        const mid = (a + b) / 2;
        if (at(mid) === fa) a = mid;
        else b = mid;
      }
      const t = (a + b) / 2;
      return horizontal ? { x: t, y } : { x, y: t };
    };
    const edge: number[] = [];
    for (let k = 0; k < raw.length; k += 2) {
      const q = refine(raw[k]!, raw[k + 1]!);
      edge.push(m.X(q.x), m.Y(q.y));
    }
    return { g, edge, share: count / (CELLS + 1) ** 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.cond, p.R]);
  if (!data || 'error' in data) return <Status state={data && 'error' in data ? data : null} ink={ink} />;
  const color = ctx.resolveColor(p.color);
  const cell = PW / CELLS;
  return (
    <Group listening={false}>
      <Shape
        sceneFunc={(c) => {
          const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
          // Все клетки — одним контуром и одной заливкой: без швов от наложения прозрачности.
          g.beginPath();
          for (let i = 0; i < CELLS; i++)
            for (let j = 0; j < CELLS; j++) {
              const s = data.g[i]![j]! + data.g[i + 1]![j]! + data.g[i]![j + 1]! + data.g[i + 1]![j + 1]!;
              if (s > 0) g.rect(i * cell, PH - (j + 1) * cell, cell + 0.3, cell + 0.3);
            }
          g.fillStyle = color;
          g.globalAlpha = 0.3;
          g.fill('nonzero');
          g.globalAlpha = 1;
        }}
        listening={false}
      />
      <PlaneFrame r={r} ink={ink} muted={muted} xLabel="Re" yLabel="Im" />
      <Shape
        sceneFunc={(c, shape) => {
          const g = (c as unknown as { _context: CanvasRenderingContext2D })._context;
          g.beginPath();
          for (let k = 0; k < data.edge.length; k += 4) {
            g.moveTo(data.edge[k]!, data.edge[k + 1]!);
            g.lineTo(data.edge[k + 2]!, data.edge[k + 3]!);
          }
          c.strokeShape(shape);
        }}
        stroke={color}
        strokeWidth={2}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Lines
        x={-40}
        y={-118}
        ink={ink}
        muted={muted}
        lines={[
          `{ z : ${p.cond} }`,
          data.share === 0 ? 'В области рисунка таких точек нет' : 'Закрашены точки, для которых условие выполняется',
          '|z − a| — расстояние от z до a;  arg z — угол в радианах, (−π; π];  Re z, Im z',
          'Можно: |z − 1 − i| < 2,  1 ≤ |z| ≤ 2,  0 < arg z < π/4,  Re z > 0 и Im z < 1',
        ]}
      />
    </Group>
  );
}

export const regionModule: ObjectModule<RegionProps, ReactNode> = {
  type: REGION_TYPE,
  title: 'Множество на комплексной плоскости',
  version: 1,
  propsSchema: regionPropsSchema,
  createProps: () => ({ cond: '1 ≤ |z − 1 − i| ≤ 2', R: 4, color: 'accent-1' }),
  deserialize: (r) => r as unknown as BoardObject<RegionProps>,
  ...boxed(() => BOX),
  getHandles: () => [],
  render: (o, ctx) => <RegionShape o={o} ctx={ctx} />,
  inspector: [
    { kind: 'text', key: 'cond', label: 'Условие на z', maxLength: 200 },
    { kind: 'number', key: 'R', label: 'Область ±', min: 0.5, max: 1000, step: 1 },
    { kind: 'color', key: 'color', label: 'Цвет' },
  ],
} as ObjectModule<RegionProps, ReactNode>;

export const complexModules = [planeModule, regionModule];
