import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import type { MathfieldElement } from 'mathlive';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/misc';
import { MAX_LATEX, mathElement } from '../text/schema';
import { FORMULA_PALETTE } from './palette';
import { createMathfield } from './mathlive';

export interface FormulaRequest {
  latex: string;
  /** Заголовок диалога («Формула», «Шаг 2» …). */
  title?: string;
}

/** Кнопка шаблона: формула-пример, отрисованная KaTeX (MathML). */
function PaletteButton({ title, example, onPick }: { title: string; example: string; onPick: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(mathElement(example));
  }, [example]);
  return (
    <button type="button" className="palette-btn" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      <span ref={ref} aria-hidden />
    </button>
  );
}

/**
 * Редактор формулы: MathLive (визуальный ввод, быстрые сочетания вроде
 * sqrt, alpha, int, ->, экранная клавиатура) и палитра шаблонов по темам.
 * На вкладке «LaTeX» формулу можно править кодом.
 */
export function FormulaDialog({ request, onClose, onSave }: { request: FormulaRequest | null; onClose: () => void; onSave: (latex: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState(FORMULA_PALETTE[0]!.id);
  const [code, setCode] = useState<string | null>(null);
  const [latex, setLatex] = useState('');

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setReady(false);
    setCode(null);
    setLatex(request.latex);
    void createMathfield(request.latex, (mf) => {
      if (cancelled) return;
      field.current = mf;
      setReady(true);
      requestAnimationFrame(() => mf.focus());
    }).then((mf) => {
      if (cancelled || !host.current) return;
      mf.className = 'formula-field';
      mf.setAttribute('aria-label', 'Формула');
      mf.addEventListener('input', () => setLatex(mf.getValue('latex')));
      // Экранная клавиатура — внутри модального окна, иначе она окажется под ним.
      const dialog = host.current.closest('dialog');
      if (dialog && window.mathVirtualKeyboard) window.mathVirtualKeyboard.container = dialog as HTMLElement;
      host.current.replaceChildren(mf);
    });
    return () => {
      cancelled = true;
      window.mathVirtualKeyboard?.hide();
      field.current = null;
    };
  }, [request]);

  const value = () => (code ?? field.current?.getValue('latex') ?? latex).trim().slice(0, MAX_LATEX);

  const insert = (template: string) => {
    const mf = field.current;
    if (!mf) return;
    if (code !== null) {
      setCode((c) => `${c ?? ''}${template.replace(/#[0?]/g, '')}`);
      return;
    }
    mf.insert(template, { format: 'latex', selectionMode: 'placeholder', focus: true });
    setLatex(mf.getValue('latex'));
  };

  const toggleCode = () => {
    const mf = field.current;
    if (code === null) setCode(mf?.getValue('latex') ?? latex);
    else {
      if (mf) mf.value = code;
      setLatex(code);
      setCode(null);
      requestAnimationFrame(() => mf?.focus());
    }
  };

  const current = FORMULA_PALETTE.find((s) => s.id === section) ?? FORMULA_PALETTE[0]!;
  return (
    <Dialog
      open={!!request}
      onClose={onClose}
      wide
      title={request?.title ?? 'Формула'}
      onSubmit={() => {
        const v = value();
        if (v) onSave(v);
      }}
      footer={
        <>
          <Button
            icon={<Keyboard size={16} />}
            onClick={() => {
              const kb = window.mathVirtualKeyboard;
              if (!kb) return;
              if (kb.visible) kb.hide();
              else {
                field.current?.focus();
                kb.show();
              }
            }}
            disabled={!ready || code !== null}
          >
            Клавиатура
          </Button>
          <Button onClick={toggleCode} disabled={!ready}>
            {code === null ? 'Код LaTeX' : 'Визуальный ввод'}
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!ready || !(code ?? latex).trim()}>
            {request?.latex ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <div className="formula-editor">
        <div className="formula-palette">
          <div className="tabs formula-palette__tabs" role="tablist" aria-label="Разделы шаблонов">
            {FORMULA_PALETTE.map((s) => (
              <button key={s.id} type="button" role="tab" className="tab" aria-selected={s.id === section} onMouseDown={(e) => e.preventDefault()} onClick={() => setSection(s.id)}>
                {s.title}
              </button>
            ))}
          </div>
          <div className="formula-palette__items" role="group" aria-label={current.title}>
            {current.items.map((it) => (
              <PaletteButton key={it.title} title={it.title} example={it.example} onPick={() => insert(it.template)} />
            ))}
          </div>
        </div>
        {!ready && <Spinner label="Загрузка редактора формул…" />}
        <div
          ref={host}
          className="formula-host"
          hidden={code !== null}
          onKeyDown={(e) => {
            // Enter в поле формулы — сохранить (событие приходит из теневого DOM MathLive).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const v = value();
              if (v) onSave(v);
            }
          }}
        />
        {code !== null && (
          <textarea className="input mono" rows={4} value={code} maxLength={MAX_LATEX} aria-label="Код LaTeX" onChange={(e) => setCode(e.target.value)} autoFocus />
        )}
        <div className="small muted">
          Быстрый ввод: sqrt, frac, alpha, int, sum, lim, -&gt;, &lt;=&gt;, +-, deg, RR. Tab — к следующему месту ввода. Enter — сохранить.
        </div>
      </div>
    </Dialog>
  );
}
