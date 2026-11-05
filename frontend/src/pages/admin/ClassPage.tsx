import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, KeyRound, Pencil, Trash2, UserMinus, UserPlus } from 'lucide-react';
import type { ClassMemberInfo } from '@doska/shared';
import { adminApi } from '../../api/admin';
import { errorMessage } from '../../api/http';
import { useLoader } from '../../lib/hooks';
import { formatRelative, pluralize } from '../../lib/format';
import { toast } from '../../store/toast';
import { useCredentials } from '../../store/credentials';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Field';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Alert, Badge, EmptyState, PageHeader, Spinner } from '../../ui/misc';
import { ClassFormDialog } from './ClassFormDialog';
import { AddMembersDialog } from './AddMembersDialog';
import { UserStatusBadges } from './UsersPage';

export function ClassPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const setCredentials = useCredentials((s) => s.set);
  const loader = useLoader(() => adminApi.getClass(id).then((r) => r.class), [id]);
  const cls = loader.data;

  const [tab, setTab] = useState<'students' | 'teachers'>('students');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<'STUDENT' | 'TEACHER' | null>(null);
  const [removing, setRemoving] = useState<ClassMemberInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [onlyPending, setOnlyPending] = useState(true);
  const [busy, setBusy] = useState(false);

  const existingIds = useMemo(
    () => new Set([...(cls?.students ?? []), ...(cls?.teacherMembers ?? [])].map((m) => m.id)),
    [cls],
  );

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

  if (loader.loading && !cls) return <Spinner />;
  if (loader.error || !cls) return <Alert kind="error">{loader.error ?? 'Класс не найден'}</Alert>;

  const members = tab === 'students' ? cls.students : cls.teacherMembers;
  const pendingCount = cls.students.filter((s) => s.mustChangePassword).length;

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            {cls.name} {cls.archived && <Badge>архив</Badge>}
          </span>
        }
        subtitle={
          <>
            <Link to="/admin/classes">← Классы</Link>
            {cls.academicYear && <> · {cls.academicYear} учебный год</>}
            {cls.description && <> · {cls.description}</>}
          </>
        }
        actions={
          <>
            <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Изменить
            </Button>
            <Button
              icon={cls.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              loading={busy}
              onClick={() =>
                run(async () => {
                  const res = await adminApi.updateClass(cls.id, { archived: !cls.archived });
                  loader.setData(res.class);
                  toast.success(res.class.archived ? 'Класс перенесён в архив' : 'Класс возвращён из архива');
                })
              }
            >
              {cls.archived ? 'Из архива' : 'В архив'}
            </Button>
            <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setDeleting(true)}>
              Удалить
            </Button>
          </>
        }
      />

      <section className="card">
        <div className="tabs" role="tablist" style={{ padding: '0 12px' }}>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'students'} onClick={() => setTab('students')}>
            Ученики ({cls.students.length})
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'teachers'} onClick={() => setTab('teachers')}>
            Учителя ({cls.teacherMembers.length})
          </button>
        </div>
        <div className="card__body row">
          <Button
            variant="primary"
            icon={<UserPlus size={16} />}
            disabled={cls.archived}
            title={cls.archived ? 'Класс в архиве' : undefined}
            onClick={() => setAdding(tab === 'students' ? 'STUDENT' : 'TEACHER')}
          >
            {tab === 'students' ? 'Добавить учеников' : 'Назначить учителей'}
          </Button>
          {tab === 'students' && cls.students.length > 0 && (
            <Button icon={<KeyRound size={16} />} onClick={() => setResetting(true)}>
              Пароли для класса
            </Button>
          )}
          <div className="spacer" />
          {tab === 'students' && pendingCount > 0 && (
            <span className="muted small">
              {pendingCount} {pluralize(pendingCount, 'ученик ещё не сменил', 'ученика ещё не сменили', 'учеников ещё не сменили')} временный пароль
            </span>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Логин</th>
                <th>Статус</th>
                <th>Последний вход</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/admin/users?search=${encodeURIComponent(m.login)}`}>{m.fullName}</Link>
                  </td>
                  <td className="mono">{m.login}</td>
                  <td>
                    <UserStatusBadges user={{ ...m, lockedUntil: null, blockedReason: null }} />
                  </td>
                  <td className="muted small nowrap">{formatRelative(m.lastLoginAt)}</td>
                  <td>
                    <Button size="small" variant="ghost" icon={<UserMinus size={16} />} onClick={() => setRemoving(m)}>
                      Убрать
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {members.length === 0 && (
          <EmptyState title={tab === 'students' ? 'В классе пока нет учеников' : 'Учителя не назначены'}>
            {tab === 'students' && 'Добавьте учеников из списка или импортируйте их из CSV с указанием этого класса.'}
          </EmptyState>
        )}
      </section>

      <ClassFormDialog
        open={editing}
        cls={cls}
        onClose={() => setEditing(false)}
        onSaved={(c) => {
          setEditing(false);
          loader.setData(c);
          toast.success('Изменения сохранены');
        }}
      />

      <AddMembersDialog
        open={adding !== null}
        role={adding ?? 'STUDENT'}
        existingIds={existingIds}
        onClose={() => setAdding(null)}
        onAdd={async (ids) => {
          const res = await adminApi.addMembers(cls.id, ids);
          loader.setData(res.class);
          setAdding(null);
          toast.success(`Добавлено: ${ids.length}`);
        }}
      />

      <ConfirmDialog
        open={!!removing}
        title="Убрать из класса?"
        message={
          <>
            <strong>{removing?.fullName}</strong> перестанет состоять в «{cls.name}» и потеряет доступ к доскам, выданным этому классу.
            Учётная запись сохранится.
          </>
        }
        confirmLabel="Убрать"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          run(async () => {
            const res = await adminApi.removeMember(cls.id, removing!.id);
            loader.setData(res.class);
            setRemoving(null);
          })
        }
      />

      <ConfirmDialog
        open={resetting}
        title="Новые временные пароли для класса"
        message="Ученикам будут выданы новые временные пароли, текущие сессии завершатся. Пароли откроются на странице печати."
        confirmLabel="Выдать пароли"
        busy={busy}
        onClose={() => setResetting(false)}
        onConfirm={() =>
          run(async () => {
            const res = await adminApi.resetClassPasswords(cls.id, onlyPending);
            setResetting(false);
            if (res.credentials.length === 0) {
              toast.info('Нет учеников, которым нужно выдать пароль');
              return;
            }
            setCredentials(`Класс ${cls.name}`, res.credentials);
            navigate('/admin/credentials');
          })
        }
      >
        <Checkbox
          label={`Только тем, кто ещё не сменил временный пароль (${pendingCount})`}
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        title="Удалить класс?"
        message="Класс будет удалён вместе со списком участников и доступами досок этому классу. Учётные записи учеников и учителей сохранятся. Вместо удаления можно перенести класс в архив."
        confirmLabel="Удалить класс"
        danger
        busy={busy}
        requireText={cls.name}
        requireTextLabel={`Для подтверждения введите название «${cls.name}»`}
        onClose={() => setDeleting(false)}
        onConfirm={(typed) =>
          run(async () => {
            await adminApi.deleteClass(cls.id, typed);
            toast.success(`Класс «${cls.name}» удалён`);
            navigate('/admin/classes', { replace: true });
          })
        }
      />
    </>
  );
}
