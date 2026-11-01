import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Monitor, Moon, PenLine, Shield, Sun } from 'lucide-react';
import { USER_ROLE_LABELS } from '@doska/shared';
import { useAuth } from '../store/auth';
import { Avatar } from '../ui/misc';
import { Button } from '../ui/Button';
import { errorMessage } from '../api/http';
import { toast } from '../store/toast';

const THEMES = [
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'system', label: 'Как в системе', icon: Monitor },
] as const;

export function AppLayout() {
  const user = useAuth((s) => s.user)!;
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand__mark">
            <PenLine size={17} />
          </span>
          <span className="brand__name">Учебная доска</span>
        </Link>
        {user.role === 'ADMIN' && (
          <Link to="/admin" className="btn btn--ghost btn--small no-print" title="Администрирование">
            <Shield size={16} /> <span className="topbar__label">Администрирование</span>
          </Link>
        )}
        <div className="spacer" />
        <UserMenu />
      </header>
      <Outlet />
    </div>
  );
}

function UserMenu() {
  const { user, logout, updatePreferences } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const doLogout = async () => {
    setOpen(false);
    await logout().catch(() => undefined);
    navigate('/login');
  };

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="btn btn--ghost user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.fullName} color={user.color} />
        <span className="user-chip__name">{user.fullName}</span>
      </button>
      {open && (
        <div className="menu__list" role="menu" style={{ minWidth: 260 }}>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontWeight: 650 }}>{user.fullName}</div>
            <div className="muted small">
              {user.login} · {USER_ROLE_LABELS[user.role]}
            </div>
          </div>
          <div style={{ padding: '4px 10px 8px' }}>
            <div className="muted small" style={{ marginBottom: 6 }}>
              Тема
            </div>
            <div className="row" role="radiogroup" aria-label="Тема оформления">
              {THEMES.map((t) => (
                <Button
                  key={t.value}
                  size="small"
                  variant={user.preferences.theme === t.value ? 'primary' : 'default'}
                  iconOnly
                  icon={<t.icon size={16} />}
                  title={t.label}
                  aria-label={t.label}
                  role="radio"
                  aria-checked={user.preferences.theme === t.value}
                  onClick={() => updatePreferences({ theme: t.value }).catch((err) => toast.error(errorMessage(err)))}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              navigate('/change-password');
            }}
          >
            <KeyRound size={16} /> Сменить пароль
          </button>
          <button type="button" role="menuitem" className="menu__item" onClick={doLogout}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}
