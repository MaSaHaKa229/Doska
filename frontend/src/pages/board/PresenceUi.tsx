import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Eraser, Hand, Pencil, Users } from 'lucide-react';
import { USER_ROLE_LABELS } from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import type { BoardSession } from '../../collab/session';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { cursorVisible, groupParticipants, type Presence } from '../../collab/presence';
import { useBoard, currentCamera } from '../../store/board';
import { worldToScreen, type Size } from '../../canvas/camera';
import { Avatar } from '../../ui/misc';
import { useAuth } from '../../store/auth';

function usePeers(presence: Presence) {
  return useSyncExternalStore(useCallback((cb) => presence.subscribe(cb), [presence]), () => presence.peers());
}

/**
 * Курсоры других участников на текущей странице: стрелка цветом участника
 * и подпись с именем. HTML поверх холста (чёткий текст при любом масштабе).
 */
export function CursorsLayer({ presence, sizeRef }: { presence: Presence; sizeRef: React.MutableRefObject<Size> }) {
  const peers = usePeers(presence);
  const pageId = useBoard((s) => s.pageId);
  // Подписка на камеру: курсоры пересчитываются при перемещении доски.
  useBoard((s) => (s.pageId ? s.cameras[s.pageId] : undefined));
  const caps = useBoard((s) => s.caps);
  const showStudents = useBoard((s) => s.board?.settings.showStudentCursors !== false);
  const cam = currentCamera();
  const size = sizeRef.current;
  return (
    <div className="cursors" aria-hidden>
      {peers.map((p) => {
        if (!p.cursor || p.cursor.pageId !== pageId || !cursorVisible(p, caps?.role ?? 'viewer', showStudents)) return null;
        const s = worldToScreen(cam, size, p.cursor);
        if (s.x < -20 || s.y < -20 || s.x > size.width + 20 || s.y > size.height + 20) return null;
        const short = p.user.fullName.split(' ').slice(0, 2).join(' ');
        return (
          <div key={p.clientId} className="cursor" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
            <svg width="18" height="22" viewBox="0 0 18 22">
              <path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19 L8.5 12 L15 12 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="cursor__label" style={{ background: p.user.color }}>
              {short}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Присутствующие на доске: аватары в шапке и список по нажатию. У учеников
 * видны мел и поднятая рука; учитель отсюда даёт и забирает мел и удаляет
 * записи конкретного ученика.
 */
export function Participants({ presence, model, session }: { presence: Presence; model: BoardModel; session?: BoardSession }) {
  const peers = usePeers(presence);
  const caps = useBoard((s) => s.caps);
  const mode = useBoard((s) => s.board?.mode);
  const chalkHolders = useBoard((s) => s.chalkHolders);
  const hands = useBoard((s) => s.hands);
  const [clearFor, setClearFor] = useState<{ id: string; name: string } | null>(null);
  const me = useAuth((s) => s.user);
  const setPage = useBoard((s) => s.setPage);
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
  const list = groupParticipants(peers).filter((p) => p.user.id !== me?.id);
  const pages = model.pages();
  const pageTitle = (id: string | null) => {
    const i = pages.findIndex((p) => p.id === id);
    return i >= 0 ? pages[i]!.title || `Страница ${i + 1}` : null;
  };
  const shown = list.slice(0, 4);
  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="btn btn--ghost btn--small participants"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Участники на доске"
        onClick={() => setOpen((v) => !v)}
      >
        {shown.length === 0 && <Users size={16} />}
        <span className="avatar-stack">
          {shown.map((p) => (
            <Avatar key={p.user.id} name={p.user.fullName} color={p.user.color} size={26} />
          ))}
        </span>
        <span data-testid="participants-count">{list.length + 1}</span>
      </button>
      {open && (
        <div className="menu__list participants__list" role="dialog" aria-label="Участники">
          <div className="small muted" style={{ padding: '4px 10px' }}>
            На доске: {list.length + 1}
          </div>
          {me && (
            <div className="participant">
              <Avatar name={me.fullName} color={me.color} size={26} />
              <div>
                <div>{me.fullName} (вы)</div>
                <div className="small muted">{USER_ROLE_LABELS[me.role]}</div>
              </div>
            </div>
          )}
          {list.map((p) => {
            const student = p.user.role === 'STUDENT';
            const hasChalk = chalkHolders.includes(p.user.id);
            const handUp = hands.some((h) => h.userId === p.user.id);
            return (
              <div key={p.user.id} className="participant" data-testid="participant">
                <button
                  type="button"
                  className="participant participant--btn"
                  style={{ padding: 0, flex: 1, minWidth: 0 }}
                  title={p.pageId ? 'Перейти на страницу участника' : undefined}
                  onClick={() => {
                    if (p.pageId && model.page(p.pageId)) setPage(p.pageId);
                    setOpen(false);
                  }}
                >
                  <Avatar name={p.user.fullName} color={p.user.color} size={26} />
                  <div style={{ minWidth: 0 }}>
                    <div>
                      {p.user.fullName}{' '}
                      <span className="participant__marks">
                        {hasChalk && <Pencil size={13} aria-label="с мелом" />}
                        {handUp && <Hand size={13} className="hand-raised" aria-label="поднял(а) руку" />}
                      </span>
                    </div>
                    <div className="small muted">
                      {USER_ROLE_LABELS[p.user.role]}
                      {pageTitle(p.pageId) ? ` · ${pageTitle(p.pageId)}` : ''}
                      {p.connections > 1 ? ` · устройств: ${p.connections}` : ''}
                    </div>
                  </div>
                </button>
                {session && student && caps?.manageLesson && (
                  <span className="participant__actions">
                    {(mode === 'SELECTIVE' || hasChalk) && (
                      <Button
                        size="small"
                        variant="ghost"
                        iconOnly
                        className={hasChalk ? 'is-active' : undefined}
                        icon={<Pencil size={16} />}
                        aria-pressed={hasChalk}
                        aria-label={hasChalk ? `Забрать мел: ${p.user.fullName}` : `Дать мел: ${p.user.fullName}`}
                        title={hasChalk ? 'Забрать мел' : 'Дать мел'}
                        onClick={() => session.send({ t: 'chalk.set', userId: p.user.id, granted: !hasChalk })}
                      />
                    )}
                    {caps.clearStudentObjects && (
                      <Button
                        size="small"
                        variant="ghost"
                        iconOnly
                        icon={<Eraser size={16} />}
                        aria-label={`Удалить записи: ${p.user.fullName}`}
                        title="Удалить все записи ученика"
                        onClick={() => setClearFor({ id: p.user.id, name: p.user.fullName })}
                      />
                    )}
                  </span>
                )}
              </div>
            );
          })}
          {list.length === 0 && <div className="small muted" style={{ padding: '4px 10px 8px' }}>Кроме вас никого нет</div>}
        </div>
      )}
      {session && (
        <ConfirmDialog
          open={clearFor !== null}
          title="Удалить записи ученика?"
          confirmLabel="Удалить"
          danger
          message={
            <>
              Будут удалены все объекты, созданные учеником {clearFor?.name}, на всех страницах доски. Перед удалением сохраняется версия
              доски.
            </>
          }
          onClose={() => setClearFor(null)}
          onConfirm={() => {
            if (clearFor) session.send({ t: 'objects.clearByAuthors', authors: [clearFor.id], pageId: null });
            setClearFor(null);
          }}
        />
      )}
    </div>
  );
}
