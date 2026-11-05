import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, UserPlus } from 'lucide-react';
import type { BoardSummary, DirectoryUser } from '@doska/shared';
import { boardsApi, type TeacherClass } from '../../api/boards';
import { assignmentsApi } from '../../api/assignments';
import { ApiError, errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { toast } from '../../store/toast';

/** Значение для <input type="datetime-local"> из ISO и обратно (местное время). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Раздать задание: каждый ученик класса (и выбранные ученики) получает
 * свою копию доски в её текущем виде. Если доска не задана, её выбирают
 * из своих досок уроков.
 */
export function CreateAssignmentDialog({ open, board, onClose }: { open: boolean; board?: { id: string; title: string } | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [boardId, setBoardId] = useState('');
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState<DirectoryUser[]>([]);
  const [due, setDue] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<DirectoryUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setTitle(board?.title ?? '');
    setInstructions('');
    setBoardId(board?.id ?? '');
    setStudents([]);
    setDue('');
    setSearch('');
    setError(null);
    setErrors({});
    boardsApi
      .myClasses()
      .then((r) => {
        setClasses(r.classes);
        setClassId(r.classes.length === 1 ? r.classes[0]!.id : '');
      })
      .catch((err) => setError(errorMessage(err)));
    if (!board) {
      boardsApi
        .list({ scope: 'own', pageSize: 100, sort: 'lastActivityAt', order: 'desc' })
        .then((r) => setBoards(r.items.filter((b) => b.kind === 'LESSON' || b.kind === 'TEMPLATE')))
        .catch((err) => setError(errorMessage(err)));
    }
    // Поля заполняются заново только при открытии диалога.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board?.id]);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setFound([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      boardsApi
        .directory({ role: 'STUDENT', search: search.trim(), limit: 10 }, ctrl.signal)
        .then((r) => setFound(r.users))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, search]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const { assignment } = await assignmentsApi.create({
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        templateBoardId: boardId,
        classId: classId || null,
        studentIds: students.map((s) => s.id),
        dueAt: fromLocalInput(due),
      });
      toast.success(`Задание выдано: ${assignment.total} ${assignment.total === 1 ? 'ученику' : 'ученикам'}`);
      onClose();
      navigate(`/assignments/${assignment.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === 'object') setErrors(err.details as Record<string, string[]>);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title="Раздать задание"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !boardId || (!classId && students.length === 0)}>
            Раздать
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p className="small muted" style={{ margin: 0 }}>
        Каждый ученик получит свою копию доски в её текущем виде и будет решать в ней. Объекты, которые нельзя трогать, заранее заблокируйте.
      </p>
      {!board && (
        <SelectField label="Доска" value={boardId} onChange={(e) => {
          setBoardId(e.target.value);
          const b = boards.find((x) => x.id === e.target.value);
          if (b && !title.trim()) setTitle(b.title);
        }} errors={errors.templateBoardId}>
          <option value="">— выберите доску —</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </SelectField>
      )}
      <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} errors={errors.title} required />
      <TextAreaField label="Что сделать (видят ученики)" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} errors={errors.instructions} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <SelectField label="Класс" value={classId} onChange={(e) => setClassId(e.target.value)} fieldClassName="access-filter" errors={errors.classId}>
          <option value="">— без класса —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (учеников: {c.studentCount})
            </option>
          ))}
        </SelectField>
        <TextField label="Срок сдачи" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} fieldClassName="access-filter" errors={errors.dueAt} />
      </div>
      <div className="field">
        <span className="field__label">Ещё ученики ({students.length})</span>
        {students.map((s) => (
          <div key={s.id} className="access-row">
            <span className="access-row__name">
              {s.fullName} <span className="muted small">{s.classes.join(', ')}</span>
            </span>
            <Button size="small" variant="ghost" iconOnly icon={<Trash2 size={16} />} aria-label={`Убрать: ${s.fullName}`} onClick={() => setStudents((l) => l.filter((x) => x.id !== s.id))} />
          </div>
        ))}
        <TextField label="Найти ученика" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ФИО или логин, от 2 букв" />
        {found
          .filter((u) => !students.some((s) => s.id === u.id))
          .map((u) => (
            <div key={u.id} className="access-row">
              <span className="access-row__name">
                {u.fullName} <span className="muted small">{u.classes.join(', ')}</span>
              </span>
              <Button size="small" icon={<UserPlus size={16} />} onClick={() => setStudents((l) => [...l, u])} aria-label={`Добавить: ${u.fullName}`}>
                Добавить
              </Button>
            </div>
          ))}
      </div>
    </Dialog>
  );
}
