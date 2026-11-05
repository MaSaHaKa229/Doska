import { useState } from 'react';
import type { MathJsInstance } from 'mathjs';
import type { EditorContext, Point, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { getMath, useMathReady } from '../../math/analysis/expr';
import { AXES_TYPE, CURVE_TYPE, type AxesProps } from '../../math/analysis/plot';
import { axesModule, curveModule } from '../../math/analysis/objects';
import { parseNum, SYM_RE } from './si';

export const GRAPH_EDITOR = 'physics.graph';

/**
 * График зависимости (этап 7.1b): x(t), v(t), p(V)… — оси раздела 6.2 с
 * подписями величин и единиц («t, с», «v, м/с»), график функции и подпись
 * «v(t) = 2 + 3t». Переменная заменяется на x только внутри записи
 * графика; на доске — обозначения физики.
 */

export interface GraphInput {
  ySym: string;
  yUnit: string;
  xSym: string;
  xUnit: string;
  /** Правая часть: «2 + 3t». */
  expr: string;
  from: string;
  to: string;
}

export interface GraphPlan {
  /** Запись для графика 6.2: «y = 2 + 3*x». */
  curve: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  /** Подпись-формула: «v(t) = 2 + 3t». */
  latex: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Удобные пределы: «круглые» числа с запасом, ноль — в пределах. */
function nice(lo: number, hi: number): [number, number] {
  let a = Math.min(0, lo);
  let b = Math.max(0, hi);
  if (b - a < 1e-9) b = a + 1;
  const pad = (b - a) * 0.1;
  const step = 10 ** Math.floor(Math.log10((b - a) / 5 || 1));
  a = lo < 0 ? Math.floor((a - pad) / step) * step : a;
  b = Math.ceil((b + pad) / step) * step;
  return [a, b];
}

export function planGraph(math: MathJsInstance, g: GraphInput): GraphPlan | { error: string } {
  if (!SYM_RE.test(g.ySym) || !SYM_RE.test(g.xSym)) return { error: 'Обозначения величин — латиница или греческая буква (v, t, p, V)' };
  if (g.ySym === g.xSym) return { error: 'Величины по осям должны различаться' };
  const from = parseNum(g.from);
  const to = parseNum(g.to);
  if (from === null || to === null || to <= from) return { error: 'Промежуток: «от» меньше «до»' };
  const src = g.expr
    .replace(/[·×]/g, '*')
    .replace(/[−–]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/(\d),(?=\d)/g, '$1.');
  // Переменная — целым словом; цифра перед ней — неявное умножение («3t» → «3x»).
  const body = src.replace(new RegExp(`(?<![A-Za-z_])${esc(g.xSym)}(?![A-Za-z0-9_])`, 'g'), 'x');
  let f: (x: number) => number;
  try {
    const code = math.parse(body).compile();
    f = (x) => Number(code.evaluate({ x }));
  } catch {
    return { error: 'Ошибка в записи зависимости' };
  }
  const ys: number[] = [];
  for (let i = 0; i <= 100; i++) {
    let y: number;
    try {
      y = f(from + ((to - from) * i) / 100);
    } catch {
      return { error: `В записи — неизвестное имя (переменная — ${g.xSym})` };
    }
    if (Number.isFinite(y)) ys.push(y);
  }
  if (!ys.length) return { error: 'Зависимость не определена на этом промежутке' };
  const [yMin, yMax] = nice(Math.min(...ys), Math.max(...ys));
  const unit = (u: string) => (u.trim() ? `, ${u.trim()}` : '');
  return {
    curve: `y = ${body}`,
    xMin: Math.min(0, from),
    xMax: to,
    yMin,
    yMax,
    xLabel: `${g.xSym}${unit(g.xUnit)}`,
    yLabel: `${g.ySym}${unit(g.yUnit)}`,
    latex: `${g.ySym}(${g.xSym}) = ${g.expr.replace(/·|\*/g, '\\cdot ').replace(/,/g, '{,}')}`,
  };
}

/** Оси, график и подпись — одной транзакцией. Возвращает id осей. */
export function insertGraph(ctx: EditorContext, plan: GraphPlan, at: Point | null): string {
  const w = 420;
  const h = 300;
  const x = (at?.x ?? 0) - w / 2;
  const y = (at?.y ?? 0) - h / 2;
  let axes = '';
  ctx.transact(() => {
    const props: AxesProps = { ...axesModule.createProps(), w, h, xMin: plan.xMin, xMax: plan.xMax, yMin: plan.yMin, yMax: plan.yMax, xLabel: plan.xLabel, yLabel: plan.yLabel };
    axes = ctx.createObject<AxesProps>(AXES_TYPE, { x, y, props });
    if (!axes) return;
    ctx.createObject(CURVE_TYPE, { x: 0, y: 0, props: { ...curveModule.createProps(), text: plan.curve, showLabel: false, tMin: plan.xMin, tMax: plan.xMax }, deps: [axes] });
    ctx.createObject('core.formula', { x: x + w - 160, y: y - 36, props: { latex: plan.latex, size: 22, color: 'accent-3' } });
  });
  return axes;
}

const PRESETS: { title: string; g: GraphInput }[] = [
  { title: 'Скорость при равноускоренном движении', g: { ySym: 'v', yUnit: 'м/с', xSym: 't', xUnit: 'с', expr: '2 + 3t', from: '0', to: '10' } },
  { title: 'Координата при равномерном движении', g: { ySym: 'x', yUnit: 'м', xSym: 't', xUnit: 'с', expr: '5 + 2t', from: '0', to: '10' } },
  { title: 'Координата при равноускоренном движении', g: { ySym: 'x', yUnit: 'м', xSym: 't', xUnit: 'с', expr: '2t + 0,5t²', from: '0', to: '10' } },
  { title: 'Изотерма p(V)', g: { ySym: 'p', yUnit: 'кПа', xSym: 'V', xUnit: 'л', expr: '100/V', from: '1', to: '10' } },
  { title: 'Гармонические колебания', g: { ySym: 'x', yUnit: 'см', xSym: 't', xUnit: 'с', expr: '5 sin(2t)', from: '0', to: '10' } },
];

export function GraphEditor({ at, ctx, close, readOnly }: PluginEditorProps) {
  useMathReady();
  const math = getMath();
  const [g, setG] = useState<GraphInput>(PRESETS[0]!.g);
  const plan = math ? planGraph(math, g) : null;
  const err = plan && 'error' in plan ? plan.error : null;
  const set = (k: keyof GraphInput) => (e: { target: { value: string } }) => setG((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof GraphInput, label: string, width: number) => (
    <label className="field" style={{ width }}>
      <span className="field__label">{label}</span>
      <input className="input" aria-label={label} value={g[k]} maxLength={k === 'expr' ? 120 : 24} onChange={set(k)} />
    </label>
  );
  const save = () => {
    if (!plan || 'error' in plan || readOnly) return;
    const id = insertGraph(ctx, plan, at);
    if (id) ctx.setSelection([id]);
    close();
  };
  return (
    <Dialog
      open
      onClose={close}
      title="График зависимости"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!plan || !!err || readOnly}>
            Вставить
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Пример</span>
        <select className="select" aria-label="Пример зависимости" defaultValue="0" onChange={(e) => setG(PRESETS[Number(e.target.value)]!.g)}>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        {field('ySym', 'Величина', 80)}
        {field('yUnit', 'Её единица', 90)}
        {field('xSym', 'Зависит от', 80)}
        {field('xUnit', 'Единица аргумента', 120)}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        <span style={{ paddingBottom: 8 }}>
          {g.ySym || '?'}({g.xSym || '?'}) =
        </span>
        {field('expr', 'Зависимость', 200)}
        {field('from', 'от', 70)}
        {field('to', 'до', 70)}
      </div>
      <p className="small" aria-live="polite" style={{ color: err ? 'var(--danger)' : undefined }}>
        {!math ? 'Загрузка вычислений…' : err ?? `Оси: ${(plan as GraphPlan).xLabel} от ${(plan as GraphPlan).xMin} до ${(plan as GraphPlan).xMax}; ${(plan as GraphPlan).yLabel} от ${(plan as GraphPlan).yMin} до ${(plan as GraphPlan).yMax}.`}
      </p>
    </Dialog>
  );
}
