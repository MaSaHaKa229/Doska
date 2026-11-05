import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, LockOpen, Pencil, Trash2, UserPlus } from 'lucide-react';
import { ASSIGNMENT_WORK_STATUSES, WORK_STATUS_LABELS, type AssignmentWorkStatus } from '@doska/shared';
import { assignmentsApi } from '../../api/assignments';
import { errorMessage } from '../../api/http';
import { useLoader } from '../../lib/hooks';
import { formatRelative } from '../../lib/format';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Dialog } from '../../ui/Dialog';
import { TextAreaField, TextField } from '../../ui/Field';
import { Alert, Badge, EmptyState, PageHeader, Spinner } from '../../ui/misc';
import { BoardLiveThumb } from '../../ui/Thumbs';
import { DueLabel, WorkStatusBadge, countsLine } from './common';
import { fromLocalInput, toLocalInput } from './CreateAssignmentDialog';

/** Статусы обновляются опросом; сами миниатюры — по облегчённым подпискам. */
const POLL_MS = 10_000;

/**
 * Задание учителя: сетка работ учеников с живыми миниатюрами (облегчённые
 * подписки только для карточек на экране), фильтр по статусу, закрытие
 * приёма, выдача новым ученикам класса.
 */
export function AssignmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const details = useLoader(() => assignmentsApi.get(id).then((r) => r.assignment), [id]);
  const [filter, setFilter] = useState<AssignmentWorkStatus | 'ALL'>('ALL');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && details.reload(), POLL_MS);
    return () => clearInterval(t);
  }, [details]);

  const a = details.data;
  if (!a) {
    return <main className="page">{details.error ? <Alert kind="error">{details.error}</Alert> : <Spinner />}</main>;
  }
  const works = filter === 'ALL' ? a.works : a.works.filter((w) => w.status === filter);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      details.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <Link to="/assignments" className="small row" style={{ gap: 4 }}>
        <ArrowLeft size={14} /> Все задания
      </Link>
      <PageHeader
        title={a.title}
        subtitle={
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {a.class && <Badge>{a.class.name}</Badge>}
            <DueLabel dueAt={a.dueAt} closed={!!a.closedAt} />
            <span>{countsLine(a.total, a.counts)}</span>
          </span>
        }
        actions={
          <>
            <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Изменить
            </Button>
            <Button
              icon={a.closedAt ? <LockOpen size={16} /> : <Lock size={16} />}
              loading={busy}
              onClick={() => run(() => assignmentsApi.update(a.id, { closed: !a.closedAt }), a.closedAt ? 'Приём работ снова открыт' : 'Приём работ закрыт')}
            >
              {a.closedAt ? 'Открыть приём' : 'Закрыть приём'}
            </Button>
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setDeleting(true)}>
              Удалить
            </Button>
          </>
        }
      />
      {a.instructions && <p className="assignment-instructions">{a.instructions}</p>}
      {a.missingClassStudents > 0 && (
        <Alert kind="info">
          В классе {a.class?.name} есть ученики без этого задания: {a.missingClassStudents}.{' '}
          <Button size="small" icon={<UserPlus size={16} />} loading={busy} onClick={() => run(() => assignmentsApi.addStudents(a.id, { fromClass: true }), 'Задание выдано новым ученикам')}>
            Выдать им
          </Button>
        </Alert>
      )}

      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {(['ALL', ...ASSIGNMENT_WORK_STATUSES] as const).map((s) => (
          <button key={s} type="button" role="tab" className="tab" aria-selected={filter === s} onClick={() => setFilter(s)}>
            {s === 'ALL' ? `Все (${a.total})` : `${WORK_STATUS_LABELS[s]} (${a.counts[s]})`}
          </button>
        ))}
      </div>

      {works.length === 0 ? (
        <EmptyState title="Нет работ с таким статусом" />
      ) : (
        <div className="works-grid" data-testid="works-grid">
          {works.map((w) => (
            <Link key={w.id} to={`/boards/${w.boardId}`} className="work-card" data-testid="work-card">
              <div className="work-card__thumb">
                <BoardLiveThumb boardId={w.boardId} width={320} height={200} />
              </div>
              <div className="work-card__body">
                <span className="work-card__name" title={w.student.fullName}>
                  {w.student.fullName}
                </span>
                <WorkStatusBadge status={w.status} grade={w.grade} />
              </div>
              <div className="small muted" style={{ padding: '0 10px 8px' }}>
                {w.submittedAt ? `Сдана ${formatRelative(w.submittedAt)}` : `Изменена ${formatRelative(w.lastActivityAt)}`}
              </div>
            </Link>
          ))}
        </div>
      )}

      <EditAssignmentDialog
        open={editing}
        initial={{ title: a.title, instructions: a.instructions ?? '', due: toLocalInput(a.dueAt) }}
        onClose={() => setEditing(false)}
        onSave={async (v) => {
          await assignmentsApi.update(a.id, { title: v.title, instructions: v.instructions || null, dueAt: fromLocalInput(v.due) });
          setEditing(false);
          details.reload();
        }}
      />
      <ConfirmDialog
        open={deleting}
        title="Удалить задание?"
        danger
        confirmLabel="Удалить"
        requireText={a.title}
        requireTextLabel="Для подтверждения введите название задания"
        busy={busy}
        message={`Работы всех учеников (${a.total}) будут удалены вместе с заданием. Это нельзя отменить.`}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          void run(async () => {
            await assignmentsApi.delete(a.id);
            navigate('/assignments');
          }, 'Задание удалено')
        }
      />
    </main>
  );
}

function EditAssignmentDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: { title: string; instructions: string; due: string };
  onClose: () => void;
  onSave: (v: { title: string; instructions: string; due: string }) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setV(initial);
      setError(null);
    }
    // Начальные значения берутся при открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Изменить задание"
      onSubmit={async () => {
        setBusy(true);
        try {
          await onSave(v);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!v.title.trim()}>
            Сохранить
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <TextField label="Название" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <TextAreaField label="Что сделать" rows={3} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} />
      <TextField label="Срок сдачи" type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />
    </Dialog>
  );
}
