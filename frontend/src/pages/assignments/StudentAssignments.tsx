import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import type { StudentAssignment } from '@doska/shared';
import { assignmentsApi } from '../../api/assignments';
import { useLoader } from '../../lib/hooks';
import { Alert, Badge, Spinner } from '../../ui/misc';
import { DueLabel, WorkStatusBadge } from './common';

/** Порядок на главной ученика: сначала то, что нужно сделать. */
const ORDER: Record<StudentAssignment['work']['status'], number> = { NOT_STARTED: 0, IN_PROGRESS: 1, SUBMITTED: 2, REVIEWED: 3 };

/** Задания ученика: статус, срок, отметка; открыть свою работу. */
export function StudentAssignments() {
  const list = useLoader(() => assignmentsApi.mine().then((r) => r.assignments), []);
  if (!list.data) return list.error ? <Alert kind="error">{list.error}</Alert> : <Spinner />;
  if (!list.data.length) return <div className="muted small">Заданий пока нет.</div>;
  const items = [...list.data].sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      ORDER[a.work.status] - ORDER[b.work.status] ||
      (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((a) => (
        <Link key={a.work.id} to={`/boards/${a.work.boardId}`} className="assignment-row" data-testid="student-assignment">
          <ClipboardList size={18} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="assignment-row__title">{a.title}</div>
            <div className="small muted">
              {a.teacher.fullName}
              {a.instructions ? ` · ${a.instructions.slice(0, 120)}` : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <WorkStatusBadge status={a.work.status} grade={a.work.grade} />
            {a.work.status !== 'REVIEWED' && a.work.status !== 'SUBMITTED' && <DueLabel dueAt={a.dueAt} closed={a.closed} />}
            {a.closed && a.work.status === 'REVIEWED' && <Badge>Закрыто</Badge>}
          </div>
        </Link>
      ))}
    </div>
  );
}
