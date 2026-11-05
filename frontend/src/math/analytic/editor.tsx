import { useState } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { parseCurve, useMathReady } from '../analysis/expr';
import { frameOf } from '../analysis/plot';
import { axesAt, sliderIds } from '../analysis/editor';
import { analyzeConic, conicText, lineText, parseLine, parseQuadratic } from './eqs';
import { CONIC_TYPE, LINE_TYPE, conicModule, lineModule, type ConicProps, type LineProps } from './objects';

const EXAMPLES = {
  line: ['2x - 3y + 6 = 0', 'y = 2x - 1', 'x = 3', 'y = k·x + b'],
  conic: ['x^2/25 + y^2/9 = 1', 'x^2/9 - y^2/16 = 1', 'y^2 = 8x', 'x^2 + y^2 - 4x + 6y - 12 = 0', 'x·y = 4'],
};

/** Диалог уравнения прямой или кривой второго порядка: проверка и приведение по ходу набора. */
function EquationEditor({ objectId, at, ctx, close, kind }: PluginEditorProps & { kind: 'line' | 'conic' }) {
  const ready = useMathReady();
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<LineProps | ConicProps> | undefined) : undefined;
  const [text, setText] = useState(obj?.props.text ?? '');
  let status: { ok: boolean; text: string } = { ok: false, text: ready ? ' ' : 'Загрузка…' };
  let params: string[] = [];
  if (ready && text.trim()) {
    const parsed = parseCurve(text);
    params = 'error' in parsed ? [] : parsed.params;
    // Для проверки параметры (будущие слайдеры) берутся равными 1.
    const values = Object.fromEntries(params.map((p) => [p, 1]));
    if (kind === 'line') {
      const l = parseLine(text, values);
      status = 'error' in l ? { ok: false, text: l.error } : { ok: true, text: params.length ? `Прямая (параметры: ${params.join(', ')})` : `Прямая: ${lineText(l)}` };
    } else {
      const q = parseQuadratic(text, values);
      status = 'error' in q ? { ok: false, text: q.error } : { ok: true, text: conicText(analyzeConic(q)) };
    }
  }

  const save = () => {
    if (!status.ok) return;
    let id = objectId;
    ctx.transact(() => {
      if (obj) {
        const axes = ctx.resolve.getObject(obj.deps[0]!);
        const sliders = axes ? sliderIds(ctx, frameOf(axes).rect, params) : [];
        ctx.updateObject(obj.id, { props: { text: text.trim() }, deps: [obj.deps[0]!, ...sliders] });
        return;
      }
      const { id: axesId, rect } = axesAt(ctx, at);
      if (!axesId) return;
      const sliders = sliderIds(ctx, rect, params);
      const type = kind === 'line' ? LINE_TYPE : CONIC_TYPE;
      const props = { ...(kind === 'line' ? lineModule.createProps() : conicModule.createProps()), text: text.trim() };
      id = ctx.createObject(type, { x: 0, y: 0, props, deps: [axesId, ...sliders] });
    });
    if (id) ctx.setSelection([id]);
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      wide
      title={kind === 'line' ? 'Прямая по уравнению' : 'Кривая второго порядка'}
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!status.ok}>
            {obj ? 'Сохранить' : 'Построить'}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Уравнение</span>
        <input className="input mono" aria-label="Уравнение" autoFocus maxLength={300} value={text} placeholder={EXAMPLES[kind][0]} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="small" aria-live="polite" data-testid="equation-status" style={{ minHeight: '1.4em', color: status.ok || !text.trim() ? 'var(--text-2)' : 'var(--danger)' }}>
        {status.text}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {EXAMPLES[kind].map((ex) => (
          <Button key={ex} size="small" variant="ghost" className="mono" onClick={() => setText(ex)}>
            {ex}
          </Button>
        ))}
      </div>
      <p className="small muted">
        {kind === 'line'
          ? 'Любая запись: Ax + By + C = 0, y = kx + b, x = a. Буквы кроме x и y — параметры со слайдерами.'
          : 'Каноническое или общее уравнение. Доска приведёт его к каноническому виду, найдёт фокусы, директрисы и асимптоты.'}
      </p>
    </Dialog>
  );
}

export const LineEditor = (p: PluginEditorProps) => <EquationEditor {...p} kind="line" />;
export const ConicEditor = (p: PluginEditorProps) => <EquationEditor {...p} kind="conic" />;
