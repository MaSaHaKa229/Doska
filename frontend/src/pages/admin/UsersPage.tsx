import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  FileUp,
  KeyRound,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { USER_ROLE_LABELS, type AdminUser, type ClassSummary, type Credential, type UserRole } from '@doska/shared';
import { adminApi, type UsersFilter } from '../../api/admin';
import { errorMessage } from '../../api/http';
import { useDebounced, useLoader } from '../../lib/hooks';
import { formatRelative } from '../../lib/format';
import { toast } from '../../store/toast';
import { useAuth } from '../../store/auth';
import { Button } from '../../ui/Button';
import { SelectField, TextAreaField } from '../../ui/Field';
import { ActionMenu } from '../../ui/Menu';
import { Alert, Badge, EmptyState, PageHeader, Pagination, Spinner } from '../../ui/misc';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { UserFormDialog } from './UserFormDialog';
import { CredentialDialog } from './CredentialDialog';

type Sort = NonNullable<UsersFilter['sort']>;

const PAGE_SIZE = 25;

export function UserStatusBadges({ user }: { user: Pick<AdminUser, 'isBlocked' | 'lockedUntil' | 'mustChangePassword' | 'blockedReason'> }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {user.isBlocked && (
        <Badge kind="danger" title={user.blockedReason ?? undefined}>
          Заблокирован
        </Badge>
      )}
      {!user.isBlocked && user.lockedUntil && (
        <Badge kind="warning" title="Вход временно заблокирован после неудачных попыток">
          Вход приостановлен
        </Badge>
      )}
      {user.mustChangePassword && <Badge kind="info">Временный пароль</Badge>}
      {!user.isBlocked && !user.lockedUntil && !user.mustChangePassword && <Badge kind="accent">Активен</Badge>}
    </span>
  );
}

export function UsersPage() {
  const me = useAuth((s) => s.user)!;
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput, 300);

  const filter: UsersFilter = {
    search: search || undefined,
    role: (params.get('role') as UserRole | null) ?? '',
    classId: params.get('classId') && params.get('classId') !== 'none' ? params.get('classId')! : undefined,
    noClass: params.get('classId') === 'none',
    status: (params.get('status') as UsersFilter['status']) ?? 'all',
    sort: (params.get('sort') as Sort) ?? 'fullName',
    order: (params.get('order') as 'asc' | 'desc') ?? 'asc',
    page: Number(params.get('page') ?? 1) || 1,
    pageSize: PAGE_SIZE,
  };

  const setParam = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('search') ?? '') !== search) setParam({ search: search || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const list = useLoader((signal) => adminApi.listUsers(filter, signal), [JSON.stringify(filter)]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  useEffect(() => {
    adminApi.allClasses().then(setClasses).catch((err) => toast.error(errorMessage(err)));
  }, []);

  // Диалоги
  const [editing, setEditing] = useState<AdminUser | null | 'new'>(params.get('create') ? 'new' : null);
  const [credential, setCredential] = useState<{ title: string; value: Credential } | null>(null);
  const [blocking, setBlocking] = useState<AdminUser | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get('create')) setParam({ create: null }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceUser = (u: AdminUser) =>
    list.setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === u.id ? u : x)) } : d));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sortHeader = (key: Sort, label: string) => {
    const active = filter.sort === key;
    const nextOrder = active && filter.order === 'asc' ? 'desc' : 'asc';
    return (
      <button
        type="button"
        className="th-sort"
        aria-sort={active ? (filter.order === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => setParam({ sort: key, order: nextOrder })}
      >
        {label}
        {active && (filter.order === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
      </button>
    );
  };

  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  return (
    <>
      <PageHeader
        title="Пользователи"
        subtitle={list.data ? `Всего: ${list.data.total}` : undefined}
        actions={
          <>
            <Link to="/admin/users/import" className="btn">
              <FileUp size={16} /> Импорт CSV
            </Link>
            <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setEditing('new')}>
              Новый пользователь
            </Button>
          </>
        }
      />

      <div className="card card__body toolbar">
        <div className="field field--grow">
          <label className="field__label" htmlFor="user-search">
            Поиск
          </label>
          <div className="input-with-icon">
            <Search size={16} />
            <input
              id="user-search"
              className="input"
              type="search"
              placeholder="ФИО или логин"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>
        <SelectField label="Роль" value={filter.role ?? ''} onChange={(e) => setParam({ role: e.target.value || null })}>
          <option value="">Все роли</option>
          <option value="STUDENT">Ученики</option>
          <option value="TEACHER">Учителя</option>
          <option value="ADMIN">Администраторы</option>
        </SelectField>
        <SelectField label="Класс" value={params.get('classId') ?? ''} onChange={(e) => setParam({ classId: e.target.value || null })}>
          <option value="">Все классы</option>
          <option value="none">Без класса</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.academicYear ? ` (${c.academicYear})` : ''}
            </option>
          ))}
        </SelectField>
        <SelectField label="Статус" value={filter.status} onChange={(e) => setParam({ status: e.target.value === 'all' ? null : e.target.value })}>
          <option value="all">Любой</option>
          <option value="active">Активные</option>
          <option value="blocked">Заблокированные</option>
          <option value="pending">С временным паролем</option>
        </SelectField>
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{sortHeader('fullName', 'ФИО')}</th>
                <th>{sortHeader('login', 'Логин')}</th>
                <th>Роль</th>
                <th>Классы</th>
                <th>Статус</th>
                <th>{sortHeader('lastLoginAt', 'Последний вход')}</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="color-dot" style={{ background: u.color }} />
                      <button type="button" className="btn btn--ghost btn--small" style={{ padding: 0, fontWeight: 560 }} onClick={() => setEditing(u)}>
                        {u.fullName}
                      </button>
                      {u.id === me.id && <Badge>вы</Badge>}
                    </span>
                  </td>
                  <td className="mono">{u.login}</td>
                  <td className="nowrap">{USER_ROLE_LABELS[u.role]}</td>
                  <td>
                    {u.classes.length ? (
                      <span className="row" style={{ gap: 4 }}>
                        {u.classes.map((c) => (
                          <Link key={c.id} to={`/admin/classes/${c.id}`} className="badge">
                            {className.get(c.id) ?? c.name}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <UserStatusBadges user={u} />
                  </td>
                  <td className="nowrap muted small" title={u.lastLoginAt ?? ''}>
                    {formatRelative(u.lastLoginAt)}
                  </td>
                  <td>
                    <ActionMenu
                      items={[
                        { label: 'Изменить', icon: <Pencil size={16} />, onSelect: () => setEditing(u) },
                        { label: 'Сбросить пароль', icon: <KeyRound size={16} />, onSelect: () => setResetting(u) },
                        {
                          label: 'Разблокировать',
                          icon: <ShieldCheck size={16} />,
                          hidden: !u.isBlocked && !u.lockedUntil,
                          onSelect: () =>
                            run(async () => {
                              const res = await adminApi.unblockUser(u.id);
                              replaceUser(res.user);
                              toast.success(`${u.fullName}: доступ восстановлен`);
                            }),
                        },
                        {
                          label: 'Заблокировать',
                          icon: <Ban size={16} />,
                          hidden: u.isBlocked || u.id === me.id,
                          onSelect: () => {
                            setBlockReason('');
                            setBlocking(u);
                          },
                        },
                        { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, hidden: u.id === me.id, onSelect: () => setDeleting(u) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.loading && !list.data && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {list.data && list.data.items.length === 0 && (
          <EmptyState icon={<Users size={40} />} title="Никого не нашлось">
            Измените условия поиска или создайте пользователя.
          </EmptyState>
        )}
        {list.data && list.data.total > 0 && (
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(p) => setParam({ page: String(p) }, false)}
          />
        )}
      </section>

      <UserFormDialog
        open={editing !== null}
        user={editing === 'new' ? null : editing}
        classes={classes}
        defaultClassId={filter.classId}
        onClose={() => setEditing(null)}
        onSaved={(u, cred) => {
          setEditing(null);
          if (cred) {
            setCredential({ title: 'Пользователь создан', value: cred });
            list.reload();
          } else {
            replaceUser(u);
            toast.success('Изменения сохранены');
          }
        }}
      />

      <CredentialDialog credential={credential?.value ?? null} title={credential?.title ?? ''} onClose={() => setCredential(null)} />

      <ConfirmDialog
        open={!!blocking}
        title="Заблокировать пользователя?"
        message={
          <>
            <strong>{blocking?.fullName}</strong> не сможет войти, а открытые сессии будут сразу завершены.
          </>
        }
        confirmLabel="Заблокировать"
        danger
        busy={busy}
        onClose={() => setBlocking(null)}
        onConfirm={() =>
          run(async () => {
            const res = await adminApi.blockUser(blocking!.id, blockReason.trim() || undefined);
            replaceUser(res.user);
            toast.success(`${blocking!.fullName} заблокирован(а)`);
            setBlocking(null);
          })
        }
      >
        <TextAreaField
          label="Причина (необязательно, видна администраторам)"
          value={blockReason}
          maxLength={500}
          style={{ minHeight: 70, fontFamily: 'inherit' }}
          onChange={(e) => setBlockReason(e.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!resetting}
        title="Сбросить пароль?"
        message={
          <>
            Для <strong>{resetting?.fullName}</strong> будет создан новый временный пароль. Старый перестанет действовать, все сессии
            завершатся.
          </>
        }
        confirmLabel="Сбросить пароль"
        busy={busy}
        onClose={() => setResetting(null)}
        onConfirm={() =>
          run(async () => {
            const res = await adminApi.resetPassword(resetting!.id);
            setResetting(null);
            setCredential({ title: 'Новый временный пароль', value: res.credential });
            list.reload();
          })
        }
      />

      <ConfirmDialog
        open={!!deleting}
        title="Удалить пользователя?"
        message={
          <>
            Учётная запись <strong>{deleting?.fullName}</strong> будет удалена, логин освободится. Нарисованное на досках останется с
            подписью автора. Действие необратимо.
          </>
        }
        confirmLabel="Удалить"
        danger
        busy={busy}
        requireText={deleting?.login}
        requireTextLabel={`Для подтверждения введите логин «${deleting?.login ?? ''}»`}
        onClose={() => setDeleting(null)}
        onConfirm={(typed) =>
          run(async () => {
            await adminApi.deleteUser(deleting!.id, typed.toLowerCase());
            toast.success(`${deleting!.fullName}: учётная запись удалена`);
            setDeleting(null);
            list.reload();
          })
        }
      />
    </>
  );
}
