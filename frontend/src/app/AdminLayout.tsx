import { NavLink, Outlet } from 'react-router-dom';
import { FileClock, KeyRound, LayoutDashboard, School, Users } from 'lucide-react';
import { useCredentials } from '../store/credentials';

export function AdminLayout() {
  const hasCredentials = useCredentials((s) => s.items.length > 0);
  const links = [
    { to: '/admin', end: true, label: 'Обзор', icon: LayoutDashboard },
    { to: '/admin/users', label: 'Пользователи', icon: Users },
    { to: '/admin/classes', label: 'Классы и группы', icon: School },
    { to: '/admin/audit', label: 'Журнал действий', icon: FileClock },
    ...(hasCredentials ? [{ to: '/admin/credentials', label: 'Пароли для печати', icon: KeyRound }] : []),
  ];
  return (
    <div className="admin">
      <nav className="sidenav no-print" aria-label="Разделы администрирования">
        <div className="sidenav__inner">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="sidenav__link">
              <l.icon size={18} />
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
