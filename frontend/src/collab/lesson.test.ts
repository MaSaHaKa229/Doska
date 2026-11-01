import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardCapabilities, FollowState } from '@doska/shared';
import { cameraForViewport, cameraToViewport, lerpCamera } from '../canvas/camera';
import { LASER_FADE_MS, LASER_MAX_POINTS, LaserPointer, LaserTrail, laserAlpha } from './laser';
import { isFollowing, useBoard } from '../store/board';
import { toolUnavailable } from '../tools/availability';

const caps = (over: Partial<BoardCapabilities> = {}): BoardCapabilities => ({
  role: 'student',
  view: true,
  write: true,
  noWriteReason: null,
  moderate: false,
  manageLesson: false,
  managePages: false,
  editOthers: false,
  editTeacherObjects: false,
  laser: true,
  leadFollow: false,
  clearStudentObjects: false,
  restoreVersions: false,
  raiseHand: true,
  ...over,
});

describe('«Следуйте за мной»: вид', () => {
  it('ученик видит ту же мировую область в окне другого размера', () => {
    const teacher = { cx: 100, cy: 50, zoom: 2 };
    const v = cameraToViewport(teacher, { width: 1600, height: 900 }, 'p1');
    expect(v).toMatchObject({ pageId: 'p1', centerX: 100, centerY: 50, zoom: 2, w: 800, h: 450 });
    // Узкое окно: область вписывается по ширине, центр тот же.
    const cam = cameraForViewport(v, { width: 400, height: 900 });
    expect(cam).toEqual({ cx: 100, cy: 50, zoom: 0.5 });
    // Старый клиент без размера области — масштаб ведущего.
    expect(cameraForViewport({ pageId: 'p1', centerX: 1, centerY: 2, zoom: 3 }, { width: 10, height: 10 })).toEqual({ cx: 1, cy: 2, zoom: 3 });
  });

  it('анимация перехода: концы точные, масштаб меняется равномерно по логарифму', () => {
    const a = { cx: 0, cy: 0, zoom: 1 };
    const b = { cx: 10, cy: -10, zoom: 4 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    expect(lerpCamera(a, b, 1)).toEqual(b);
    expect(lerpCamera(a, b, 0.5).zoom).toBeCloseTo(2);
    expect(lerpCamera(a, b, 2)).toEqual(b);
  });
});

describe('«Следуйте за мной»: блокировка вида', () => {
  const follow = (strict: boolean): FollowState => ({
    leaderId: 'teacher',
    leaderName: 'Учитель',
    viewport: { pageId: 'p1', centerX: 0, centerY: 0, zoom: 1 },
    scenes: [],
    strict,
  });
  const setup = (strict: boolean) => {
    const s = useBoard.getState();
    s.reset();
    s.setUserId('student');
    s.setCaps(caps());
    s.setPage('p1');
    s.setFollow(follow(strict));
  };
  afterEach(() => useBoard.getState().reset());

  it('строгий показ: ученик не может сам двигать вид и менять страницу', () => {
    setup(true);
    const s = useBoard.getState();
    expect(isFollowing(s)).toBe(true);
    s.setCamera({ cx: 5, cy: 5, zoom: 2 });
    s.setPage('p2');
    expect(useBoard.getState().cameras.p1).toBeUndefined();
    expect(useBoard.getState().pageId).toBe('p1');
    // Приложение (применение вида учителя) — может.
    s.setCamera({ cx: 1, cy: 1, zoom: 1 }, 'system');
    expect(useBoard.getState().cameras.p1).toEqual({ cx: 1, cy: 1, zoom: 1 });
  });

  it('нестрогий показ: движение означает «отойти», новый показ возвращает к учителю', () => {
    setup(false);
    useBoard.getState().setCamera({ cx: 5, cy: 5, zoom: 2 });
    expect(useBoard.getState().followDetached).toBe(true);
    expect(useBoard.getState().cameras.p1).toEqual({ cx: 5, cy: 5, zoom: 2 });
    // Обновление того же показа не возвращает…
    useBoard.getState().setFollow({ ...follow(false), viewport: { pageId: 'p1', centerX: 9, centerY: 9, zoom: 1 } });
    expect(useBoard.getState().followDetached).toBe(true);
    // …а окончание показа и новый — возвращают.
    useBoard.getState().setFollow(null);
    useBoard.getState().setFollow(follow(false));
    expect(useBoard.getState().followDetached).toBe(false);
  });

  it('учитель (ведущий или соведущий) за показом не следует', () => {
    setup(true);
    useBoard.getState().setCaps(caps({ role: 'teacher', leadFollow: true }));
    expect(isFollowing(useBoard.getState())).toBe(false);
    useBoard.getState().setCamera({ cx: 3, cy: 3, zoom: 1 });
    expect(useBoard.getState().cameras.p1).toEqual({ cx: 3, cy: 3, zoom: 1 });
  });
});

describe('лазерная указка', () => {
  it('след хранит не больше 400 точек и угасает за 1,5 с', () => {
    const t = new LaserTrail();
    t.begin('p1', 1000);
    for (let i = 0; i < LASER_MAX_POINTS + 50; i++) t.add({ x: i, y: 0 }, 1000 + i);
    expect(t.points.length).toBe(LASER_MAX_POINTS * 3);
    expect(t.points[0]).toBe(50);
    expect(t.prune(1000 + 449 + LASER_FADE_MS - 1)).toBe(true); // старые точки ушли
    expect(t.state).not.toBeNull();
    t.prune(1000 + 449 + LASER_FADE_MS + 1);
    expect(t.state).toBeNull();
    expect(t.pageId).toBeNull();
  });

  it('прозрачность считается от последней точки и времени её получения', () => {
    expect(laserAlpha(100, 100, 0)).toBe(1);
    expect(laserAlpha(100, 100 + LASER_FADE_MS / 2, 0)).toBeCloseTo(0.5);
    expect(laserAlpha(100, 100, LASER_FADE_MS)).toBe(0);
  });

  it('указка публикует след не чаще ~30 раз в секунду и null после угасания', () => {
    vi.useFakeTimers();
    let now = 0;
    const published: unknown[] = [];
    const lp = new LaserPointer((s) => published.push(s), () => now);
    lp.down('p1', { x: 0, y: 0 });
    for (let i = 1; i <= 10; i++) {
      now += 5;
      lp.move({ x: i, y: i });
    }
    expect(published.length).toBe(1);
    now += 40;
    vi.advanceTimersByTime(40);
    expect(published.length).toBe(2);
    lp.up();
    now += LASER_FADE_MS + 200;
    vi.advanceTimersByTime(LASER_FADE_MS + 200);
    expect(published.at(-1)).toBeNull();
    lp.destroy();
    vi.useRealTimers();
  });

  it('инструмент недоступен без права laser, с подсказкой', () => {
    const laserTool = { requiresWrite: false, requiresCapability: 'laser' as const };
    expect(toolUnavailable(laserTool, caps())).toBeNull();
    expect(toolUnavailable(laserTool, caps({ laser: false }))).toMatch(/Лазерная указка/);
    expect(toolUnavailable({ requiresWrite: true }, caps({ write: false, noWriteReason: 'lecture-mode' }))).toMatch(/Лекция/);
  });
});
