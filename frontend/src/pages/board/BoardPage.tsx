import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CloudOff, Loader2, Lock, Redo2, Search, Undo2, Wifi } from 'lucide-react';
import { BOARD_MODE_LABELS, noWriteHint, type AssetView, type BoardDetails } from '@doska/shared';
import type Konva from 'konva';
import { boardsApi } from '../../api/boards';
import { ApiError, errorMessage } from '../../api/http';
import { useAuth } from '../../store/auth';
import { currentCamera, useBoard, type ConnectionStatus } from '../../store/board';
import { openBoardSession, type BoardSession } from '../../collab/session';
import { BoardStage } from '../../canvas/BoardStage';
import { fitRect, screenToWorld, type Size } from '../../canvas/camera';
import { Button } from '../../ui/Button';
import { Alert, Badge, EmptyState, FullScreenSpinner } from '../../ui/misc';
import { BoardCommands } from './commands';
import { useBoardShortcuts } from './shortcuts';
import { PageTabs, PropertiesBar, Toolbar, ZoomControls } from './Panels';
import type { CanvasTheme } from '../../objects/colors';
import { CursorsLayer, Participants } from './PresenceUi';
import { ViewMenu } from './ViewMenu';
import { FollowBanner, HandButton, HandsIndicator, LessonMenu } from './LessonUi';
import { LaserLayer } from './LaserLayer';
import { WorkBar } from './WorkBar';
import { TextEditorHost } from './TextEditor';
import { FormulaEditorsHost } from './FormulaEditors';
import { PluginEditorsHost } from './PluginEditors';
import { PdfImportDialog } from './MediaUi';
import { INSERT_FILES_EVENT, type InsertFilesDetail } from '../../media/insert';
import { toast } from '../../store/toast';
import { useFollowLead, useFollowView } from './useFollow';
import { CommandPalette, HelpDialog } from './Palette';
import { coreCommands } from './boardCommands';
import { pluralize } from '../../lib/format';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

const DETAILS_CACHE = 'doska.boardCache.';

/** Свойства доски для открытия без сети (без списка доступа). */
function cacheDetails(d: BoardDetails): void {
  try {
    localStorage.setItem(DETAILS_CACHE + d.id, JSON.stringify({ ...d, access: null }));
  } catch {
    /* хранилище недоступно */
  }
}
function cachedDetails(id: string): BoardDetails | null {
  try {
    const raw = localStorage.getItem(DETAILS_CACHE + id);
    return raw ? (JSON.parse(raw) as BoardDetails) : null;
  } catch {
    return null;
  }
}

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
        cacheDetails(board);
        setDetails(board);
        s = openBoardSession(board, user);
        setSession(s);
      })
      .catch((err) => {
        if (cancelled) return;
        // Нет сети — открываем доску по сохранённым свойствам: работа
        // продолжится локально и синхронизируется после подключения.
        const cached = err instanceof ApiError && err.code === 'NETWORK' ? cachedDetails(id) : null;
        if (cached) {
          setDetails(cached);
          s = openBoardSession(cached, user);
          setSession(s);
        } else setError(errorMessage(err));
      });
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const ui = useMemo(() => ({ palette: () => setPaletteOpen(true), help: () => setHelpOpen(true) }), []);
  const paletteCommands = useMemo(() => coreCommands(commands, model, { help: ui.help }), [commands, model, ui]);
  const pendingChanges = useBoard((s) => s.pendingChanges);
  useBoardShortcuts(commands, ui);
  // Картинки и PDF: импорт PDF — через диалог; файлы от инструмента «Картинка или PDF».
  const [pdfRequest, setPdfRequest] = useState<{ asset: AssetView; name: string } | null>(null);
  // Удаление опор динамической геометрии: построения на них — вместе с ними или отмена.
  const [dependentsRequest, setDependentsRequest] = useState<{ count: number; proceed: () => void } | null>(null);
  useEffect(() => {
    commands.confirmDependents = (count, proceed) => setDependentsRequest({ count, proceed });
    return () => {
      commands.confirmDependents = null;
    };
  }, [commands]);
  useEffect(() => {
    commands.pdfHandler = (asset, name) => {
      if (!useBoard.getState().caps?.managePages) {
        toast.info('PDF добавляется новыми страницами, а добавлять страницы на этой доске может учитель');
        return;
      }
      setPdfRequest({ asset, name });
    };
    const onInsert = (e: Event) => {
      const { files, at } = (e as CustomEvent<InsertFilesDetail>).detail;
      void commands.insertFiles(files, at);
    };
    window.addEventListener(INSERT_FILES_EVENT, onInsert);
    return () => {
      commands.pdfHandler = null;
      window.removeEventListener(INSERT_FILES_EVENT, onInsert);
    };
  }, [commands]);
  useFollowView(model, sizeRef);
  useFollowLead(session, sizeRef);

  // Отладочный доступ для сквозных тестов (только в режиме разработки).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __doska?: unknown }).__doska = { model, store: useBoard, commands, presence: session.presence };
    return () => {
      delete (window as unknown as { __doska?: unknown }).__doska;
    };
  }, [model, commands, session]);

  useSyncExternalStore(useCallback((cb) => model.subscribePages(cb), [model]), () => model.pagesStamp);
  const page = pageId ? model.page(pageId) : undefined;
  const userTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const theme: CanvasTheme = page?.background.surface === 'chalk' ? 'chalk' : userTheme;

  // Первое открытие страницы: показать её содержимое (если есть).
  useEffect(() => {
    if (!pageId || !synced) return;
    const s = useBoard.getState();
    if (s.cameras[pageId]) return;
    // Страница PDF — показать её целиком, если объектов нет.
    const pdf = model.page(pageId)?.background.pdf;
    const bounds = model.pageBounds(pageId) ?? (pdf ? { x: 0, y: 0, width: pdf.width, height: pdf.height } : null);
    s.setCamera(bounds ? fitRect(bounds, sizeRef.current, 64, 1) : { cx: 0, cy: 0, zoom: 1 }, 'system');
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
        <HandsIndicator session={session} />
        <HandButton session={session} />
        <LessonMenu session={session} sizeRef={sizeRef} />
        <Participants presence={session.presence} model={model} session={session} />
        <Badge
          kind={st.kind}
          title={
            closedReason ??
            (status !== 'online' ? 'Изменения сохраняются на этом устройстве и отправятся после подключения' : 'Изменения сохраняются автоматически')
          }
        >
          {status === 'online' ? <Wifi size={12} /> : status === 'offline' || status === 'closed' ? <CloudOff size={12} /> : <Loader2 size={12} className="spin" />}
          <span data-testid="connection-status">
            {st.label}
            {status !== 'online' && pendingChanges > 0 &&
              ` · ${pendingChanges} ${pluralize(pendingChanges, 'изменение ждёт', 'изменения ждут', 'изменений ждут')} отправки`}
          </span>
        </Badge>
        <Button size="small" variant="ghost" iconOnly icon={<Search size={18} />} aria-label="Поиск инструментов и команд (Ctrl+K)" title="Поиск инструментов и команд (Ctrl+K)" onClick={ui.palette} />
        <ViewMenu model={model} onHelp={ui.help} />
        <Button size="small" variant="ghost" iconOnly icon={<Undo2 size={18} />} aria-label="Отменить (Ctrl+Z)" title="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={() => commands.undo()} />
        <Button size="small" variant="ghost" iconOnly icon={<Redo2 size={18} />} aria-label="Повторить (Ctrl+Shift+Z)" title="Повторить (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => commands.redo()} />
      </header>
      <PropertiesBar model={model} commands={commands} theme={theme} />
      {/* Полосы над холстом (отключение, показ учителя, подсказка) — одна строка сетки. */}
      <div className="board-notices">
        {status === 'closed' && closedReason && (
          <div className="board-banner">
            <Alert kind="error">
              {closedReason}. <Link to="/">Вернуться к списку досок</Link>
            </Alert>
          </div>
        )}
        <WorkBar />
        <FollowBanner />
        {hint && (
          <div className="board-hint" role="status">
            <Lock size={14} /> {hint}
          </div>
        )}
      </div>
      <div className="board-main">
        <Toolbar />
        <div
          className="board-canvas-wrap"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files];
            if (!files.length) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            void commands.insertFiles(files, screenToWorld(currentCamera(), sizeRef.current, { x: e.clientX - r.left, y: e.clientY - r.top }));
          }}
        >
          {!synced && (
            <div className="board-loading">
              <Loader2 size={20} className="spin" /> Загрузка доски…
            </div>
          )}
          <BoardStage model={model} stageRef={stageRef} sizeRef={sizeRef} presence={session.presence} people={session.people} laser={session.laser} />
          <LaserLayer presence={session.presence} laser={session.laser} sizeRef={sizeRef} />
          <CursorsLayer presence={session.presence} sizeRef={sizeRef} />
          <TextEditorHost model={model} presence={session.presence} sizeRef={sizeRef} theme={theme} />
          <FormulaEditorsHost model={model} />
          <PluginEditorsHost model={model} />
          <ZoomControls commands={commands} />
        </div>
      </div>
      <PageTabs model={model} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        onInsert={(type, props) => commands.insertAtCenter(type, props)}
      />
      <PdfImportDialog model={model} request={pdfRequest} onClose={() => setPdfRequest(null)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} commands={paletteCommands} />
      <ConfirmDialog
        open={!!dependentsRequest}
        title="Удалить вместе с построениями?"
        message={
          dependentsRequest
            ? `От выделенного ${pluralize(dependentsRequest.count, 'зависит', 'зависят', 'зависят')} ${dependentsRequest.count} ${pluralize(dependentsRequest.count, 'построение', 'построения', 'построений')}. Без опоры они не могут существовать.`
            : ''
        }
        confirmLabel="Удалить вместе с ними"
        danger
        onConfirm={() => {
          dependentsRequest?.proceed();
          setDependentsRequest(null);
        }}
        onClose={() => setDependentsRequest(null)}
      />
    </div>
  );
}
