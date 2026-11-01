import type * as awarenessProtocol from 'y-protocols/awareness';
import { EMPTY_AWARENESS, type AwarenessState, type ParticipantUser, type Viewport } from '@doska/shared';

/** Состояние другого участника (из awareness; поле user подставил сервер). */
export interface Peer extends AwarenessState {
  clientId: number;
  user: ParticipantUser;
}

export interface Participant {
  user: ParticipantUser;
  /** Число открытых вкладок/устройств. */
  connections: number;
  /** Страница, на которой участник сейчас (по курсору или виду). */
  pageId: string | null;
}

const CURSOR_INTERVAL_MS = 33; // ~30 раз в секунду
const VIEWPORT_INTERVAL_MS = 250;

/**
 * Присутствие: публикация своего состояния (курсор, выделение, инструмент,
 * вид) с ограничением частоты и список других участников.
 */
export class Presence {
  private peersCache: Peer[] = [];
  private readonly listeners = new Set<() => void>();
  private pendingCursor: AwarenessState['cursor'] | undefined;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCursorSent = 0;
  private pendingViewport: Viewport | null = null;
  private viewportTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly awareness: awarenessProtocol.Awareness) {
    awareness.setLocalState({ ...EMPTY_AWARENESS });
    awareness.on('change', this.onChange);
    this.recompute();
  }

  private onChange = () => {
    this.recompute();
    this.listeners.forEach((l) => l());
  };

  private recompute(): void {
    const own = this.awareness.clientID;
    const list: Peer[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === own || !state || !(state as AwarenessState).user) continue;
      list.push({ ...(EMPTY_AWARENESS as AwarenessState), ...(state as AwarenessState), clientId } as Peer);
    }
    this.peersCache = list;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Стабильная ссылка до следующего изменения (для useSyncExternalStore). */
  peers(): Peer[] {
    return this.peersCache;
  }

  private patch(fields: Partial<AwarenessState>): void {
    const cur = (this.awareness.getLocalState() as AwarenessState | null) ?? EMPTY_AWARENESS;
    this.awareness.setLocalState({ ...cur, ...fields });
  }

  setCursor(cursor: AwarenessState['cursor']): void {
    this.pendingCursor = cursor;
    const wait = CURSOR_INTERVAL_MS - (Date.now() - this.lastCursorSent);
    if (wait <= 0) return this.flushCursor();
    this.cursorTimer ??= setTimeout(() => this.flushCursor(), wait);
  }

  private flushCursor(): void {
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    if (this.pendingCursor === undefined) return;
    this.lastCursorSent = Date.now();
    this.patch({ cursor: this.pendingCursor });
    this.pendingCursor = undefined;
  }

  setSelection(ids: string[]): void {
    this.patch({ selection: ids.slice(0, 1000) });
  }

  setTool(tool: string | null): void {
    this.patch({ tool });
  }

  private pendingDrawing: AwarenessState['drawing'] | undefined;
  private drawingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDrawingSent = 0;

  /**
   * Недорисованный штрих (видят другие). Не чаще ~30 раз в секунду; null
   * (штрих закончен) уходит сразу.
   */
  setDrawing(drawing: AwarenessState['drawing']): void {
    this.pendingDrawing = drawing;
    const wait = CURSOR_INTERVAL_MS - (Date.now() - this.lastDrawingSent);
    if (drawing === null || wait <= 0) return this.flushDrawing();
    this.drawingTimer ??= setTimeout(() => this.flushDrawing(), wait);
  }

  private flushDrawing(): void {
    if (this.drawingTimer) clearTimeout(this.drawingTimer);
    this.drawingTimer = null;
    if (this.pendingDrawing === undefined) return;
    this.lastDrawingSent = Date.now();
    this.patch({ drawing: this.pendingDrawing });
    this.pendingDrawing = undefined;
  }

  setLaser(laser: AwarenessState['laser']): void {
    this.patch({ laser });
  }

  setViewport(v: Viewport): void {
    this.pendingViewport = v;
    this.viewportTimer ??= setTimeout(() => {
      this.viewportTimer = null;
      if (this.pendingViewport) this.patch({ viewport: this.pendingViewport });
    }, VIEWPORT_INTERVAL_MS);
  }

  destroy(): void {
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    if (this.drawingTimer) clearTimeout(this.drawingTimer);
    this.awareness.off('change', this.onChange);
    this.listeners.clear();
  }
}

/** Участники по людям (несколько вкладок одного человека — одна строка). */
export function groupParticipants(peers: Peer[]): Participant[] {
  const byUser = new Map<string, Participant>();
  for (const p of peers) {
    const cur = byUser.get(p.user.id);
    const pageId = p.cursor?.pageId ?? p.viewport?.pageId ?? null;
    if (cur) {
      cur.connections++;
      cur.pageId ??= pageId;
    } else byUser.set(p.user.id, { user: p.user, connections: 1, pageId });
  }
  const roleOrder = { TEACHER: 0, ADMIN: 1, STUDENT: 2 } as const;
  return [...byUser.values()].sort(
    (a, b) => roleOrder[a.user.role] - roleOrder[b.user.role] || a.user.fullName.localeCompare(b.user.fullName, 'ru'),
  );
}

/**
 * Видимость курсора участника: если учитель скрыл курсоры учеников
 * (showStudentCursors = false), ученик не видит курсоры других учеников.
 * На сервере такие состояния ученикам не рассылаются с этапа 4.1; здесь —
 * та же логика на стороне клиента.
 */
export function cursorVisible(peer: Peer, viewerRole: 'owner' | 'teacher' | 'student' | 'viewer' | 'none', showStudentCursors: boolean): boolean {
  if (showStudentCursors) return true;
  if (viewerRole === 'owner' || viewerRole === 'teacher') return true;
  return peer.user.role !== 'STUDENT';
}
