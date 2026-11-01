import { WORK_STATUS_LABELS, type AssignmentWorkStatus, type WorkCounts } from '@doska/shared';
import { Badge } from '../../ui/misc';
import { formatDateTime } from '../../lib/format';

const STATUS_KIND: Record<AssignmentWorkStatus, 'info' | 'warning' | 'accent' | undefined> = {
  NOT_STARTED: undefined,
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  REVIEWED: 'accent',
};

export function WorkStatusBadge({ status, grade }: { status: AssignmentWorkStatus; grade?: string | null }) {
  return (
    <Badge kind={STATUS_KIND[status]}>
      {WORK_STATUS_LABELS[status]}
      {status === 'REVIEWED' && grade ? ` · ${grade}` : ''}
    </Badge>
  );
}

/** «Сдано 3 из 25 · проверено 1». */
export function countsLine(total: number, c: WorkCounts): string {
  return `Сдано ${c.SUBMITTED + c.REVIEWED} из ${total} · проверено ${c.REVIEWED} · в работе ${c.IN_PROGRESS}`;
}

/** Срок сдачи с пометкой «просрочено». */
export function DueLabel({ dueAt, closed }: { dueAt: string | null; closed?: boolean }) {
  if (closed) return <Badge>Приём закрыт</Badge>;
  if (!dueAt) return null;
  const overdue = new Date(dueAt).getTime() < Date.now();
  return <Badge kind={overdue ? 'danger' : undefined}>{overdue ? 'Срок прошёл: ' : 'Срок: '}{formatDateTime(dueAt)}</Badge>;
}
