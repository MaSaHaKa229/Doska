import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { AdminUser } from '@doska/shared';
import { adminApi } from '../../api/admin';
import { errorMessage } from '../../api/http';
import { useDebounced } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Field';
import { Alert, Spinner } from '../../ui/misc';

/** Выбор учеников или учителей для добавления в класс. */
export function AddMembersDialog({
  open,
  role,
  existingIds,
  onClose,
  onAdd,
}: {
  open: boolean;
  role: 'STUDENT' | 'TEACHER';
  existingIds: Set<string>;
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<void>;
}) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 250);
  const [onlyWithoutClass, setOnlyWithoutClass] = useState(role === 'STUDENT');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearchInput('');
      setOnlyWithoutClass(role === 'STUDENT');
    }
  }, [open, role]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    adminApi
      .listUsers({ search: search || undefined, role, noClass: onlyWithoutClass, status: 'all', pageSize: 100, sort: 'fullName' }, ctrl.signal)
      .then((r) => {
        setUsers(r.items.filter((u) => !existingIds.has(u.id)));
        setTotal(r.total);
        setError(null);
      })
      .catch((err) => !ctrl.signal.aborted && setError(errorMessage(err)))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [open, search, role, onlyWithoutClass, existingIds]);

  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title={role === 'STUDENT' ? 'Добавить учеников' : 'Назначить учителей'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onAdd([...selected]);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить ({selected.size})
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <div className="input-with-icon">
        <Search size={16} />
        <input className="input" type="search" autoFocus placeholder="ФИО или логин" aria-label="Поиск" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </div>
      <div className="row">
        {role === 'STUDENT' && (
          <Checkbox label="Только без класса" checked={onlyWithoutClass} onChange={(e) => setOnlyWithoutClass(e.target.checked)} />
        )}
        <div className="spacer" />
        <Checkbox
          label="Выбрать всех на экране"
          checked={allSelected}
          onChange={(e) =>
            setSelected((s) => {
              const n = new Set(s);
              for (const u of users) e.target.checked ? n.add(u.id) : n.delete(u.id);
              return n;
            })
          }
        />
      </div>
      <div className="check-list" style={{ maxHeight: 340 }}>
        {loading && <Spinner />}
        {!loading && users.length === 0 && <div className="muted small" style={{ padding: 8 }}>Никого не найдено</div>}
        {users.map((u) => (
          <div key={u.id}>
            <Checkbox
              label={
                <>
                  {u.fullName} <span className="muted small mono">{u.login}</span>
                  {u.classes.length > 0 && <span className="muted small"> · {u.classes.map((c) => c.name).join(', ')}</span>}
                </>
              }
              checked={selected.has(u.id)}
              onChange={(e) =>
                setSelected((s) => {
                  const n = new Set(s);
                  e.target.checked ? n.add(u.id) : n.delete(u.id);
                  return n;
                })
              }
            />
          </div>
        ))}
      </div>
      {total > 100 && <span className="muted small">Показаны первые 100 — уточните поиск.</span>}
    </Dialog>
  );
}
