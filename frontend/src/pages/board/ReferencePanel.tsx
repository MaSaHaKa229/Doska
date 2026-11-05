import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Search, X } from 'lucide-react';
import { REFERENCE, searchReference } from '../../formula/reference';
import { mathElement } from '../../text/schema';
import { Button } from '../../ui/Button';

function Formula({ latex }: { latex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Выключной режим: дроби и индексы — полного размера.
    ref.current?.replaceChildren(mathElement(latex, document, true));
  }, [latex]);
  return <span ref={ref} className="ref-panel__math" />;
}

/**
 * Справочник формул: темы, поиск по названиям и обозначениям, вставка
 * формулы на доску (объект «Формула» в центре экрана, дальше правится как обычно).
 */
export function ReferencePanel({ open, canInsert, onClose, onInsert }: { open: boolean; canInsert: boolean; onClose: () => void; onInsert: (latex: string) => void }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  const found = useMemo(() => searchReference(query, topic || undefined), [query, topic]);
  if (!open) return null;
  return (
    <aside
      className="calc-panel ref-panel"
      role="dialog"
      aria-label="Справочник формул"
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
        <h2>Справочник формул</h2>
        <Button size="small" variant="ghost" iconOnly icon={<X size={18} />} aria-label="Закрыть справочник" onClick={onClose} />
      </div>
      <div className="input-with-icon">
        <Search size={16} />
        <input ref={inputRef} className="input" type="search" aria-label="Поиск формулы" placeholder="Например: площадь трапеции" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <select className="select" aria-label="Тема" value={topic} onChange={(e) => setTopic(e.target.value)}>
        <option value="">Все темы</option>
        {(['Математика', 'Физика'] as const).map((g) => (
          <optgroup key={g} label={g}>
            {REFERENCE.filter((t) => t.group === g).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ol className="ref-panel__list" aria-label="Формулы">
        {found.map(({ topic: t, item }, i) => (
          <li key={`${t.id}-${item.title}`}>
            {(i === 0 || found[i - 1]!.topic.id !== t.id) && <div className="ref-panel__topic">{t.title}</div>}
            <div className="ref-panel__item">
              <div className="ref-panel__title">{item.title}</div>
              <Formula latex={item.latex} />
              {item.notes && <div className="small muted">{item.notes}</div>}
              {canInsert && (
                <Button size="small" variant="ghost" icon={<ClipboardPaste size={14} />} aria-label={`На доску: ${item.title}`} onClick={() => onInsert(item.latex)}>
                  На доску
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!found.length && <p className="small muted">Ничего не найдено — попробуйте другое слово или тему.</p>}
    </aside>
  );
}
