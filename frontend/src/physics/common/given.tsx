import type { ReactNode } from 'react';
import { Group, Line, Text } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule, RenderContext } from '@doska/shared';
import type { MathJsInstance } from 'mathjs';
import { toLocal } from '../../objects/util';
import { getMath, useMathReady } from '../../math/analysis/expr';
import { rowSI, solveAnswer, type Answer } from './si';
import { PLUGIN_ID } from './vectors';

export const GIVEN_TYPE = `${PLUGIN_ID}.given`;
export const GIVEN_EDITOR = 'physics.given';

const row = z.object({ sym: z.string().max(12), value: z.string().max(32), unit: z.string().max(24) });
export const givenPropsSchema = z.object({
  rows: z.array(row).max(16),
  find: z.array(z.object({ sym: z.string().max(12), unit: z.string().max(24) })).max(6),
  /** Строки решения (формулы и пояснения обычным текстом). */
  steps: z.array(z.string().max(200)).max(16),
  /** Формула ответа для первой искомой величины через обозначения «Дано»: «F/m». */
  formula: z.string().max(200),
  color: z.string().max(32),
});
export type GivenProps = z.infer<typeof givenPropsSchema>;
type GivenObject = BoardObject<GivenProps>;

const FS = 16;
const LH = FS * 1.5;
const CW = FS * 0.56;
const PAD = 10;
/** Ширина столбца «СИ» до загрузки math.js (значения ещё не переведены). */
const SI_RESERVE = 12;

export interface GivenLayout {
  left: string[];
  /** Номер строки «Дано», под которой черта (перед «Найти»). */
  sepAfter: number;
  si: (string | null)[];
  right: string[];
  answer: Answer | null;
  w1: number;
  w2: number;
  w3: number;
  h: number;
}

export function givenLayout(p: GivenProps, math: MathJsInstance | null): GivenLayout {
  const rows = p.rows.filter((r) => r.sym || r.value);
  const left = ['Дано:', ...rows.map((r) => `${r.sym} = ${r.value}${r.unit ? ` ${r.unit}` : ''}`), 'Найти:', ...p.find.map((f) => `${f.sym} — ?`)];
  const si = math ? rows.map((r) => rowSI(math, r).si) : rows.map(() => null);
  const hasSi = rows.some((r) => r.unit.trim());
  const answer = math && p.find[0] ? solveAnswer(math, rows, p.find[0], p.formula) : null;
  const right = ['Решение:', ...p.steps, ...(answer ? ['', `Ответ: ${answer.text}`] : [])];
  const width = (lines: string[]) => Math.max(...lines.map((l) => l.length), 4) * CW + PAD * 2;
  const w1 = width(left);
  const w2 = hasSi ? Math.max(width(['СИ', ...si.map((s) => s ?? '')]), SI_RESERVE * CW + PAD * 2) : 0;
  const w3 = Math.max(width(right), answer ? width([answer.message]) * 0.8 : 0);
  const lines = Math.max(left.length, right.length + (answer ? 1 : 0));
  return { left, sepAfter: rows.length, si, right, answer, w1, w2, w3, h: lines * LH + PAD };
}

function GivenShape({ o, ctx }: { o: GivenObject; ctx: RenderContext }) {
  useMathReady();
  const L = givenLayout(o.props, getMath());
  const c = ctx.resolveColor(o.props.color);
  const t = (x: number, i: number, text: string, extra: Partial<{ fill: string; fontStyle: string; fontSize: number }> = {}) => (
    <Text key={`${x}:${i}`} x={x} y={PAD / 2 + i * LH + (LH - FS) / 2} text={text} fontSize={FS} fill={c} listening={false} {...extra} />
  );
  const x2 = L.w1;
  const x3 = L.w1 + L.w2;
  const sepY = PAD / 2 + (L.sepAfter + 1) * LH;
  const ans = L.answer;
  return (
    <Group listening={false}>
      {L.left.map((s, i) => t(PAD, i, s, i === 0 || i === L.sepAfter + 1 ? { fontStyle: 'bold' } : {}))}
      {L.w2 > 0 && t(x2 + PAD, 0, 'СИ', { fontStyle: 'bold' })}
      {L.w2 > 0 && L.si.map((s, i) => s && t(x2 + PAD, i + 1, s))}
      {L.right.map((s, i) => t(x3 + PAD, i, s, i === 0 ? { fontStyle: 'bold' } : {}))}
      {ans && t(x3 + PAD, L.right.length, `${ans.ok === true ? '✓' : ans.ok === false ? '✗' : '?'} ${ans.message}`, { fontSize: FS * 0.8, fill: ans.ok === true ? '#16a34a' : ans.ok === false ? '#d13a3a' : ctx.resolveColor('muted') })}
      {/* Черта под «Дано» (через «Дано» и «СИ») и вертикальные линии столбцов. */}
      <Line points={[0, sepY, x3, sepY]} stroke={c} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      <Line points={[x2, 0, x2, L.h]} stroke={c} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
      {L.w2 > 0 && <Line points={[x3, 0, x3, L.h]} stroke={c} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />}
    </Group>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const givenModule: ObjectModule<GivenProps, ReactNode> = {
  type: GIVEN_TYPE,
  title: 'Дано / Найти / Решение',
  version: 1,
  propsSchema: givenPropsSchema,
  createProps: () => ({ rows: [{ sym: 'm', value: '500', unit: 'г' }, { sym: 'F', value: '2', unit: 'Н' }], find: [{ sym: 'a', unit: 'м/с²' }], steps: ['a = F/m'], formula: 'F/m', color: 'ink' }),
  serialize: (o) => o,
  deserialize: (r) => r as unknown as GivenObject,
  getLocalBounds: (o) => {
    const L = givenLayout(o.props, getMath());
    return { x: 0, y: 0, width: L.w1 + L.w2 + L.w3, height: L.h };
  },
  hitTest: (o, point, tol) => {
    const L = givenLayout(o.props, getMath());
    const q = toLocal(o, point);
    return q.x >= -tol && q.y >= -tol && q.x <= L.w1 + L.w2 + L.w3 + tol && q.y <= L.h + tol;
  },
  getHandles: () => [],
  render: (o, ctx) => <GivenShape o={o} ctx={ctx} />,
  toSVG: (o, ctx) => {
    const L = givenLayout(o.props, getMath());
    const c = ctx.resolveColor(o.props.color);
    const txt = (x: number, i: number, s: string) => `<text x="${o.x + x}" y="${o.y + PAD / 2 + i * LH + LH * 0.7}" font-size="${FS}" fill="${c}">${esc(s)}</text>`;
    const parts = [...L.left.map((s, i) => txt(PAD, i, s)), ...L.right.map((s, i) => txt(L.w1 + L.w2 + PAD, i, s))];
    if (L.w2) parts.push(txt(L.w1 + PAD, 0, 'СИ'), ...L.si.map((s, i) => (s ? txt(L.w1 + PAD, i + 1, s) : '')));
    const sepY = o.y + PAD / 2 + (L.sepAfter + 1) * LH;
    parts.push(`<path d="M${o.x},${sepY}H${o.x + L.w1 + L.w2}M${o.x + L.w1},${o.y}V${o.y + L.h}" stroke="${c}"/>`);
    return `<g>${parts.join('')}</g>`;
  },
  inspector: [{ kind: 'color', key: 'color', label: 'Цвет' }],
  editor: GIVEN_EDITOR,
  transform: { rotatable: false, resize: 'none' },
};
