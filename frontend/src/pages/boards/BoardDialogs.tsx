import { useEffect, useState } from 'react';
import { BOARD_MODE_LABELS, type BoardMode, type BoardSummary, type FolderView } from '@doska/shared';
import { boardsApi, type TeacherClass } from '../../api/boards';
import { ApiError, errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox, SelectField, TextField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { flattenFolders } from './folderTree';

function FolderSelect({
  folders,
  value,
  onChange,
  label = 'Папка',
  exclude,
}: {
  folders: FolderView[];
  value: string | null;
  onChange: (v: string | null) => void;
  label?: string;
  exclude?: Set<string>;
}) {
  return (
    <SelectField label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— без папки —</option>
      {flattenFolders(folders)
        .filter((f) => !exclude?.has(f.id))
        .map((f) => (
          <option key={f.id} value={f.id}>
            {'  '.repeat(f.depth)}
            {f.name}
          </option>
        ))}
    </SelectField>
  );
}

/** Создание доски: учитель — урок (режим, классы, папка); ученик — конспект. */
export function CreateBoardDialog({
  open,
  isTeacher,
  folders,
  defaultFolderId,
  onClose,
  onCreated,
}: {
  open: boolean;
  isTeacher: boolean;
  folders: FolderView[];
  defaultFolderId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<BoardMode>('LECTURE');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setMode('LECTURE');
    setFolderId(defaultFolderId);
    setClassIds([]);
    setErrors({});
    setError(null);
    if (isTeacher) boardsApi.myClasses().then((r) => setClasses(r.classes)).catch((err) => setError(errorMessage(err)));
  }, [open, isTeacher, defaultFolderId]);

  const submit = async () => {
    if (!title.trim()) {
      setErrors({ title: ['Укажите название'] });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await boardsApi.create(
        isTeacher ? { title: title.trim(), mode, folderId, classIds } : { title: title.trim(), folderId },
      );
      onCreated(res.board.id);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={isTeacher ? 'Новая доска' : 'Новый конспект'}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Создать
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <TextField
        label="Название"
        placeholder={isTeacher ? 'Урок 12. Законы Ньютона' : 'Конспект по алгебре'}
        autoFocus
        value={title}
        errors={errors.title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {isTeacher && (
        <>
          <SelectField label="Режим" value={mode} onChange={(e) => setMode(e.target.value as BoardMode)} hint="Режим можно переключать во время урока">
            {(Object.keys(BOARD_MODE_LABELS) as BoardMode[]).map((m) => (
              <option key={m} value={m}>
                {BOARD_MODE_LABELS[m]}
              </option>
            ))}
          </SelectField>
          <div className="field">
            <span className="field__label">Открыть классам</span>
            <div className="check-list">
              {classes.length === 0 && (
                <div className="muted small" style={{ padding: 8 }}>
                  Вы пока не назначены учителем ни одного класса — обратитесь к администратору. Доску можно создать и выдать позже.
                </div>
              )}
              {classes.map((c) => (
                <div key={c.id}>
                  <Checkbox
                    label={
                      <>
                        {c.name} <span className="muted small">{c.academicYear ?? ''} · учеников: {c.studentCount}</span>
                      </>
                    }
                    checked={classIds.includes(c.id)}
                    onChange={(e) => setClassIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                  />
                </div>
              ))}
            </div>
            {errors.classIds && <span className="field__error">{errors.classIds.join('. ')}</span>}
          </div>
        </>
      )}
      {folders.length > 0 && <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />}
    </Dialog>
  );
}

/** Переименование доски. */
export function RenameBoardDialog({ board, onClose, onSaved }: { board: BoardSummary | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (board) {
      setTitle(board.title);
      setError(null);
    }
  }, [board]);
  return (
    <Dialog
      open={!!board}
      onClose={onClose}
      busy={busy}
      title="Переименовать доску"
      onSubmit={async () => {
        if (!board || !title.trim()) return;
        setBusy(true);
        try {
          await boardsApi.update(board.id, { title: title.trim() });
          onSaved();
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
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            Сохранить
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <TextField label="Название" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
    </Dialog>
  );
}

/** Перенос доски в папку. */
export function MoveBoardDialog({
  board,
  folders,
  onClose,
  onSaved,
}: {
  board: BoardSummary | null;
  folders: FolderView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (board) {
      setFolderId(board.folderId);
      setError(null);
    }
  }, [board]);
  return (
    <Dialog
      open={!!board}
      onClose={onClose}
      busy={busy}
      title="Переместить в папку"
      onSubmit={async () => {
        if (!board) return;
        setBusy(true);
        try {
          await boardsApi.update(board.id, { folderId });
          onSaved();
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
          <Button type="submit" variant="primary" loading={busy}>
            Переместить
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
    </Dialog>
  );
}

/** Создание и переименование/перенос папки. */
export function FolderDialog({
  open,
  folder,
  parentId,
  folders,
  exclude,
  onClose,
  onSaved,
}: {
  open: boolean;
  folder: FolderView | null;
  parentId: string | null;
  folders: FolderView[];
  exclude?: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setParent(folder ? folder.parentId : parentId);
    setErrors({});
    setError(null);
  }, [open, folder, parentId]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={folder ? 'Папка' : 'Новая папка'}
      onSubmit={async () => {
        if (!name.trim()) {
          setErrors({ name: ['Укажите название'] });
          return;
        }
        setBusy(true);
        setError(null);
        try {
          if (folder) await boardsApi.updateFolder(folder.id, { name: name.trim(), parentId: parent });
          else await boardsApi.createFolder(name.trim(), parent);
          onSaved();
        } catch (err) {
          setError(errorMessage(err));
          if (err instanceof ApiError) setErrors(err.fieldErrors);
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {folder ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <TextField label="Название" autoFocus value={name} errors={errors.name} onChange={(e) => setName(e.target.value)} />
      <FolderSelect folders={folders} value={parent} onChange={setParent} label="Внутри папки" exclude={exclude} />
      {errors.parentId && <span className="field__error">{errors.parentId.join('. ')}</span>}
    </Dialog>
  );
}
