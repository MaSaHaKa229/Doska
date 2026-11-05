import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, ChevronLeft, ChevronRight, ClipboardList, Info, Send, Undo2 } from 'lucide-react';
import type { AssignmentWorkView } from '@doska/shared';
import { assignmentsApi } from '../../api/assignments';
import { errorMessage } from '../../api/http';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { DueLabel, WorkStatusBadge } from '../assignments/common';

/**
 * Полоса работы по заданию над холстом.
 * Ученик: задание, срок, статус, «Сдать работу» / «Отменить сдачу».
 * Учитель: ученик, статус, отметка, «Проверено», «Вернуть на доработку»,
 * переход к соседним работам. Пометки учителя пишутся в слой review.
 */
export function WorkBar() {
  const work = useBoard((s) => s.work);
  const caps = useBoard((s) => s.caps);
  const userId = useBoard((s) => s.userId);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [neighbors, setNeighbors] = useState<{ prev: AssignmentWorkView | null; next: AssignmentWorkView | null }>({ prev: null, next: null });
  const teacher = !!caps?.moderate;

  useEffect(() => setGrade(work?.grade ?? ''), [work?.workId, work?.grade]);
  // Соседние работы задания — для перехода «предыдущая / следующая».
  useEffect(() => {
    if (!work || !teacher) return;
    let cancelled = false;
    assignmentsApi
      .get(work.assignmentId)
      .then(({ assignment }) => {
        if (cancelled) return;
        const i = assignment.works.findIndex((w) => w.id === work.workId);
        setNeighbors({ prev: assignment.works[i - 1] ?? null, next: assignment.works[i + 1] ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [work?.assignmentId, work?.workId, teacher]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!work) return null;
  const mine = work.student.id === userId;

  const act = async (fn: () => Promise<unknown>, optimistic?: Partial<typeof work>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (optimistic) {
        const cur = useBoard.getState().work;
        if (cur) useBoard.getState().setWork({ ...cur, ...optimistic });
      }
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="work-bar" data-testid="work-bar">
      <ClipboardList size={16} />
      {teacher ? (
        <>
          <Link to={`/assignments/${work.assignmentId}`} className="work-bar__title">
            {work.assignmentTitle}
          </Link>
          <span>· {work.student.fullName}</span>
        </>
      ) : (
        <span className="work-bar__title">{work.assignmentTitle}</span>
      )}
      <WorkStatusBadge status={work.status} grade={work.grade} />
      <DueLabel dueAt={work.dueAt} closed={work.closed} />
      {work.instructions && (
        <Button size="small" variant="ghost" icon={<Info size={14} />} aria-expanded={showInfo} onClick={() => setShowInfo((v) => !v)}>
          Задание
        </Button>
      )}
      <span className="spacer" />

      {mine && !work.closed && (work.status === 'NOT_STARTED' || work.status === 'IN_PROGRESS') && (
        <Button
          size="small"
          variant="primary"
          icon={<Send size={14} />}
          loading={busy}
          onClick={() => act(() => assignmentsApi.submit(work.workId), { status: 'SUBMITTED', submittedAt: new Date().toISOString() }, 'Работа сдана')}
        >
          Сдать работу
        </Button>
      )}
      {mine && !work.closed && work.status === 'SUBMITTED' && (
        <Button size="small" icon={<Undo2 size={14} />} loading={busy} onClick={() => act(() => assignmentsApi.unsubmit(work.workId), { status: 'IN_PROGRESS', submittedAt: null })}>
          Отменить сдачу
        </Button>
      )}

      {teacher && (
        <>
          <span className="small muted">Пометки — красным, ученик их не изменит.</span>
          <input
            className="input"
            aria-label="Отметка"
            placeholder="Отметка"
            maxLength={20}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
          <Button
            size="small"
            variant="primary"
            icon={<CheckCheck size={14} />}
            loading={busy}
            onClick={() => act(() => assignmentsApi.review(work.workId, grade.trim() || null), { status: 'REVIEWED', grade: grade.trim() || null }, 'Работа отмечена проверенной')}
          >
            Проверено
          </Button>
          {(work.status === 'SUBMITTED' || work.status === 'REVIEWED') && (
            <Button size="small" icon={<Undo2 size={14} />} loading={busy} onClick={() => act(() => assignmentsApi.returnWork(work.workId), { status: 'IN_PROGRESS' }, 'Работа возвращена на доработку')}>
              Вернуть на доработку
            </Button>
          )}
          {neighbors.prev && (
            <Link to={`/boards/${neighbors.prev.boardId}`} className="btn btn--ghost btn--small btn--icon" title={`Предыдущая: ${neighbors.prev.student.fullName}`} aria-label="Предыдущая работа">
              <ChevronLeft size={16} />
            </Link>
          )}
          {neighbors.next && (
            <Link to={`/boards/${neighbors.next.boardId}`} className="btn btn--ghost btn--small btn--icon" title={`Следующая: ${neighbors.next.student.fullName}`} aria-label="Следующая работа">
              <ChevronRight size={16} />
            </Link>
          )}
        </>
      )}
      {showInfo && work.instructions && <div className="assignment-instructions" style={{ flexBasis: '100%', margin: 0 }}>{work.instructions}</div>}
    </div>
  );
}
