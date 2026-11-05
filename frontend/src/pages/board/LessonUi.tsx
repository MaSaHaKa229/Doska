import { useEffect, useRef, useState } from 'react';
import { BookOpen, ClipboardList, Eraser, GraduationCap, Hand, KeyRound, MonitorPlay, Pencil, PencilOff, ScreenShare, Undo2 } from 'lucide-react';
import { BOARD_MODE_LABELS, BOARD_MODES, type BoardMode, type BoardSettings } from '@doska/shared';
import type { BoardSession } from '../../collab/session';
import { isFollowing, useBoard } from '../../store/board';
import type { Size } from '../../canvas/camera';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Field';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AccessDialog } from '../boards/AccessDialog';
import { CreateAssignmentDialog } from '../assignments/CreateAssignmentDialog';
import { TemplateDialog } from '../library/TemplateDialog';
import { startFollow } from './useFollow';

/** Всплывающая панель у кнопки шапки: закрывается по клику вне и Esc. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, root };
}

const MODE_HINTS: Record<BoardMode, string> = {
  LECTURE: 'Пишет только учитель',
  COLLABORATIVE: 'Пишут все ученики',
  SELECTIVE: 'Пишут ученики с мелом',
};

const SETTING_LABELS: { key: keyof BoardSettings; label: string }[] = [
  { key: 'allowStudentsEditOthers', label: 'Ученики могут менять записи друг друга' },
  { key: 'allowStudentLaser', label: 'Лазерная указка у пишущих учеников' },
  { key: 'allowStudentPages', label: 'Ученики могут добавлять страницы' },
  { key: 'showAuthorsToStudents', label: 'Показывать ученикам авторов записей' },
  { key: 'showStudentCursors', label: 'Ученики видят курсоры друг друга' },
];

/**
 * Панель урока (учитель): режим одной кнопкой, мел, «Следуйте за мной»,
 * очистка записей учеников, настройки доски и доступ.
 */
export function LessonMenu({ session, sizeRef }: { session: BoardSession; sizeRef: React.MutableRefObject<Size> }) {
  const board = useBoard((s) => s.board);
  const caps = useBoard((s) => s.caps);
  const follow = useBoard((s) => s.follow);
  const userId = useBoard((s) => s.userId);
  const chalkHolders = useBoard((s) => s.chalkHolders);
  const pageId = useBoard((s) => s.pageId);
  const { open, setOpen, root } = usePopover();
  const [strict, setStrict] = useState(false);
  const [clearOpen, setClearOpen] = useState<null | 'page' | 'all'>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  if (!board || !caps?.manageLesson) return null;
  const isLesson = board.kind === 'LESSON';
  const leading = follow?.leaderId === userId;
  const send = session.send;
  // Режим и настройки меняются у учителя сразу; сервер подтвердит их
  // рассылкой mode.changed / settings.changed (или вернёт ошибку).
  const setMode = (mode: BoardMode) => {
    const s = useBoard.getState();
    if (s.board && s.caps) s.setBoard({ ...s.board, mode }, s.caps);
    send({ t: 'mode.set', mode });
  };
  const setSetting = (key: keyof BoardSettings, value: boolean) => {
    const s = useBoard.getState();
    if (s.board && s.caps) s.setBoard({ ...s.board, settings: { ...s.board.settings, [key]: value } }, s.caps);
    send({ t: 'settings.set', settings: { [key]: value } });
  };

  return (
    <div className="menu" ref={root}>
      <Button
        size="small"
        variant="ghost"
        icon={<GraduationCap size={16} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={leading ? 'is-active' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="topbar__label">Урок</span>
      </Button>
      {open && (
        <div className="menu__list lesson-menu" role="dialog" aria-label="Управление уроком">
          {isLesson && (
            <div className="lesson-menu__section">
              <div className="lesson-menu__title">Режим</div>
              <div className="segmented" role="group" aria-label="Режим доски">
                {BOARD_MODES.map((m) => (
                  <button key={m} type="button" aria-pressed={board.mode === m} title={MODE_HINTS[m]} onClick={() => setMode(m)}>
                    {BOARD_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {MODE_HINTS[board.mode]}
                {board.mode === 'SELECTIVE' && '. Мел выдаётся в списке участников.'}
              </div>
              {chalkHolders.length > 0 && (
                <Button size="small" variant="ghost" icon={<PencilOff size={16} />} style={{ marginTop: 4 }} onClick={() => send({ t: 'chalk.revokeAll' })}>
                  Забрать мел у всех ({chalkHolders.length})
                </Button>
              )}
            </div>
          )}

          {caps.leadFollow && (
            <div className="lesson-menu__section">
              <div className="lesson-menu__title">Показ</div>
              {follow && !leading && <div className="small" style={{ marginBottom: 4 }}>Сейчас показ ведёт {follow.leaderName}</div>}
              {leading ? (
                <Button size="small" variant="primary" icon={<MonitorPlay size={16} />} onClick={() => send({ t: 'follow.stop' })}>
                  Закончить показ
                </Button>
              ) : (
                <>
                  <Button
                    size="small"
                    variant="primary"
                    icon={<ScreenShare size={16} />}
                    onClick={() => {
                      startFollow(session, sizeRef, strict);
                      setOpen(false);
                    }}
                  >
                    Следуйте за мной
                  </Button>
                  <Checkbox label="Строго: ученики не могут отойти" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                </>
              )}
            </div>
          )}

          {caps.clearStudentObjects && (
            <div className="lesson-menu__section">
              <div className="lesson-menu__title">Записи учеников</div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                <Button size="small" icon={<Eraser size={16} />} disabled={!pageId} onClick={() => setClearOpen('page')}>
                  Очистить страницу
                </Button>
                <Button size="small" variant="danger" icon={<Eraser size={16} />} onClick={() => setClearOpen('all')}>
                  Очистить всю доску
                </Button>
              </div>
            </div>
          )}

          <div className="lesson-menu__section">
            <div className="lesson-menu__title">Настройки доски</div>
            {SETTING_LABELS.map(({ key, label }) => (
              <Checkbox key={key} label={label} checked={board.settings[key]} onChange={(e) => setSetting(key, e.target.checked)} />
            ))}
          </div>

          {(board.kind === 'LESSON' || board.kind === 'TEMPLATE') && (
            <div className="lesson-menu__section row" style={{ paddingBottom: 8, gap: 4, flexWrap: 'wrap' }}>
              <Button
                size="small"
                icon={<KeyRound size={16} />}
                onClick={() => {
                  setAccessOpen(true);
                  setOpen(false);
                }}
              >
                Доступ к доске…
              </Button>
              <Button
                size="small"
                icon={<ClipboardList size={16} />}
                onClick={() => {
                  setAssignOpen(true);
                  setOpen(false);
                }}
              >
                Раздать как задание…
              </Button>
              {board.kind === 'LESSON' && (
                <Button
                  size="small"
                  icon={<BookOpen size={16} />}
                  onClick={() => {
                    setTemplateOpen(true);
                    setOpen(false);
                  }}
                >
                  Сохранить как шаблон…
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={clearOpen !== null}
        title={clearOpen === 'page' ? 'Очистить записи учеников на этой странице?' : 'Очистить записи учеников на всей доске?'}
        confirmLabel="Очистить"
        danger
        onClose={() => setClearOpen(null)}
        onConfirm={() => {
          send({ t: 'objects.clearByAuthors', authors: 'students', pageId: clearOpen === 'page' ? pageId : null });
          setClearOpen(null);
        }}
        message={
          <>
            Будут удалены все объекты, созданные учениками{clearOpen === 'page' ? ' на текущей странице' : ''}. Записи учителей останутся. Перед
            очисткой сохраняется версия доски — её можно будет восстановить из истории версий.
          </>
        }
      />
      <AccessDialog boardId={board.id} title={board.title} open={accessOpen} onClose={() => setAccessOpen(false)} />
      <CreateAssignmentDialog open={assignOpen} board={{ id: board.id, title: board.title }} onClose={() => setAssignOpen(false)} />
      <TemplateDialog open={templateOpen} board={{ id: board.id, title: board.title }} onClose={() => setTemplateOpen(false)} />
    </div>
  );
}

/** «Поднять руку» (ученик). */
export function HandButton({ session }: { session: BoardSession }) {
  const caps = useBoard((s) => s.caps);
  const userId = useBoard((s) => s.userId);
  const raised = useBoard((s) => s.hands.some((h) => h.userId === s.userId));
  if (!caps?.raiseHand || !userId) return null;
  return (
    <Button
      size="small"
      variant="ghost"
      icon={<Hand size={16} />}
      className={raised ? 'is-active' : undefined}
      aria-pressed={raised}
      title={raised ? 'Опустить руку' : 'Поднять руку — учитель увидит и услышит сигнал'}
      onClick={() => session.send({ t: raised ? 'hand.lower' : 'hand.raise' })}
    >
      <span className="topbar__label">{raised ? 'Опустить руку' : 'Поднять руку'}</span>
    </Button>
  );
}

/** Поднятые руки (учитель): счётчик в шапке и список с действиями. */
export function HandsIndicator({ session }: { session: BoardSession }) {
  const caps = useBoard((s) => s.caps);
  const hands = useBoard((s) => s.hands);
  const mode = useBoard((s) => s.board?.mode);
  const { open, setOpen, root } = usePopover();
  if (!caps?.manageLesson || hands.length === 0) return null;
  return (
    <div className="menu" ref={root}>
      <Button
        size="small"
        variant="ghost"
        icon={<Hand size={16} className="hand-raised" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Поднятые руки"
        onClick={() => setOpen((v) => !v)}
      >
        <span data-testid="hands-count">{hands.length}</span>
      </Button>
      {open && (
        <div className="menu__list participants__list" role="dialog" aria-label="Поднятые руки">
          {hands.map((h) => (
            <div key={h.userId} className="participant">
              <Hand size={16} className="hand-raised" />
              <div style={{ minWidth: 0 }}>
                <div>{h.fullName}</div>
                <div className="small muted">{new Date(h.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <span className="participant__actions">
                {mode === 'SELECTIVE' && (
                  <Button size="small" variant="ghost" iconOnly icon={<Pencil size={16} />} aria-label={`Дать мел: ${h.fullName}`} title="Дать мел" onClick={() => session.send({ t: 'chalk.set', userId: h.userId, granted: true })} />
                )}
                <Button size="small" variant="ghost" iconOnly icon={<Undo2 size={16} />} aria-label={`Опустить руку: ${h.fullName}`} title="Опустить руку" onClick={() => session.send({ t: 'hand.dismiss', userId: h.userId })} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Полоса для ученика во время показа учителя. */
export function FollowBanner() {
  const follow = useBoard((s) => s.follow);
  const following = useBoard((s) => isFollowing(s));
  const detached = useBoard((s) => s.followDetached);
  const setDetached = useBoard((s) => s.setFollowDetached);
  if (!follow || !following) return null;
  return (
    <div className="follow-banner" role="status" data-testid="follow-banner">
      <ScreenShare size={14} />
      {detached ? (
        <>
          <span>{follow.leaderName} ведёт показ, вы смотрите в другое место.</span>
          <Button size="small" variant="primary" onClick={() => setDetached(false)}>
            Вернуться к учителю
          </Button>
        </>
      ) : (
        <span>
          {follow.leaderName} ведёт показ — ваш вид следует за учителем
          {follow.strict ? '.' : '. Можно временно отойти, чтобы рассмотреть подробнее.'}
        </span>
      )}
    </div>
  );
}
