import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, LayoutGrid, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { TEMPLATE_LEVELS, TEMPLATE_LEVEL_LABELS, TEMPLATE_VISIBILITY_LABELS, sectionTitle, type TemplateLevel, type TemplateScope, type TemplateSummary } from '@doska/shared';
import { templatesApi } from '../../api/templates';
import { errorMessage } from '../../api/http';
import { useDebounced, useLoader } from '../../lib/hooks';
import { pluralize } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { ActionMenu } from '../../ui/Menu';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Alert, Badge, EmptyState, PageHeader, Pagination, Spinner } from '../../ui/misc';
import { BoardSnapshotThumb } from '../../ui/Thumbs';
import { CreateAssignmentDialog } from '../assignments/CreateAssignmentDialog';
import { SectionOptions, TemplateDialog } from './TemplateDialog';

const PAGE_SIZE = 24;
const SCOPES: { value: TemplateScope; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'builtin', label: 'Встроенные' },
  { value: 'mine', label: 'Мои' },
  { value: 'shared', label: 'От коллег' },
];

/**
 * Библиотека шаблонов (учитель): встроенные доски-задачи, свои шаблоны и
 * шаблоны коллег. Из шаблона — новая доска урока или задание классу.
 */
export function LibraryPage() {
  const user = useAuth((s) => s.user)!;
  const isTeacher = user.role === 'TEACHER';
  const navigate = useNavigate();
  const [scope, setScope] = useState<TemplateScope>('all');
  const [section, setSection] = useState('');
  const [level, setLevel] = useState<TemplateLevel | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [page, setPage] = useState(1);
  const list = useLoader(
    (signal) => templatesApi.list({ scope, section: section || undefined, level: level || undefined, search: search || undefined, page, pageSize: PAGE_SIZE }, signal),
    [scope, section, level, search, page],
  );
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [assigning, setAssigning] = useState<TemplateSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const use = async (t: TemplateSummary) => {
    setBusy(t.id);
    try {
      const { boardId } = await templatesApi.use(t.id);
      toast.success(`Создана доска «${t.title}»`);
      navigate(`/boards/${boardId}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await templatesApi.delete(deleting.id);
      toast.success('Шаблон удалён');
      setDeleting(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <main className="page">
      <PageHeader title="Библиотека шаблонов" subtitle="Готовые доски-задачи по разделам: создайте из шаблона доску урока или выдайте заданием. Свою доску можно сохранить в библиотеку из меню доски." />
      <section className="card">
        <div className="card__header" style={{ flexWrap: 'wrap' }}>
          <BookOpen size={18} />
          <div className="tabs" role="tablist" style={{ flex: 1 }}>
            {SCOPES.map((s) => (
              <button key={s.value} type="button" role="tab" className="tab" aria-selected={scope === s.value} onClick={() => reset(() => setScope(s.value))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="library-filters">
          <div className="input-with-icon" style={{ minWidth: 200, flex: '1 1 260px' }}>
            <Search size={16} />
            <input className="input" type="search" placeholder="Найти шаблон" aria-label="Поиск шаблонов" value={searchInput} onChange={(e) => reset(() => setSearchInput(e.target.value))} />
          </div>
          <select className="select" aria-label="Раздел" value={section} onChange={(e) => reset(() => setSection(e.target.value))}>
            <option value="">Все разделы</option>
            <SectionOptions />
          </select>
          <select className="select" aria-label="Уровень" value={level} onChange={(e) => reset(() => setLevel(e.target.value as TemplateLevel | ''))}>
            <option value="">Любой уровень</option>
            {TEMPLATE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {TEMPLATE_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        {list.error && (
          <div className="card__body">
            <Alert kind="error">{list.error}</Alert>
          </div>
        )}
        {list.loading && !list.data && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {list.data && list.data.items.length === 0 && (
          <EmptyState icon={<BookOpen size={40} />} title={search || section || level ? 'Ничего не найдено' : scope === 'mine' ? 'Своих шаблонов пока нет' : 'Шаблонов пока нет'}>
            {scope === 'mine' ? 'Откройте меню доски в списке досок и выберите «Сохранить как шаблон».' : 'Попробуйте другой раздел или уровень.'}
          </EmptyState>
        )}
        <div className="board-grid" style={{ padding: '0 16px 16px' }}>
          {list.data?.items.map((t) => (
            <article key={t.id} className="board-card" aria-label={`Шаблон ${t.title}`}>
              <Link to={`/boards/${t.boardId}`} className="board-card__thumb" aria-hidden tabIndex={-1}>
                <BoardSnapshotThumb boardId={t.boardId} version={t.boardActivityAt} width={320} height={140} placeholder={<LayoutGrid size={28} />} />
              </Link>
              <div className="board-card__body">
                <h3 className="board-card__title" title={t.title}>
                  {t.title}
                </h3>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <Badge kind="accent">{sectionTitle(t.section)}</Badge>
                  <Badge>{TEMPLATE_LEVEL_LABELS[t.level]}</Badge>
                  {(t.visibility === 'BUILTIN' || t.mine) && <Badge kind={t.visibility === 'BUILTIN' ? 'info' : undefined}>{TEMPLATE_VISIBILITY_LABELS[t.visibility]}</Badge>}
                </div>
                {t.description && <div className="small board-card__desc">{t.description}</div>}
                <div className="muted small">
                  {t.visibility === 'BUILTIN' ? 'Встроенный' : t.mine ? 'Мой шаблон' : t.author?.fullName ?? '—'}
                  {t.usageCount > 0 && <> · использован {t.usageCount} {pluralize(t.usageCount, 'раз', 'раза', 'раз')}</>}
                  {t.tags.length > 0 && <> · {t.tags.join(', ')}</>}
                </div>
              </div>
              <div className="board-card__actions">
                {isTeacher && (
                  <Button size="small" variant="primary" icon={<Plus size={14} />} loading={busy === t.id} onClick={() => void use(t)}>
                    Создать доску
                  </Button>
                )}
                <Link to={`/boards/${t.boardId}`} className="btn btn--small">
                  {t.mine ? 'Изменить доску' : 'Открыть'}
                </Link>
                {isTeacher && (
                  <ActionMenu
                    label={`Действия с шаблоном ${t.title}`}
                    items={[
                      { label: 'Выдать заданием…', icon: <ClipboardList size={16} />, onSelect: () => setAssigning(t) },
                      { label: 'Описание и доступ…', icon: <Pencil size={16} />, hidden: !t.mine, onSelect: () => setEditing(t) },
                      { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, hidden: !t.mine, onSelect: () => setDeleting(t) },
                    ]}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
        {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </section>
      <TemplateDialog open={!!editing} template={editing} onClose={() => setEditing(null)} onSaved={() => list.reload()} />
      <CreateAssignmentDialog open={!!assigning} board={assigning ? { id: assigning.boardId, title: assigning.title } : null} onClose={() => setAssigning(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Удалить шаблон?"
        confirmLabel="Удалить"
        danger
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
        message={<>Шаблон «{deleting?.title}» исчезнет из библиотеки. Доски, уже созданные из него, и выданные задания останутся.</>}
      />
    </main>
  );
}
