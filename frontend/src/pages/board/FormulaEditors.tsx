import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { BoardModel } from '../../collab/model';
import { currentCamera, useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Checkbox, TextField } from '../../ui/Field';
import { FormulaDialog, type FormulaRequest } from '../../formula/FormulaDialog';
import { mathElement } from '../../text/schema';
import { DEFAULT_FORMULA_SIZE, FORMULA_TYPE, formulaSize, type FormulaProps } from '../../objects/formula';
import { MAX_STEPS, SOLUTION_TYPE, type SolutionProps } from '../../objects/solution';
import { EDIT_OBJECT_EVENT, type EditObjectDetail } from '../../tools/formula-tools';
import { CALC_TYPE, type CalcProps } from '../../objects/calc';
import { latexToMathjs } from '../../formula/latex-to-mathjs';
import type { CalcResult } from '../../formula/calc';
import { CalcPanel } from './CalcPanel';
import { ReferencePanel } from './ReferencePanel';

/** Запись для калькулятора из выделенной формулы (если её можно посчитать). */
function selectedExpression(model: BoardModel): string {
  const sel = useBoard.getState().selection;
  if (sel.length !== 1) return '';
  const o = model.getObject(sel[0]!);
  if (o?.type === CALC_TYPE) return (o.props as CalcProps).expr;
  if (o?.type !== FORMULA_TYPE) return '';
  const latex = String((o.props as FormulaProps).latex);
  // У равенства «… = ответ» считается левая часть.
  return latexToMathjs(latex.split('=')[0] ?? '') ?? '';
}

/**
 * Редакторы формулы и блока «Решение» и калькулятор: открываются
 * инструментом (новый объект в точке щелчка), двойным щелчком по объекту и
 * из Ctrl+K. Распознанная рукопись открывается в редакторе формулы.
 */
export function FormulaEditorsHost({ model }: { model: BoardModel }) {
  const [req, setReq] = useState<EditObjectDetail | null>(null);
  // Калькулятор — отдельная панель: она остаётся открытой рядом с другими редакторами.
  const [calc, setCalc] = useState<{ id: string | null; at: EditObjectDetail['at']; initial: string } | null>(null);
  const caps = useBoard((s) => s.caps);
  // Справочник формул — тоже отдельная панель.
  const [refOpen, setRefOpen] = useState(false);

  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<EditObjectDetail>).detail;
      // Редакторы плагинов открывает PluginEditorsHost.
      if (d.editor !== 'formula' && d.editor !== 'solution' && d.editor !== 'calc' && d.editor !== 'reference') return;
      if (d.editor === 'reference') {
        setRefOpen(true);
        return;
      }
      if (d.editor === 'calc') {
        const id = d.id && model.canModify(d.id, 'props') ? d.id : null;
        const initial = d.id ? String((model.getObject(d.id)?.props as CalcProps | undefined)?.expr ?? '') : selectedExpression(model);
        setCalc({ id, at: d.at, initial });
        return;
      }
      if (d.id && !model.canModify(d.id, 'props')) {
        toast.info('Этот объект нельзя изменить');
        return;
      }
      setReq(d);
    };
    window.addEventListener(EDIT_OBJECT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_OBJECT_EVENT, onEdit);
  }, [model]);

  const pageId = useBoard((s) => s.pageId);
  const create = <P,>(type: string, props: P, size: { width: number; height: number }, point = req?.at, replaces: string[] = []): string | null => {
    if (!pageId) return null;
    const cam = currentCamera();
    const at = point ?? { x: cam.cx - size.width / 2, y: cam.cy - size.height / 2 };
    let id: string | null = null;
    // Новая формула и удаление заменённых штрихов — один шаг отмены.
    model.transact(() => {
      id = model.createObject(type, { pageId, x: at.x, y: at.y, props });
      if (id && replaces.length) model.deleteObjects(replaces);
    });
    if (id) useBoard.getState().setSelection([id]);
    else toast.info('Нет права добавлять объекты на эту страницу');
    return id;
  };

  const insertCalc = (r: CalcResult) => {
    if (!calc) return;
    if (calc.id && model.getObject(calc.id)) {
      model.updateObjects([{ id: calc.id, patch: { props: { expr: r.input, latex: r.latex } } }]);
      return;
    }
    const props: CalcProps = { expr: r.input, latex: r.latex, size: DEFAULT_FORMULA_SIZE, color: useBoard.getState().toolOptions.stroke };
    const id = create(CALC_TYPE, props, formulaSize(props), calc.at);
    // Следующий результат встанет ниже предыдущего, а не поверх.
    if (id) {
      const b = model.boundsOf([id]);
      if (b) setCalc((c) => (c ? { ...c, at: { x: b.x, y: b.y + b.height + 8 } } : c));
    }
  };

  const formulaReq: FormulaRequest | null =
    req?.editor === 'formula'
      ? {
          latex: req.id ? String((model.getObject(req.id)?.props as FormulaProps | undefined)?.latex ?? '') : (req.latex ?? ''),
          title: req.replaces?.length ? 'Распознанная формула' : undefined,
          insert: !req.id,
        }
      : null;
  const solution = req?.editor === 'solution' ? (req.id ? (model.getObject(req.id)?.props as SolutionProps | undefined) ?? null : null) : null;

  return (
    <>
      <FormulaDialog
        request={formulaReq}
        onClose={() => setReq(null)}
        onSave={(latex) => {
          if (req?.id) model.updateObjects([{ id: req.id, patch: { props: { latex } } }]);
          else {
            const props: FormulaProps = { latex, size: req?.size ?? DEFAULT_FORMULA_SIZE, color: useBoard.getState().toolOptions.stroke };
            create(FORMULA_TYPE, props, formulaSize(props), req?.at, req?.replaces);
          }
          setReq(null);
        }}
      />
      <SolutionDialog
        open={req?.editor === 'solution'}
        initial={solution}
        onClose={() => setReq(null)}
        onSave={(props) => {
          if (req?.id) model.updateObjects([{ id: req.id, patch: { props } }]);
          else create(SOLUTION_TYPE, props, { width: props.w, height: 100 });
          setReq(null);
        }}
      />
      <CalcPanel
        open={!!calc}
        initial={calc?.initial ?? ''}
        editing={!!calc?.id}
        canInsert={!!caps?.write}
        onClose={() => setCalc(null)}
        onInsert={insertCalc}
      />
      <ReferencePanel
        open={refOpen}
        canInsert={!!caps?.write}
        onClose={() => setRefOpen(false)}
        onInsert={(latex) => {
          const props: FormulaProps = { latex, size: 28, color: useBoard.getState().toolOptions.stroke };
          create(FORMULA_TYPE, props, formulaSize(props), null);
        }}
      />
    </>
  );
}

function MathPreview({ latex }: { latex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(latex.trim() ? mathElement(latex) : document.createTextNode('— пусто —'));
  }, [latex]);
  return <span ref={ref} />;
}

const EMPTY: SolutionProps = { title: 'Решение', steps: [], w: 560, size: 22, check: true };

/** Редактор блока «Решение»: заголовок, шаги (формула + комментарий), порядок, проверка. */
function SolutionDialog({ open, initial, onClose, onSave }: { open: boolean; initial: SolutionProps | null; onClose: () => void; onSave: (p: SolutionProps) => void }) {
  const [p, setP] = useState<SolutionProps>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => {
    if (open) setP(initial ?? EMPTY);
    // Новое решение начинается с ввода первого шага.
    if (open && !initial) setEditing(0);
  }, [open, initial]);

  const setStep = (i: number, patch: Partial<SolutionProps['steps'][number]>) =>
    setP((cur) => ({ ...cur, steps: cur.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setP((cur) => {
      const steps = [...cur.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return cur;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...cur, steps };
    });

  return (
    <>
      <Dialog
        open={open && editing === null}
        onClose={onClose}
        wide
        title="Решение"
        onSubmit={() => onSave({ ...p, steps: p.steps.filter((s) => s.latex.trim() || s.note.trim()) })}
        footer={
          <>
            <Button onClick={onClose}>Отмена</Button>
            <Button type="submit" variant="primary" disabled={!p.steps.some((s) => s.latex.trim())}>
              Сохранить
            </Button>
          </>
        }
      >
        <TextField label="Заголовок" value={p.title} maxLength={200} onChange={(e) => setP({ ...p, title: e.target.value })} />
        <div className="solution-steps" data-testid="solution-steps">
          {p.steps.map((s, i) => (
            <div key={i} className="solution-step">
              <span className="solution-step__num">{i + 1}.</span>
              <button type="button" className="solution-step__formula" title="Изменить формулу шага" onClick={() => setEditing(i)}>
                <MathPreview latex={s.latex} />
              </button>
              <input
                className="input"
                placeholder="Комментарий (необязательно)"
                aria-label={`Комментарий к шагу ${i + 1}`}
                maxLength={500}
                value={s.note}
                onChange={(e) => setStep(i, { note: e.target.value })}
              />
              <Button size="small" variant="ghost" iconOnly icon={<ArrowUp size={16} />} aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="small" variant="ghost" iconOnly icon={<ArrowDown size={16} />} aria-label="Ниже" disabled={i === p.steps.length - 1} onClick={() => move(i, 1)} />
              <Button size="small" variant="ghost" iconOnly icon={<Trash2 size={16} />} aria-label={`Удалить шаг ${i + 1}`} onClick={() => setP({ ...p, steps: p.steps.filter((_, k) => k !== i) })} />
            </div>
          ))}
        </div>
        <Button icon={<Plus size={16} />} disabled={p.steps.length >= MAX_STEPS} onClick={() => setEditing(p.steps.length)}>
          Добавить шаг
        </Button>
        <Checkbox
          label="Проверять переходы между шагами (числовая проверка: ✓ — равносильно, ✗ — выражения не равны, ? — не проверено)"
          checked={p.check}
          onChange={(e) => setP({ ...p, check: e.target.checked })}
        />
      </Dialog>
      <FormulaDialog
        request={open && editing !== null ? { latex: p.steps[editing]?.latex ?? (editing > 0 ? p.steps[editing - 1]?.latex ?? '' : ''), title: `Шаг ${editing + 1}` } : null}
        onClose={() => {
          // Отмена первого шага нового решения — закрыть всё.
          if (!initial && p.steps.length === 0) onClose();
          setEditing(null);
        }}
        onSave={(latex) => {
          setP((cur) => {
            const steps = [...cur.steps];
            if (editing! < steps.length) steps[editing!] = { ...steps[editing!]!, latex };
            else steps.push({ latex, note: '' });
            return { ...cur, steps };
          });
          setEditing(null);
        }}
      />
    </>
  );
}
