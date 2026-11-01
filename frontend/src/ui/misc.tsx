import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
import { useToasts } from '../store/toast';
import { Button } from './Button';
import { pluralize } from '../lib/format';

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function FullScreenSpinner() {
  return (
    <div className="center-screen">
      <Spinner />
    </div>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'warning' | 'info' | 'success'; children: ReactNode }) {
  const Icon = { error: AlertCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 }[kind];
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Badge({ kind, children, title }: { kind?: 'accent' | 'danger' | 'warning' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={['badge', kind && `badge--${kind}`].filter(Boolean).join(' ')} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong style={{ color: 'var(--text-2)' }}>{title}</strong>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-header__titles">
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="spacer" />
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Страницы">
      <span className="muted small">
        {from}–{to} из {total} {pluralize(total, 'записи', 'записей', 'записей')}
      </span>
      <div className="spacer" />
      <Button size="small" iconOnly icon={<ChevronLeft size={16} />} aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <span className="small">
        {page} / {pages}
      </span>
      <Button size="small" iconOnly icon={<ChevronRight size={16} />} aria-label="Следующая страница" disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </nav>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <div style={{ flex: 1 }}>{t.text}</div>
          <Button variant="ghost" size="small" iconOnly icon={<X size={14} />} aria-label="Закрыть" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, color, size = 30 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} aria-hidden>
      {initials || '?'}
    </span>
  );
}
