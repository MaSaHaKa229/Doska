import { useEffect, useRef, useState } from 'react';
import { Check, Eye } from 'lucide-react';
import type { BoardModel } from '../../collab/model';
import { useAuth } from '../../store/auth';
import { useBoard } from '../../store/board';
import { errorMessage } from '../../api/http';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';

/** Меню «Вид»: тема интерфейса, меловая доска страницы, привязки, режим «только перо». */
export function ViewMenu({ model, onHelp }: { model: BoardModel; onHelp: () => void }) {
  const prefs = useAuth((s) => s.user?.preferences);
  const update = useAuth((s) => s.updatePreferences);
  const pageId = useBoard((s) => s.pageId);
  const caps = useBoard((s) => s.caps);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!prefs) return null;
  const save = (patch: Parameters<typeof update>[0]) => update(patch).catch((err) => toast.error(errorMessage(err)));
  const page = pageId ? model.page(pageId) : undefined;
  const chalk = page?.background.surface === 'chalk';
  const item = (checked: boolean, label: string, onClick: () => void, disabled = false) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="menu__item" disabled={disabled} onClick={onClick}>
      <span style={{ width: 16, display: 'inline-flex' }}>{checked && <Check size={16} />}</span>
      {label}
    </button>
  );
  return (
    <div className="menu" ref={root}>
      <Button size="small" variant="ghost" icon={<Eye size={16} />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="topbar__label">Вид</span>
      </Button>
      {open && (
        <div className="menu__list" role="menu" style={{ minWidth: 280 }}>
          <div className="small muted" style={{ padding: '4px 10px' }}>
            Тема
          </div>
          {item(prefs.theme === 'light', 'Светлая', () => save({ theme: 'light' }))}
          {item(prefs.theme === 'dark', 'Тёмная', () => save({ theme: 'dark' }))}
          {item(prefs.theme === 'system', 'Как в системе', () => save({ theme: 'system' }))}
          {item(chalk, 'Меловая доска на этой странице', () => pageId && model.setBackground(pageId, { surface: chalk ? 'auto' : 'chalk' }), !caps?.moderate)}
          <div className="small muted" style={{ padding: '8px 10px 4px' }}>
            Привязки (Alt — временно отключить)
          </div>
          {item(prefs.snapToGrid, 'К сетке', () => save({ snapToGrid: !prefs.snapToGrid }))}
          {item(prefs.snapToObjects, 'К объектам: концы, середины, центры, пересечения', () => save({ snapToObjects: !prefs.snapToObjects }))}
          <div className="small muted" style={{ padding: '8px 10px 4px' }}>
            Планшет
          </div>
          {item(prefs.penOnly, 'Только перо: пальцем — двигать доску', () => save({ penOnly: !prefs.penOnly }))}
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              onHelp();
            }}
          >
            <span style={{ width: 16 }} />
            Горячие клавиши (?)
          </button>
        </div>
      )}
    </div>
  );
}
