import { useEffect, useState } from 'react';
import { History, RotateCcw, Save, X } from 'lucide-react';
import * as Y from 'yjs';
import { VERSION_REASON_LABELS, type BoardVersionSummary } from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import { versionsApi } from '../../api/versions';
import { fetchVersionSnapshot } from '../../api/assignments';
import { errorMessage } from '../../api/http';
import { BoardThumbnail, newViewModel } from '../../canvas/BoardThumbnail';
import { formatDateTime, pluralize } from '../../lib/format';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Alert, Spinner } from '../../ui/misc';

/** Предпросмотр версии: первая страница документа версии (как миниатюра доски). */
function VersionPreview({ boardId, versionId }: { boardId: string; versionId: string }) {
  const [state, setState] = useState<{ model: BoardModel | null; pages: number; error: string | null }>({ model: null, pages: 0, error: null });
  useEffect(() => {
    const ctrl = new AbortController();
    let doc: Y.Doc | null = null;
    let model: BoardModel | null = null;
    fetchVersionSnapshot(boardId, versionId, ctrl.signal)
      .then((bytes) => {
        if (ctrl.signal.aborted) return;
        doc = new Y.Doc();
        model = newViewModel(doc);
        Y.applyUpdate(doc, bytes);
        setState({ model, pages: model.pages().length, error: null });
      })
      .catch((err) => !ctrl.signal.aborted && setState({ model: null, pages: 0, error: errorMessage(err) }));
    return () => {
      ctrl.abort();
      model?.destroy();
      doc?.destroy();
    };
  }, [boardId, versionId]);
  if (state.error) return <Alert kind="error">{state.error}</Alert>;
  if (!state.model) return <Spinner label="Загрузка версии…" />;
  return (
    <div className="versions-panel__preview">
      <BoardThumbnail model={state.model} width={352} height={200} />
      {state.pages > 1 && <div className="small muted">Показана первая страница из {state.pages}</div>}
    </div>
  );
}

/**
 * История версий (право restoreVersions): «Сохранить версию» с подписью,
 * список версий (автосохранения, ручные, перед восстановлением, перед
 * очисткой), предпросмотр и восстановление. Восстановление приходит всем
 * участникам как обычные изменения; текущее состояние перед ним
 * сохраняется отдельной версией — его можно вернуть так же.
 */
export function VersionsPanel({ open, boardId, onClose }: { open: boolean; boardId: string; onClose: () => void }) {
  const [versions, setVersions] = useState<BoardVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BoardVersionSummary | null>(null);

  const load = () =>
    versionsApi
      .list(boardId)
      .then((r) => {
        setVersions(r.versions);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  if (!open) return null;

  const save = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await versionsApi.create(boardId, label.trim());
      toast.success('Версия сохранена');
      setLabel('');
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (v: BoardVersionSummary) => {
    setBusy(true);
    try {
      await versionsApi.restore(boardId, v.id);
      setConfirm(null);
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="calc-panel versions-panel"
      role="dialog"
      aria-label="История версий"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !confirm) {
          e.preventDefault();
          onClose();
        }
        e.stopPropagation();
      }}
    >
      <div className="calc-panel__header">
        <h2>
          <History size={16} style={{ verticalAlign: '-2px' }} /> История версий
        </h2>
        <Button size="small" variant="ghost" iconOnly icon={<X size={18} />} aria-label="Закрыть историю версий" onClick={onClose} />
      </div>
      <form
        className="stack"
        style={{ gap: 6, alignItems: 'flex-start' }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input className="input" aria-label="Подпись версии" placeholder="Подпись: «После разбора задачи 3»" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" size="small" icon={<Save size={14} />} disabled={!label.trim() || busy}>
          Сохранить версию
        </Button>
      </form>
      {error && <Alert kind="error">{error}</Alert>}
      {!versions && !error && <Spinner />}
      {versions && versions.length === 0 && <p className="small muted">Версий пока нет. Автосохранение делается во время работы, раз в час; сохраните версию вручную — с подписью.</p>}
      {versions && versions.length > 0 && (
        <ol className="versions-panel__list" aria-label="Версии">
          {versions.map((v) => (
            <li key={v.id} className={selected === v.id ? 'is-selected' : undefined}>
              <button type="button" className="versions-panel__item" aria-expanded={selected === v.id} onClick={() => setSelected(selected === v.id ? null : v.id)}>
                <span className="versions-panel__when">{formatDateTime(v.createdAt)}</span>
                <span className="small">{v.label ?? VERSION_REASON_LABELS[v.reason]}</span>
                <span className="small muted">
                  {v.label ? `${VERSION_REASON_LABELS[v.reason]} · ` : ''}
                  {v.createdBy?.fullName ?? 'система'} · {v.objectCount} {pluralize(v.objectCount, 'объект', 'объекта', 'объектов')}
                </span>
              </button>
              {selected === v.id && (
                <div className="stack" style={{ gap: 6, padding: '4px 4px 8px' }}>
                  <VersionPreview boardId={boardId} versionId={v.id} />
                  <Button size="small" variant="primary" icon={<RotateCcw size={14} />} disabled={busy} onClick={() => setConfirm(v)}>
                    Восстановить эту версию
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={!!confirm}
        title="Восстановить версию?"
        confirmLabel="Восстановить"
        busy={busy}
        onConfirm={() => confirm && void restore(confirm)}
        onClose={() => setConfirm(null)}
        message={
          <>
            Доска у всех участников вернётся к версии от {confirm ? formatDateTime(confirm.createdAt) : ''}
            {confirm?.label ? ` («${confirm.label}»)` : ''}. Текущее состояние сохранится как версия «Перед восстановлением» — восстановление можно отменить.
          </>
        }
      />
    </aside>
  );
}
