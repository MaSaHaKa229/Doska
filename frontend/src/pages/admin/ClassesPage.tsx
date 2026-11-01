import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, School, Search } from 'lucide-react';
import { adminApi } from '../../api/admin';
import { useDebounced, useLoader } from '../../lib/hooks';
import { pluralize } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Field';
import { Alert, Badge, EmptyState, PageHeader, Pagination, Spinner } from '../../ui/misc';
import { ClassFormDialog } from './ClassFormDialog';
import { toast } from '../../store/toast';

export function ClassesPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const list = useLoader(
    () => adminApi.listClasses({ search: search || undefined, includeArchived, page, pageSize: 50 }),
    [search, includeArchived, page],
  );

  return (
    <>
      <PageHeader
        title="Классы и группы"
        subtitle={list.data ? `Всего: ${list.data.total}` : undefined}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Новый класс
          </Button>
        }
      />
      <div className="card card__body toolbar" style={{ alignItems: 'center' }}>
        <div className="field field--grow">
          <div className="input-with-icon">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder="Найти класс"
              aria-label="Поиск класса"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <Checkbox
          label="Показывать архивные"
          checked={includeArchived}
          onChange={(e) => {
            setIncludeArchived(e.target.checked);
            setPage(1);
          }}
        />
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Учебный год</th>
                <th>Учеников</th>
                <th>Учителя</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/classes/${c.id}`)}>
                  <td>
                    <Link to={`/admin/classes/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                      {c.name}
                    </Link>{' '}
                    {c.archived && <Badge>архив</Badge>}
                    {c.description && <div className="muted small">{c.description}</div>}
                  </td>
                  <td className="nowrap">{c.academicYear ?? '—'}</td>
                  <td>
                    {c.studentCount} {pluralize(c.studentCount, 'ученик', 'ученика', 'учеников')}
                  </td>
                  <td>{c.teachers.length ? c.teachers.map((t) => t.fullName).join(', ') : <span className="muted">не назначены</span>}</td>
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
        {list.data?.items.length === 0 && (
          <EmptyState icon={<School size={40} />} title="Классов нет">
            Создайте класс вручную или импортируйте учеников из CSV — классы создадутся автоматически.
          </EmptyState>
        )}
        {list.data && list.data.total > list.data.pageSize && (
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        )}
      </section>

      <ClassFormDialog
        open={creating}
        cls={null}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          toast.success(`Класс «${c.name}» создан`);
          navigate(`/admin/classes/${c.id}`);
        }}
      />
    </>
  );
}
