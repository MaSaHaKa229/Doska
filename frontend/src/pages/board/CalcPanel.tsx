import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, CornerDownLeft, RotateCcw, X } from 'lucide-react';
import type { Calculator, CalcResult } from '../../formula/calc';
import { Button } from '../../ui/Button';
import { Spinner } from '../../ui/misc';

type Outcome = CalcResult | { error: string } | null;

export interface CalcPanelProps {
  open: boolean;
  /** Начальная запись (пересчёт результата с доски или формула из выделения). */
  initial: string;
  /** Пересчитывается существующий результат на доске. */
  editing: boolean;
  /** Можно ли ставить результат на доску. */
  canInsert: boolean;
  onClose: () => void;
  onInsert: (r: CalcResult) => void;
}

/**
 * Панель калькулятора: не закрывает доску, считает по мере набора, Enter
 * добавляет строку в историю. Переменные живут, пока открыта доска.
 * math.js загружается при первом открытии.
 */
export function CalcPanel({ open, initial, editing, canInsert, onClose, onInsert }: CalcPanelProps) {
  const calc = useRef<Calculator | null>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<CalcResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setInput(initial);
    if (calc.current) {
      setReady(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    let cancelled = false;
    void import('../../formula/calc').then((m) => {
      if (cancelled) return;
      calc.current ??= new m.Calculator();
      setReady(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      cancelled = true;
    };
  }, [open, initial]);

  if (!open) return null;
  const preview: Outcome = ready && calc.current ? calc.current.preview(input) : null;
  const result = preview && !('error' in preview) ? preview : null;

  const commit = () => {
    if (!calc.current) return;
    const r = calc.current.evaluate(input);
    if (!r || 'error' in r) return;
    setHistory((h) => [r, ...h].slice(0, 50));
    setInput('');
  };

  return (
    <aside
      className="calc-panel"
      role="dialog"
      aria-label="Калькулятор"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        // Клавиши панели не должны доходить до горячих клавиш доски.
        e.stopPropagation();
      }}
    >
      <div className="calc-panel__header">
        <h2>Калькулятор</h2>
        <Button
          size="small"
          variant="ghost"
          iconOnly
          icon={<RotateCcw size={16} />}
          title="Очистить историю и переменные"
          aria-label="Очистить историю"
          onClick={() => {
            calc.current?.reset();
            setHistory([]);
          }}
        />
        <Button size="small" variant="ghost" iconOnly icon={<X size={18} />} aria-label="Закрыть калькулятор" onClick={onClose} />
      </div>
      {!ready && <Spinner label="Загрузка калькулятора…" />}
      <input
        ref={inputRef}
        className="input mono"
        aria-label="Выражение"
        placeholder="Например: 72 км/ч в м/с"
        maxLength={500}
        value={input}
        disabled={!ready}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      <div className={`calc-panel__result${preview && 'error' in preview ? ' calc-panel__result--error' : ''}`} aria-live="polite" data-testid="calc-result">
        {preview ? ('error' in preview ? preview.error : result!.assignment ? 'Enter — запомнить' : `= ${result!.value}`) : ' '}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Button size="small" icon={<CornerDownLeft size={16} />} disabled={!result} onClick={commit}>
          В историю
        </Button>
        <Button size="small" variant="primary" icon={<ClipboardPaste size={16} />} disabled={!result || result.assignment || !canInsert} title={canInsert ? undefined : 'Нет права писать на доске'} onClick={() => result && onInsert(result)}>
          {editing ? 'Обновить на доске' : 'На доску'}
        </Button>
      </div>
      {history.length > 0 && (
        <ol className="calc-panel__history" aria-label="История вычислений">
          {history.map((h, i) => (
            <li key={history.length - i}>
              <button type="button" className="calc-panel__line" title="Вставить запись в поле" onClick={() => setInput(h.input)}>
                <span className="mono">{h.input}</span>
                <span className="calc-panel__value">{h.assignment ? '' : `= ${h.value}`}</span>
              </button>
              {!h.assignment && canInsert && (
                <Button size="small" variant="ghost" iconOnly icon={<ClipboardPaste size={14} />} title="На доску" aria-label={`На доску: ${h.input}`} onClick={() => onInsert(h)} />
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="small muted">
        Десятичная запятая, аргументы — через «;». Функции: sin, cos, tg, ctg, lg, ln, log(8; 2), √, степень ^, градусы °. Единицы: мм, см, м, км, г, кг, т, с, мин, ч, Н, Дж, Вт, Па, атм, В, А, Ом, Гц, л…; перевод — «в»: 72 км/ч в м/с. Переменные: x = 5, затем x^2.
      </p>
    </aside>
  );
}
