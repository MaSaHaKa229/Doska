import { useState } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { getMath, useMathReady } from '../../math/analysis/expr';
import { CONSTANTS } from './constants';
import { fmtSI, rowSI, solveAnswer, SYM_RE, type FindRow, type GivenRow } from './si';
import { GIVEN_TYPE, givenModule, type GivenProps } from './given';

/**
 * Диалог «Дано / Найти / Решение»: величины с единицами (столбец «СИ»
 * считается по ходу набора), искомые величины, строки решения и формула
 * ответа с проверкой размерности.
 */
export function GivenEditor({ objectId, at, ctx, close, readOnly }: PluginEditorProps) {
  useMathReady();
  const math = getMath();
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<GivenProps> | undefined) : undefined;
  const init = obj?.props ?? { ...givenModule.createProps(), rows: [{ sym: '', value: '', unit: '' }], find: [{ sym: '', unit: '' }], steps: [], formula: '' };
  const [rows, setRows] = useState<GivenRow[]>(init.rows);
  const [find, setFind] = useState<FindRow[]>(init.find.length ? init.find : [{ sym: '', unit: '' }]);
  const [steps, setSteps] = useState(init.steps.join('\n'));
  const [formula, setFormula] = useState(init.formula);

  const used = rows.filter((r) => r.sym || r.value || r.unit);
  const badSym = [...used.map((r) => r.sym), ...find.filter((f) => f.sym || f.unit).map((f) => f.sym)].filter((s) => !SYM_RE.test(s));
  const answer = math && find[0]?.sym ? solveAnswer(math, used, find[0], formula) : null;

  const setRow = (i: number, patch: Partial<GivenRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const setFindRow = (i: number, patch: Partial<FindRow>) => setFind((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  const save = () => {
    if (badSym.length || readOnly) return;
    const props: GivenProps = {
      ...(obj?.props ?? givenModule.createProps()),
      rows: used,
      find: find.filter((f) => f.sym || f.unit),
      steps: steps
        .split('\n')
        .map((s) => s.trimEnd())
        .filter((s, i, a) => s || (i > 0 && i < a.length - 1))
        .slice(0, 16)
        .map((s) => s.slice(0, 200)),
      formula: formula.trim(),
    };
    let id = objectId;
    if (obj) ctx.updateObject<GivenProps>(obj.id, { props });
    else id = ctx.createObject<GivenProps>(GIVEN_TYPE, { x: at?.x ?? 0, y: at?.y ?? 0, props });
    if (id) ctx.setSelection([id]);
    close();
  };

  const input = (label: string, value: string, onChange: (v: string) => void, width: number, opts: { bad?: boolean; mono?: boolean; placeholder?: string; maxLength?: number } = {}) => (
    <input
      className={`input${opts.mono ? ' mono' : ''}`}
      style={{ width }}
      aria-label={label}
      aria-invalid={opts.bad}
      value={value}
      placeholder={opts.placeholder}
      maxLength={opts.maxLength ?? 24}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <Dialog
      open
      wide
      onClose={close}
      title="Дано / Найти / Решение"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!!badSym.length || readOnly}>
            {obj ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <fieldset disabled={readOnly} className="given-editor">
        <div className="given-editor__title">Дано</div>
        {rows.map((r, i) => {
          const si = math && (r.value || r.unit) ? rowSI(math, r) : null;
          return (
            <div key={i} className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
              {input(`Обозначение ${i + 1}`, r.sym, (v) => setRow(i, { sym: v }), 70, { bad: !!(r.sym || r.value) && !SYM_RE.test(r.sym), placeholder: 'm', maxLength: 12 })}
              <span>=</span>
              {input(`Значение ${i + 1}`, r.value, (v) => setRow(i, { value: v }), 120, { bad: !!si?.error && si.error === 'не число', placeholder: '500', maxLength: 32 })}
              {input(`Единица ${i + 1}`, r.unit, (v) => setRow(i, { unit: v }), 110, { bad: !!si?.error && si.error !== 'не число', placeholder: 'г' })}
              <span className="small muted" style={{ minWidth: 110 }} data-testid="given-si">
                {si?.error ? <span style={{ color: 'var(--danger)' }}>{si.error}</span> : si?.si ? `= ${si.si}` : ''}
              </span>
              <Button size="small" variant="ghost" aria-label={`Удалить величину ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                ✕
              </Button>
            </div>
          );
        })}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button size="small" disabled={rows.length >= 16} onClick={() => setRows((rs) => [...rs, { sym: '', value: '', unit: '' }])}>
            + Величина
          </Button>
          <select
            className="select select--small"
            aria-label="Добавить постоянную"
            value=""
            disabled={rows.length >= 16}
            onChange={(e) => {
              const c = CONSTANTS.find((k) => k.key === e.target.value);
              if (c) setRows((rs) => [...rs.filter((r) => r.sym || r.value || r.unit), { sym: c.sym, value: fmtSI(c.value), unit: c.unit }]);
            }}
          >
            <option value="">+ Постоянная…</option>
            {CONSTANTS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.title} ({c.sym})
              </option>
            ))}
          </select>
        </div>

        <div className="given-editor__title">Найти</div>
        {find.map((f, i) => (
          <div key={i} className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
            {input(`Искомая ${i + 1}`, f.sym, (v) => setFindRow(i, { sym: v }), 70, { bad: !!(f.sym || f.unit) && !SYM_RE.test(f.sym), placeholder: 'a', maxLength: 12 })}
            <span>— ?, в</span>
            {input(`Единица искомой ${i + 1}`, f.unit, (v) => setFindRow(i, { unit: v }), 110, { placeholder: 'м/с²' })}
            {find.length > 1 && (
              <Button size="small" variant="ghost" aria-label={`Удалить искомую ${i + 1}`} onClick={() => setFind((fs) => fs.filter((_, k) => k !== i))}>
                ✕
              </Button>
            )}
          </div>
        ))}
        <Button size="small" disabled={find.length >= 6} onClick={() => setFind((fs) => [...fs, { sym: '', unit: '' }])}>
          + Искомая
        </Button>

        <div className="given-editor__title">Решение</div>
        <textarea className="input" aria-label="Строки решения" rows={4} style={{ width: '100%', resize: 'vertical' }} value={steps} placeholder={'Второй закон Ньютона: F = m·a\na = F/m'} onChange={(e) => setSteps(e.target.value)} />
        <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 6 }}>
          <span>Ответ: {find[0]?.sym || '…'} =</span>
          {input('Формула ответа', formula, setFormula, 240, { mono: true, placeholder: 'F/m', maxLength: 200 })}
        </div>
        <p className="small" aria-live="polite" data-testid="given-answer" style={{ color: answer?.ok === true ? 'var(--success, #16a34a)' : answer?.ok === false ? 'var(--danger)' : undefined }}>
          {!math ? 'Загрузка вычислений…' : answer ? `${answer.text}. ${answer.ok === true ? '✓' : answer.ok === false ? '✗' : ''} ${answer.message}` : 'Формула ответа — через обозначения «Дано» и постоянные (g, G, k, e, c, h…): значения подставятся в СИ, размерность проверится.'}
        </p>
        {badSym.length > 0 && <p className="small" style={{ color: 'var(--danger)' }}>Обозначение — латиница или греческая буква, затем буквы, цифры, «_» (v0, F_tr, α).</p>}
      </fieldset>
    </Dialog>
  );
}
