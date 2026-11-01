import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { noWriteHint, searchScore } from '@doska/shared';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { toolIcon } from '../../ui/icons';
import { Dialog } from '../../ui/Dialog';
import { toast } from '../../store/toast';
import type { PaletteCommand } from './boardCommands';

interface Item {
  key: string;
  title: string;
  hint: string;
  icon?: string;
  hotkey?: string;
  disabled: boolean;
  score: number;
  run: () => void;
}

/**
 * Глобальный поиск Ctrl+K: инструменты и объекты всех разделов-плагинов
 * («линза», «конденсатор», «матрица»), команды доски. Стрелки — выбор,
 * Enter — выполнить, Esc — закрыть.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  /** Вставка объекта плагина в центр экрана (команды с action.kind = 'insert'). */
  onInsert: (objectType: string, props: Record<string, unknown>) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const st = useBoard.getState();
    const out: Item[] = [];
    const toolItem = (id: string, score: number): Item | null => {
      const t = registry.getTool(id);
      if (!t) return null;
      const disabled = t.requiresWrite && !st.caps?.write;
      return {
        key: 'tool:' + t.id,
        title: t.title,
        hint: 'Инструмент' + (t.section ? ` · ${t.section}` : ''),
        icon: t.icon,
        hotkey: t.hotkey,
        disabled,
        score,
        run: () => {
          if (disabled) {
            toast.info(noWriteHint(st.caps?.noWriteReason ?? 'read-only') ?? 'Нет права записи');
            return;
          }
          st.setTool(t.id);
        },
      };
    };
    if (!query.trim()) {
      for (const t of registry.listTools()) {
        const it = toolItem(t.id, 50);
        if (it) out.push(it);
      }
      for (const c of commands) out.push({ key: 'cmd:' + c.id, title: c.title, hint: c.section, hotkey: c.hotkey, disabled: !c.enabled(), score: 40, run: c.run });
      return out;
    }
    for (const r of registry.search(query, 30)) {
      if (r.kind === 'tool') {
        const it = toolItem(r.id, r.score);
        if (it) out.push(it);
      } else if (r.kind === 'command') {
        const cmd = registry.getCommand(r.id);
        if (!cmd) continue;
        const action = cmd.action;
        const needsWrite = action.kind === 'insert' || action.kind === 'template';
        out.push({
          key: 'pcmd:' + r.id,
          title: r.title,
          hint: action.kind === 'insert' ? 'Вставить на доску' : 'Команда' + (r.section ? ` · ${r.section}` : ''),
          hotkey: cmd.hotkey,
          // Шаблоны вставляются из библиотеки (этап 8.1).
          disabled: action.kind === 'template' || (needsWrite && !st.caps?.write),
          score: r.score,
          run: () => {
            if (action.kind === 'tool') toolItem(action.toolId, 0)?.run();
            else if (action.kind === 'insert') onInsert(action.objectType, action.props ?? {});
            else if (action.kind === 'custom') action.run();
          },
        });
      } else if (r.kind === 'template' || r.kind === 'reference') {
        // Библиотека шаблонов и справочник формул — этап 8.1.
        out.push({
          key: r.kind + ':' + r.id,
          title: r.title,
          hint: r.kind === 'template' ? 'Шаблон (библиотека)' : 'Справочник',
          disabled: true,
          score: r.score - 20,
          run: () => undefined,
        });
      }
    }
    for (const c of commands) {
      const score = searchScore(query, c.title, c.keywords);
      if (score > 0) out.push({ key: 'cmd:' + c.id, title: c.title, hint: c.section, hotkey: c.hotkey, disabled: !c.enabled(), score, run: c.run });
    }
    return out.sort((a, b) => b.score - a.score || Number(a.disabled) - Number(b.disabled));
  }, [open, query, commands, onInsert]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const exec = (it: Item | undefined) => {
    if (!it || it.disabled) return;
    onClose();
    it.run();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Поиск инструментов и команд">
      <div className="input-with-icon">
        <Search size={16} />
        <input
          className="input"
          autoFocus
          placeholder="Например: стрелка, круг, группа, масштаб…"
          aria-label="Поиск"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `palette-${active}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              exec(items[active]);
            }
          }}
        />
      </div>
      <div className="palette" id="palette-list" role="listbox" ref={listRef}>
        {items.length === 0 && <div className="muted small" style={{ padding: 12 }}>Ничего не найдено</div>}
        {items.map((it, i) => {
          const Icon = it.icon ? toolIcon(it.icon) : null;
          return (
            <div
              key={it.key}
              id={`palette-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              aria-disabled={it.disabled}
              className={`palette__item${i === active ? ' active' : ''}${it.disabled ? ' disabled' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => exec(it)}
            >
              <span className="palette__icon">{Icon && <Icon size={16} />}</span>
              <span className="palette__title">{it.title}</span>
              <span className="muted small">{it.hint}</span>
              <span className="spacer" />
              {it.hotkey && <kbd>{it.hotkey}</kbd>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Справка по горячим клавишам («?»). */
export function HelpDialog({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: PaletteCommand[] }) {
  const tools = registry.listTools().filter((t) => t.hotkey);
  const sections = new Map<string, { title: string; hotkey: string }[]>();
  sections.set(
    'Инструменты',
    tools.map((t) => ({ title: t.title, hotkey: t.hotkey! })),
  );
  sections.set('Холст', [
    { title: 'Перемещение по доске', hotkey: 'Пробел + мышь, средняя кнопка, два пальца' },
    { title: 'Масштаб', hotkey: 'Колесо мыши, щипок' },
    { title: 'Правильная фигура / шаг 15°', hotkey: 'Shift при рисовании' },
    { title: 'Без привязки', hotkey: 'Alt' },
    { title: 'Сдвиг выделения', hotkey: 'Стрелки (Shift — на 10)' },
    { title: 'Снять выделение, отменить действие', hotkey: 'Esc' },
    { title: 'Копировать, вырезать, вставить', hotkey: 'Ctrl+C, Ctrl+X, Ctrl+V' },
    { title: 'Поиск инструментов и команд', hotkey: 'Ctrl+K' },
  ]);
  for (const c of commands) {
    if (!c.hotkey) continue;
    const list = sections.get(c.section) ?? [];
    list.push({ title: c.title, hotkey: c.hotkey });
    sections.set(c.section, list);
  }
  return (
    <Dialog open={open} onClose={onClose} title="Горячие клавиши" wide>
      <p className="muted small">Буквенные клавиши работают и в русской раскладке. На Mac вместо Ctrl — Cmd.</p>
      <div className="help-grid">
        {[...sections.entries()].map(([section, list]) => (
          <section key={section}>
            <h3 style={{ marginBottom: 6 }}>{section}</h3>
            <table className="table">
              <tbody>
                {list.map((r) => (
                  <tr key={r.title}>
                    <td>{r.title}</td>
                    <td className="nowrap">
                      <kbd>{r.hotkey}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
