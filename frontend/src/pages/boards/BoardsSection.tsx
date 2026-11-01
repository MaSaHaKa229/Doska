import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Folder,
  FolderInput,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  KeyRound,
  ClipboardList,
  Eye,
  EyeOff,
} from 'lucide-react';
import { BOARD_MODE_LABELS, type BoardSummary, type FolderView, type Me } from '@doska/shared';
import { boardsApi } from '../../api/boards';
import { errorMessage } from '../../api/http';
import { useDebounced, useLoader } from '../../lib/hooks';
import { formatRelative, pluralize } from '../../lib/format';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { ActionMenu } from '../../ui/Menu';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Alert, Badge, EmptyState, Pagination, Spinner } from '../../ui/misc';
import { CreateBoardDialog, FolderDialog, MoveBoardDialog, RenameBoardDialog } from './BoardDialogs';
import { descendantsOf, flattenFolders } from './folderTree';
import { AccessDialog } from './AccessDialog';
import { CreateAssignmentDialog } from '../assignments/CreateAssignmentDialog';
import { BoardSnapshotThumb } from '../../ui/Thumbs';

const PAGE_SIZE = 24;

/**
 * Список досок на главной странице.
 *  - Учитель: свои доски с папками, поиском и созданием.
 *  - Ученик: доски, открытые учителем, и личные конспекты.
 * Карточка открывает доску (/boards/:id).
 */
export function BoardsSection({ user }: { user: Me }) {
  const isTeacher = user.role === 'TEACHER';
  const [scope, setScope] = useState<'own' | 'shared'>(isTeacher ? 'own' : 'shared');
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [page, setPage] = useState(1);

  const [folders, setFolders] = useState<FolderView[]>([]);
  const loadFolders = () =>
    boardsApi
      .folders()
      .then((r) => setFolders(r.folders))
      .catch((err) => toast.error(errorMessage(err)));
  useEffect(() => {
    void loadFolders();
  }, []);

  const list = useLoader(
    (signal) =>
      boardsApi.list(
        { scope, folderId: scope === 'own' ? folderId : undefined, search: search || undefined, page, pageSize: PAGE_SIZE },
        signal,
      ),
    [scope, folderId, search, page],
  );

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<BoardSummary | null>(null);
  const [moving, setMoving] = useState<BoardSummary | null>(null);
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const [accessFor, setAccessFor] = useState<BoardSummary | null>(null);
  const [assignFrom, setAssignFrom] = useState<BoardSummary | null>(null);
  /** Конспект ученика: открыть или скрыть от учителей его классов. */
  const toggleShared = async (b: BoardSummary) => {
    try {
      await boardsApi.update(b.id, { sharedWithTeachers: !b.sharedWithTeachers });
      toast.success(b.sharedWithTeachers ? 'Конспект скрыт от учителей' : 'Учителя ваших классов теперь видят этот конспект');
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const [folderDialog, setFolderDialog] = useState<{ folder: FolderView | null; parentId: string | null } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderView | null>(null);
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => flattenFolders(folders), [folders]);
  const currentFolder = folders.find((f) => f.id === folderId);
  const reloadAll = () => {
    list.reload();
    void loadFolders();
  };

  const scopeTabs = (
    <div className="tabs" role="tablist" style={{ padding: '0 12px' }}>
      <button type="button" role="tab" className="tab" aria-selected={scope === 'own'} onClick={() => { setScope('own'); setPage(1); }}>
        {isTeacher ? 'Мои доски' : 'Мои конспекты'}
      </button>
      <button type="button" role="tab" className="tab" aria-selected={scope === 'shared'} onClick={() => { setScope('shared'); setPage(1); }}>
        {isTeacher ? 'Открытые мне' : 'Доски от учителей'}
      </button>
    </div>
  );

  return (
    <section className="card">
      <div className="card__header" style={{ flexWrap: 'wrap' }}>
        <LayoutGrid size={18} />
        <h2 style={{ flex: 1 }}>{isTeacher ? 'Доски' : 'Доски и конспекты'}</h2>
        <div className="input-with-icon" style={{ minWidth: 200, flex: '0 1 280px' }}>
          <Search size={16} />
          <input
            className="input"
            type="search"
            placeholder="Найти доску"
            aria-label="Поиск досок"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {scope === 'own' && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            {isTeacher ? 'Новая доска' : 'Новый конспект'}
          </Button>
        )}
      </div>
      {scopeTabs}

      <div className={scope === 'own' ? 'boards-layout' : undefined}>
        {scope === 'own' && (
          <nav className="folders" aria-label="Папки">
            <button type="button" className={`folder-link ${folderId === undefined ? 'active' : ''}`} onClick={() => { setFolderId(undefined); setPage(1); }}>
              <LayoutGrid size={16} /> Все
            </button>
            <button type="button" className={`folder-link ${folderId === 'root' ? 'active' : ''}`} onClick={() => { setFolderId('root'); setPage(1); }}>
              <Inbox size={16} /> Без папки
            </button>
            {tree.map((f) => (
              <div key={f.id} className="row" style={{ flexWrap: 'nowrap', gap: 0, paddingLeft: f.depth * 14 }}>
                <button
                  type="button"
                  className={`folder-link ${folderId === f.id ? 'active' : ''}`}
                  style={{ flex: 1, minWidth: 0 }}
                  onClick={() => {
                    setFolderId(f.id);
                    setPage(1);
                  }}
                >
                  <Folder size={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span className="muted small">{f.boardCount || ''}</span>
                </button>
                <ActionMenu
                  label={`Действия с папкой ${f.name}`}
                  items={[
                    { label: 'Вложенная папка', icon: <FolderPlus size={16} />, onSelect: () => setFolderDialog({ folder: null, parentId: f.id }) },
                    { label: 'Переименовать или переместить', icon: <Pencil size={16} />, onSelect: () => setFolderDialog({ folder: f, parentId: f.parentId }) },
                    { label: 'Удалить папку', icon: <Trash2 size={16} />, danger: true, onSelect: () => setDeletingFolder(f) },
                  ]}
                />
              </div>
            ))}
            <Button size="small" variant="ghost" icon={<FolderPlus size={16} />} onClick={() => setFolderDialog({ folder: null, parentId: null })}>
              Новая папка
            </Button>
          </nav>
        )}

        <div style={{ minWidth: 0 }}>
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
            <EmptyState icon={<LayoutGrid size={40} />} title={search ? 'Ничего не найдено' : 'Досок пока нет'}>
              {scope === 'own'
                ? isTeacher
                  ? 'Создайте доску для урока — её можно сразу открыть классу.'
                  : 'Создайте личный конспект — его видите только вы.'
                : isTeacher
                  ? 'Здесь появятся доски коллег, где вы соведущий, и открытые вам конспекты учеников.'
                  : 'Когда учитель откроет доску вашему классу, она появится здесь.'}
            </EmptyState>
          )}
          <div className="board-grid">
            {list.data?.items.map((b) => (
              <article key={b.id} className="board-card">
                <Link to={`/boards/${b.id}`} className="board-card__thumb" aria-hidden tabIndex={-1}>
                  <BoardSnapshotThumb boardId={b.id} version={b.lastActivityAt} width={320} height={140} placeholder={<LayoutGrid size={28} />} />
                </Link>
                <div className="board-card__body">
                  <h3 className="board-card__title" title={b.title}>
                    {b.title}
                  </h3>
                  <div className="row" style={{ gap: 4 }}>
                    {b.kind === 'LESSON' && <Badge kind="accent">{BOARD_MODE_LABELS[b.mode]}</Badge>}
                    {b.kind === 'NOTEBOOK' && <Badge>{b.sharedWithTeachers ? 'Конспект · виден учителям' : 'Конспект'}</Badge>}
                    {b.classes.map((c) => (
                      <Badge key={c.id}>{c.name}</Badge>
                    ))}
                    {b.studentCount > 0 && (
                      <Badge>
                        <Users size={12} /> {b.studentCount}
                      </Badge>
                    )}
                  </div>
                  <div className="muted small">
                    {b.role !== 'owner' && <>{b.owner.fullName} · </>}
                    {b.pageCount} {pluralize(b.pageCount, 'страница', 'страницы', 'страниц')} · изменена {formatRelative(b.lastActivityAt)}
                  </div>
                </div>
                <div className="board-card__actions">
                  <Link to={`/boards/${b.id}`} className="btn btn--small btn--primary">
                    Открыть
                  </Link>
                  {(b.role === 'owner' || b.role === 'teacher') && (
                    <ActionMenu
                      label={`Действия с доской ${b.title}`}
                      items={[
                        {
                          label: 'Доступ…',
                          icon: <KeyRound size={16} />,
                          hidden: b.kind !== 'LESSON' && b.kind !== 'TEMPLATE',
                          onSelect: () => setAccessFor(b),
                        },
                        {
                          label: 'Раздать как задание…',
                          icon: <ClipboardList size={16} />,
                          hidden: !isTeacher || (b.kind !== 'LESSON' && b.kind !== 'TEMPLATE'),
                          onSelect: () => setAssignFrom(b),
                        },
                        {
                          label: b.sharedWithTeachers ? 'Скрыть от учителей' : 'Открыть учителям',
                          icon: b.sharedWithTeachers ? <EyeOff size={16} /> : <Eye size={16} />,
                          hidden: b.kind !== 'NOTEBOOK' || b.role !== 'owner',
                          onSelect: () => void toggleShared(b),
                        },
                        { label: 'Переименовать', icon: <Pencil size={16} />, hidden: b.role !== 'owner', onSelect: () => setRenaming(b) },
                        { label: 'Переместить в папку', icon: <FolderInput size={16} />, hidden: b.role !== 'owner', onSelect: () => setMoving(b) },
                        { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, hidden: b.role !== 'owner', onSelect: () => setDeleting(b) },
                      ]}
                    />
                  )}
                </div>
              </article>
            ))}
          </div>
          {list.data && list.data.total > PAGE_SIZE && (
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          )}
        </div>
      </div>

      <CreateBoardDialog
        open={creating}
        isTeacher={isTeacher}
        folders={folders}
        defaultFolderId={folderId && folderId !== 'root' ? folderId : null}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast.success(isTeacher ? 'Доска создана' : 'Конспект создан');
          reloadAll();
        }}
      />
      <CreateAssignmentDialog open={!!assignFrom} board={assignFrom} onClose={() => setAssignFrom(null)} />
      {accessFor && (
        <AccessDialog boardId={accessFor.id} title={accessFor.title} open onClose={() => setAccessFor(null)} onSaved={() => list.reload()} />
      )}
      <RenameBoardDialog
        board={renaming}
        onClose={() => setRenaming(null)}
        onSaved={() => {
          setRenaming(null);
          list.reload();
        }}
      />
      <MoveBoardDialog
        board={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onSaved={() => {
          setMoving(null);
          reloadAll();
        }}
      />
      <FolderDialog
        open={!!folderDialog}
        folder={folderDialog?.folder ?? null}
        parentId={folderDialog?.parentId ?? null}
        folders={folders}
        exclude={folderDialog?.folder ? descendantsOf(folders, folderDialog.folder.id) : undefined}
        onClose={() => setFolderDialog(null)}
        onSaved={() => {
          setFolderDialog(null);
          void loadFolders();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Удалить доску?"
        message={
          <>
            Доска <strong>«{deleting?.title}»</strong> будет удалена для всех участников.
          </>
        }
        confirmLabel="Удалить"
        danger
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await boardsApi.delete(deleting!.id);
            toast.success('Доска удалена');
            setDeleting(null);
            reloadAll();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ConfirmDialog
        open={!!deletingFolder}
        title="Удалить папку?"
        message={
          <>
            Папка <strong>«{deletingFolder?.name}»</strong> и вложенные папки будут удалены. Доски из них не удаляются — они
            переместятся в «Без папки».
          </>
        }
        confirmLabel="Удалить папку"
        danger
        busy={busy}
        onClose={() => setDeletingFolder(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await boardsApi.deleteFolder(deletingFolder!.id);
            if (currentFolder && descendantsOf(folders, deletingFolder!.id).has(currentFolder.id)) setFolderId(undefined);
            setDeletingFolder(null);
            reloadAll();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
