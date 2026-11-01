import { useEffect, useMemo, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import type { BoardAccessView, BoardMemberRole, DirectoryUser } from '@doska/shared';
import { boardsApi, type TeacherClass } from '../../api/boards';
import { errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox, SelectField, TextField } from '../../ui/Field';
import { Alert, Spinner } from '../../ui/misc';
import { toast } from '../../store/toast';

const ROLE_LABELS: Record<BoardMemberRole, string> = {
  STUDENT: 'Ученик',
  CO_TEACHER: 'Соведущий',
  VIEWER: 'Только просмотр',
};

/** Кого ищем при добавлении: роль на доске и роль пользователя. */
const ADD_KINDS: { role: BoardMemberRole; userRole: 'STUDENT' | 'TEACHER'; label: string }[] = [
  { role: 'STUDENT', userRole: 'STUDENT', label: 'Ученика' },
  { role: 'CO_TEACHER', userRole: 'TEACHER', label: 'Соведущего учителя' },
  { role: 'VIEWER', userRole: 'TEACHER', label: 'Учителя для просмотра' },
];

interface Member {
  userId: string;
  fullName: string;
  login: string;
  role: BoardMemberRole;
}

/**
 * Доступ к доске: классы (только свои действующие; уже выданные можно
 * оставить или снять), отдельные ученики (любые), соведущие и учителя
 * «только просмотр». Сохраняется целиком (PUT /api/boards/:id/access);
 * сервер сразу пересчитывает права подключённых и снимает мел у
 * потерявших доступ.
 */
export function AccessDialog({ boardId, title, open, onClose, onSaved }: { boardId: string; title: string; open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [granted, setGranted] = useState<BoardAccessView['classes']>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [addKind, setAddKind] = useState(0);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [found, setFound] = useState<DirectoryUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSearch('');
    Promise.all([boardsApi.get(boardId), boardsApi.myClasses()])
      .then(([{ board }, { classes }]) => {
        const access = board.access ?? { classes: [], members: [] };
        setMyClasses(classes);
        setGranted(access.classes);
        setClassIds(access.classes.map((c) => c.id));
        setMembers(access.members);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [open, boardId]);

  const kind = ADD_KINDS[addKind]!;
  // Поиск с задержкой: запрос уходит, когда пользователь перестал печатать.
  useEffect(() => {
    if (!open || loading) return;
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      boardsApi
        .directory(
          { role: kind.userRole, search: search.trim() || undefined, classId: kind.userRole === 'STUDENT' && classFilter ? classFilter : undefined, limit: 30 },
          ctrl.signal,
        )
        .then((r) => setFound(r.users))
        .catch((err) => {
          if (!(err instanceof Error && err.name === 'AbortError')) setError(errorMessage(err));
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, loading, search, classFilter, kind.userRole]);

  // Классы: свои + уже выданные (например, соведущим).
  const classOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; academicYear: string | null; studentCount?: number; mine: boolean }>();
    for (const c of granted) map.set(c.id, { ...c, mine: false });
    for (const c of myClasses) map.set(c.id, { ...c, mine: true });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [granted, myClasses]);

  const memberIds = new Set(members.map((m) => m.userId));
  const add = (u: DirectoryUser) => setMembers((list) => [...list, { userId: u.id, fullName: u.fullName, login: u.login, role: kind.role }]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await boardsApi.setAccess(boardId, { classIds, members: members.map((m) => ({ userId: m.userId, role: m.role })) });
      toast.success('Доступ к доске сохранён');
      onSaved?.();
      onClose();
    } catch (err) {
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
      title={`Доступ к доске «${title}»`}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={loading}>
            Сохранить
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="field">
            <span className="field__label">Классы</span>
            <div className="check-list">
              {classOptions.length === 0 && (
                <div className="muted small" style={{ padding: 8 }}>
                  Вы не назначены учителем ни одного класса. Отдельных учеников можно добавить ниже.
                </div>
              )}
              {classOptions.map((c) => (
                <div key={c.id}>
                  <Checkbox
                    label={
                      <>
                        {c.name}{' '}
                        <span className="muted small">
                          {c.academicYear ?? ''}
                          {c.studentCount !== undefined ? ` · учеников: ${c.studentCount}` : ''}
                          {!c.mine ? ' · выдан другим учителем' : ''}
                        </span>
                      </>
                    }
                    checked={classIds.includes(c.id)}
                    // Чужой класс можно только снять (выдать заново — нельзя).
                    disabled={!c.mine && !classIds.includes(c.id)}
                    onChange={(e) => setClassIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Отдельные участники ({members.length})</span>
            <div className="access-list" data-testid="access-members">
              {members.length === 0 && <div className="muted small">Пока никого — только классы.</div>}
              {members.map((m) => (
                <div key={m.userId} className="access-row">
                  <span className="access-row__name">
                    {m.fullName} <span className="muted small">{m.login}</span>
                  </span>
                  {m.role === 'STUDENT' ? (
                    <span className="small muted">{ROLE_LABELS.STUDENT}</span>
                  ) : (
                    <select
                      className="select"
                      style={{ width: 'auto' }}
                      aria-label={`Роль: ${m.fullName}`}
                      value={m.role}
                      onChange={(e) => setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as BoardMemberRole } : x)))}
                    >
                      <option value="CO_TEACHER">{ROLE_LABELS.CO_TEACHER}</option>
                      <option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
                    </select>
                  )}
                  <Button
                    size="small"
                    variant="ghost"
                    iconOnly
                    icon={<Trash2 size={16} />}
                    aria-label={`Убрать: ${m.fullName}`}
                    title="Убрать доступ"
                    onClick={() => setMembers((list) => list.filter((x) => x.userId !== m.userId))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Добавить</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <SelectField label="Кого" value={String(addKind)} onChange={(e) => setAddKind(Number(e.target.value))} fieldClassName="access-filter">
                {ADD_KINDS.map((k, i) => (
                  <option key={k.role} value={i}>
                    {k.label}
                  </option>
                ))}
              </SelectField>
              {kind.userRole === 'STUDENT' && myClasses.length > 0 && (
                <SelectField label="Из класса" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} fieldClassName="access-filter">
                  <option value="">любого</option>
                  {myClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
            <TextField label="Поиск по ФИО или логину" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Например, Иванов" />
            <div className="access-list" aria-busy={searching} data-testid="access-found">
              {!searching && found.length === 0 && <div className="muted small">Никого не найдено</div>}
              {found.map((u) => (
                <div key={u.id} className="access-row">
                  <span className="access-row__name">
                    {u.fullName}{' '}
                    <span className="muted small">
                      {u.login}
                      {u.classes.length ? ` · ${u.classes.join(', ')}` : ''}
                    </span>
                  </span>
                  <Button
                    size="small"
                    icon={<UserPlus size={16} />}
                    disabled={memberIds.has(u.id)}
                    aria-label={`Добавить: ${u.fullName}`}
                    onClick={() => add(u)}
                  >
                    {memberIds.has(u.id) ? 'Добавлен' : 'Добавить'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
