import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import type { AssignmentSummary } from '@doska/shared';
import { assignmentsApi } from '../../api/assignments';
import { useLoader } from '../../lib/hooks';
import { Button } from '../../ui/Button';
import { Alert, Badge, EmptyState, PageHeader, Spinner } from '../../ui/misc';
import { CreateAssignmentDialog } from './CreateAssignmentDialog';
import { DueLabel, countsLine } from './common';

/** Список заданий учителя (целиком или последние limit). */
export function AssignmentsList({ limit }: { limit?: number }) {
  const list = useLoader(() => assignmentsApi.list().then((r) => r.assignments), []);
  if (!list.data) return list.error ? <Alert kind="error">{list.error}</Alert> : <Spinner />;
  const items: AssignmentSummary[] = limit ? list.data.slice(0, limit) : list.data;
  if (!items.length) {
    return (
      <EmptyState icon={<ClipboardList size={28} />} title="Заданий пока нет">
        Откройте доску урока и выберите «Урок → Раздать как задание» — каждый ученик получит свою копию.
      </EmptyState>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((a) => (
        <Link key={a.id} to={`/assignments/${a.id}`} className="assignment-row" data-testid="assignment-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="assignment-row__title">{a.title}</div>
            <div className="small muted">{countsLine(a.total, a.counts)}</div>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {a.class && <Badge>{a.class.name}</Badge>}
            {a.counts.SUBMITTED > 0 && <Badge kind="warning">Ждут проверки: {a.counts.SUBMITTED}</Badge>}
            <DueLabel dueAt={a.dueAt} closed={!!a.closedAt} />
          </div>
        </Link>
      ))}
      {limit && list.data.length > limit && (
        <Link to="/assignments" className="small">
          Все задания ({list.data.length})
        </Link>
      )}
    </div>
  );
}

/** Страница «Задания» учителя. */
export function AssignmentsPage() {
  const [creating, setCreating] = useState(false);
  return (
    <main className="page">
      <PageHeader
        title="Задания"
        subtitle="Копии доски для каждого ученика, сдача и проверка"
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
            Раздать задание
          </Button>
        }
      />
      <AssignmentsList />
      <CreateAssignmentDialog open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
