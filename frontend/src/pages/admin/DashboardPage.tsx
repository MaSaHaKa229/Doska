import { Link } from 'react-router-dom';
import { FileUp, School, UserPlus, Users } from 'lucide-react';
import { AUDIT_ACTION_LABELS } from '@doska/shared';
import { adminApi } from '../../api/admin';
import { useLoader } from '../../lib/hooks';
import { formatRelative } from '../../lib/format';
import { Alert, PageHeader, Spinner } from '../../ui/misc';

export function DashboardPage() {
  const stats = useLoader(() => adminApi.stats(), []);
  const recent = useLoader((signal) => adminApi.listAudit({ pageSize: 10 }, signal), []);
  const s = stats.data;

  const cards = s
    ? [
        { label: 'Пользователей', value: s.users.total, to: '/admin/users' },
        { label: 'Учителей', value: s.users.teachers, to: '/admin/users?role=TEACHER' },
        { label: 'Учеников', value: s.users.students, to: '/admin/users?role=STUDENT' },
        { label: 'Классов и групп', value: s.classes, to: '/admin/classes' },
        { label: 'Не сменили временный пароль', value: s.users.pendingPassword, to: '/admin/users?status=pending' },
        { label: 'Заблокировано', value: s.users.blocked, to: '/admin/users?status=blocked' },
        { label: 'Входов сегодня', value: s.loginsToday, to: '/admin/audit?actions=LOGIN_SUCCESS' },
        { label: 'Неудачных входов сегодня', value: s.failedLoginsToday, to: '/admin/audit?actions=LOGIN_FAILED,LOGIN_BLOCKED' },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Обзор"
        actions={
          <>
            <Link to="/admin/users?create=1" className="btn btn--primary">
              <UserPlus size={16} /> Новый пользователь
            </Link>
            <Link to="/admin/users/import" className="btn">
              <FileUp size={16} /> Импорт CSV
            </Link>
          </>
        }
      />
      {stats.error && <Alert kind="error">{stats.error}</Alert>}
      {stats.loading && !s ? (
        <Spinner />
      ) : (
        <div className="stats">
          {cards.map((c) => (
            <Link key={c.label} to={c.to} className="card stat" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="stat__value">{c.value}</div>
              <div className="stat__label">{c.label}</div>
            </Link>
          ))}
        </div>
      )}

      <section className="card">
        <div className="card__header">
          <h2 style={{ flex: 1 }}>Последние события</h2>
          <Link to="/admin/audit" className="small">
            Весь журнал
          </Link>
        </div>
        {recent.error && (
          <div className="card__body">
            <Alert kind="error">{recent.error}</Alert>
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {recent.data?.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted small">{formatRelative(e.createdAt)}</td>
                  <td>{AUDIT_ACTION_LABELS[e.action]}</td>
                  <td>{e.actor?.fullName ?? e.actorLogin ?? '—'}</td>
                  <td className="muted">{e.targetLabel ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="row">
        <Link to="/admin/users" className="btn">
          <Users size={16} /> Пользователи
        </Link>
        <Link to="/admin/classes" className="btn">
          <School size={16} /> Классы и группы
        </Link>
      </div>
    </>
  );
}
