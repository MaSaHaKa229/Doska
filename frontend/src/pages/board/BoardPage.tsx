import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CloudOff, Loader2, Lock, Redo2, Undo2, Wifi } from 'lucide-react';
import { BOARD_MODE_LABELS, noWriteHint, type BoardDetails } from '@doska/shared';
import type Konva from 'konva';
import { boardsApi } from '../../api/boards';
import { errorMessage } from '../../api/http';
import { useAuth } from '../../store/auth';
import { useBoard, type ConnectionStatus } from '../../store/board';
import { openBoardSession, type BoardSession } from '../../collab/session';
import { BoardStage } from '../../canvas/BoardStage';
import { fitRect, type Size } from '../../canvas/camera';
import { Button } from '../../ui/Button';
import { Alert, Badge, EmptyState, FullScreenSpinner } from '../../ui/misc';
import { BoardCommands } from './commands';
import { useBoardShortcuts } from './shortcuts';
import { PageTabs, PropertiesBar, Toolbar, ZoomControls } from './Panels';
import type { CanvasTheme } from '../../objects/colors';

const STATUS: Record<ConnectionStatus, { label: string; kind?: 'accent' | 'warning' | 'danger' }> = {
  connecting: { label: 'Подключение…', kind: 'warning' },
  online: { label: 'В сети', kind: 'accent' },
  reconnecting: { label: 'Переподключение…', kind: 'warning' },
  offline: { label: 'Нет связи', kind: 'danger' },
  closed: { label: 'Отключено', kind: 'danger' },
};

/**
 * Страница доски: загрузка свойств по REST (404 → «нет доступа»), открытие
 * сессии синхронизации, холст и панели.
 */
export function BoardPage() {
  const { id = '' } = useParams();
  const user = useAuth((s) => s.user)!;
  const [details, setDetails] = useState<BoardDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<BoardSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    let s: BoardSession | null = null;
    setDetails(null);
    setError(null);
    boardsApi
      .get(id)
      .then(({ board }) => {
        if (cancelled) return;
        setDetails(board);
        s = openBoardSession(board, user);
        setSession(s);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      s?.destroy();
      setSession(null);
    };
    // Пользователь в рамках страницы не меняется.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <EmptyState title="Доска недоступна">
          <span>{error}</span>
          <Link to="/" className="btn btn--primary" style={{ marginTop: 8 }}>
            К списку досок
          </Link>
        </EmptyState>
      </main>
    );
  }
  if (!details || !session) return <FullScreenSpinner />;
  return <BoardWorkspace session={session} />;
}

function BoardWorkspace({ session }: { session: BoardSession }) {
  const { model } = session;
  const board = useBoard((s) => s.board);
  const caps = useBoard((s) => s.caps);
  const status = useBoard((s) => s.status);
  const closedReason = useBoard((s) => s.closedReason);
  const synced = useBoard((s) => s.synced);
  const canUndo = useBoard((s) => s.canUndo);
  const canRedo = useBoard((s) => s.canRedo);
  const pageId = useBoard((s) => s.pageId);
  const stageRef = useRef<Konva.Stage | null>(null);
  const sizeRef = useRef<Size>({ width: 800, height: 600 });
  const commands = useMemo(() => new BoardCommands(model, () => sizeRef.current), [model]);
  useBoardShortcuts(commands);

  // Отладочный доступ для сквозных тестов (только в режиме разработки).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __doska?: unknown }).__doska = { model, store: useBoard, commands };
    return () => {
      delete (window as unknown as { __doska?: unknown }).__doska;
    };
  }, [model, commands]);

  useSyncExternalStore(useCallback((cb) => model.subscribePages(cb), [model]), () => model.pagesStamp);
  const page = pageId ? model.page(pageId) : undefined;
  const userTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const theme: CanvasTheme = page?.background.surface === 'chalk' ? 'chalk' : userTheme;

  // Первое открытие страницы: показать её содержимое (если есть).
  useEffect(() => {
    if (!pageId || !synced) return;
    const s = useBoard.getState();
    if (s.cameras[pageId]) return;
    const bounds = model.pageBounds(pageId);
    s.setCamera(bounds ? fitRect(bounds, sizeRef.current, 64, 1) : { cx: 0, cy: 0, zoom: 1 });
  }, [model, pageId, synced]);

  const st = STATUS[status];
  const hint = caps && !caps.write ? noWriteHint(caps.noWriteReason) : null;

  return (
    <div className="board-page">
      <header className="board-topbar">
        <Link to="/" className="btn btn--ghost btn--small btn--icon" aria-label="К списку досок" title="К списку досок">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="board-topbar__title" title={board?.title}>
          {board?.title}
        </h1>
        {board?.kind === 'LESSON' && <Badge kind="accent">{BOARD_MODE_LABELS[board.mode]}</Badge>}
        <span className="spacer" />
        <Badge kind={st.kind} title={closedReason ?? undefined}>
          {status === 'online' ? <Wifi size={12} /> : status === 'offline' || status === 'closed' ? <CloudOff size={12} /> : <Loader2 size={12} className="spin" />}
          <span data-testid="connection-status">{st.label}</span>
        </Badge>
        <Button size="small" variant="ghost" iconOnly icon={<Undo2 size={18} />} aria-label="Отменить (Ctrl+Z)" title="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={() => commands.undo()} />
        <Button size="small" variant="ghost" iconOnly icon={<Redo2 size={18} />} aria-label="Повторить (Ctrl+Shift+Z)" title="Повторить (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => commands.redo()} />
      </header>
      <PropertiesBar model={model} commands={commands} theme={theme} />
      {status === 'closed' && closedReason && (
        <div className="board-banner">
          <Alert kind="error">
            {closedReason}. <Link to="/">Вернуться к списку досок</Link>
          </Alert>
        </div>
      )}
      {hint && (
        <div className="board-hint" role="status">
          <Lock size={14} /> {hint}
        </div>
      )}
      <div className="board-main">
        <Toolbar />
        <div className="board-canvas-wrap">
          {!synced && (
            <div className="board-loading">
              <Loader2 size={20} className="spin" /> Загрузка доски…
            </div>
          )}
          <BoardStage model={model} stageRef={stageRef} sizeRef={sizeRef} />
          <ZoomControls commands={commands} />
        </div>
      </div>
      <PageTabs model={model} />
    </div>
  );
}
