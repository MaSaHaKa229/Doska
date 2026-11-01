import { useEffect, useState, type ReactNode } from 'react';
import { Image as KImage } from 'react-konva';
import { z } from 'zod';
import type { BoardObject, ObjectModule } from '@doska/shared';
import { MAX_LATEX, colorVar, mathElement } from '../text/schema';
import { elementSvg, measureElement, rasterScale, rasterize } from '../text/render';
import type { StepCheck } from '../formula/check';
import { localTolerance, toLocal, toWorld } from './util';
import { useBoard } from '../store/board';
import type { CanvasTheme } from './colors';

export const SOLUTION_TYPE = 'core.solution';
export const DEFAULT_SOLUTION_WIDTH = 560;
export const MAX_STEPS = 60;

export const solutionPropsSchema = z.object({
  title: z.string().max(200),
  steps: z
    .array(z.object({ latex: z.string().max(MAX_LATEX), note: z.string().max(500) }))
    .max(MAX_STEPS),
  /** Ширина блока (локальные единицы); высота — по содержимому. */
  w: z.number().finite().min(160).max(10_000),
  /** Кегль формул и текста. */
  size: z.number().finite().min(8).max(200),
  /** Показывать отметки проверки переходов между шагами. */
  check: z.boolean(),
});
export type SolutionProps = z.infer<typeof solutionPropsSchema>;
type SolutionObject = BoardObject<SolutionProps>;

const MARKS: Record<StepCheck, { sign: string; color: string; title: string }> = {
  ok: { sign: '✓', color: 'accent-3', title: 'Переход проверен: равносильно' },
  bad: { sign: '✗', color: 'accent-1', title: 'Выражения не равны' },
  unknown: { sign: '?', color: 'muted', title: 'Автоматически не проверено' },
};

/**
 * Разметка блока: заголовок и пронумерованные шаги — формула (по центру
 * строки), отметка проверки перехода от предыдущего шага и комментарий.
 */
export function solutionElement(p: SolutionProps, marks: StepCheck[] | null): HTMLElement {
  const root = document.createElement('div');
  root.className = 'doska-text doska-solution';
  root.style.fontSize = `${p.size}px`;
  if (p.title) {
    const h = document.createElement('div');
    h.className = 'doska-solution__title';
    h.textContent = p.title;
    root.appendChild(h);
  }
  const table = document.createElement('table');
  p.steps.forEach((s, i) => {
    const tr = document.createElement('tr');
    const num = document.createElement('td');
    num.className = 'doska-solution__num';
    num.textContent = `${i + 1}.`;
    const mark = document.createElement('td');
    mark.className = 'doska-solution__mark';
    const m = i > 0 && marks ? marks[i - 1] : undefined;
    if (m) {
      mark.textContent = MARKS[m].sign;
      mark.style.color = colorVar(MARKS[m].color);
    }
    const f = document.createElement('td');
    f.className = 'doska-solution__formula';
    f.appendChild(mathElement(s.latex || '\\square'));
    const note = document.createElement('td');
    note.className = 'doska-solution__note';
    note.textContent = s.note;
    tr.append(num, mark, f, note);
    table.appendChild(tr);
  });
  root.appendChild(table);
  return root;
}

/** CSS блока решения (в дополнение к общему CSS текста). */
export const SOLUTION_CSS = `
.doska-solution__title{font-weight:600;margin-bottom:.3em}
.doska-solution table{border-collapse:collapse;width:100%}
.doska-solution td{border:0;padding:.15em .3em;vertical-align:middle;white-space:normal}
.doska-solution__num{width:2em;color:var(--c-muted);text-align:right}
.doska-solution__mark{width:1.2em;text-align:center;font-weight:700}
.doska-solution__formula{white-space:nowrap}
.doska-solution__formula math{font-size:1.15em}
.doska-solution__note{color:var(--c-muted);font-size:.8em}
`;

function withCss(el: HTMLElement): HTMLElement {
  const style = document.createElement('style');
  style.textContent = SOLUTION_CSS;
  el.prepend(style);
  return el;
}

const heightCache = new Map<string, number>();

/** Высота блока по содержимому (кэш); без вёрстки — оценка. */
export function solutionHeight(p: SolutionProps): number {
  const key = JSON.stringify([p.title, p.steps, p.w, p.size]);
  let h = heightCache.get(key);
  if (h === undefined) {
    const m = measureElement(withCss(solutionElement(p, null)), p.w).height;
    h = m > 0 ? m : (p.steps.length * 2 + (p.title ? 1.5 : 0)) * p.size + 16;
    if (heightCache.size > 1000) heightCache.clear();
    heightCache.set(key, h);
  }
  return h;
}

/** Отметки проверки считаются в отдельном чанке (math.js), после отрисовки блока. */
function useMarks(p: SolutionProps): StepCheck[] | null {
  const [marks, setMarks] = useState<StepCheck[] | null>(null);
  const key = p.check ? JSON.stringify(p.steps.map((s) => s.latex)) : '';
  useEffect(() => {
    if (!key) {
      setMarks(null);
      return;
    }
    let cancelled = false;
    void import('../formula/check').then((m) => !cancelled && setMarks(m.checkSteps(JSON.parse(key) as string[])));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return marks;
}

function SolutionNode({ obj, theme }: { obj: SolutionObject; theme: CanvasTheme }) {
  const p = obj.props;
  const h = solutionHeight(p);
  const marks = useMarks(p);
  const scale = useBoard((st) => rasterScale((st.pageId && st.cameras[st.pageId]?.zoom) || 1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    rasterize(`solution|${theme}|${scale}|${h}|${JSON.stringify(p)}|${JSON.stringify(marks)}`, () =>
      elementSvg(withCss(solutionElement(p, marks)), p.w, h, theme, null, scale),
    )
      .then((i) => !cancelled && setImg(i))
      .catch(() => !cancelled && setImg(null));
    return () => {
      cancelled = true;
    };
  }, [p, h, marks, theme, scale]);
  return img ? <KImage image={img} width={p.w} height={h} listening={false} perfectDrawEnabled={false} /> : null;
}

export const solutionModule: ObjectModule<SolutionProps, ReactNode> = {
  type: SOLUTION_TYPE,
  title: 'Решение',
  version: 1,
  propsSchema: solutionPropsSchema,
  createProps: () => ({ title: 'Решение', steps: [], w: DEFAULT_SOLUTION_WIDTH, size: 22, check: true }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as SolutionObject,
  getLocalBounds: (o) => ({ x: 0, y: 0, width: o.props.w, height: solutionHeight(o.props) }),
  hitTest: (o, point, tolerance) => {
    const p = toLocal(o, point);
    const t = localTolerance(o, tolerance);
    return p.x >= -t && p.y >= -t && p.x <= o.props.w + t && p.y <= solutionHeight(o.props) + t;
  },
  getHandles: () => [],
  getSnapPoints: (o) => [
    { kind: 'vertex', point: toWorld(o, { x: 0, y: 0 }) },
    { kind: 'vertex', point: toWorld(o, { x: o.props.w, y: 0 }) },
  ],
  render: (o, ctx) => <SolutionNode obj={o} theme={ctx.theme} />,
  toSVG: (o, ctx) => {
    const tr = `translate(${o.x} ${o.y}) rotate(${(o.rotation * 180) / Math.PI}) scale(${o.scaleX} ${o.scaleY})`;
    return `<g transform="${tr}">${elementSvg(withCss(solutionElement(o.props, null)), o.props.w, solutionHeight(o.props), ctx.theme, null, 1)}</g>`;
  },
  editor: 'solution',
  transform: { rotatable: true, resize: 'free' },
  applyResize: (o, scaleX) => ({
    scaleX: o.scaleX,
    scaleY: o.scaleY,
    props: { w: Math.max(160, o.props.w * Math.abs(scaleX / (o.scaleX || 1))) },
  }),
};
