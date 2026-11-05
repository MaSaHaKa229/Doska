import { useEffect } from 'react';
import type { BoardModel } from '../../collab/model';
import type { BoardSession } from '../../collab/session';
import { applySceneCameras, collectSceneCameras, subscribeSceneCameras } from '../../collab/follow';
import { cameraForViewport, cameraToViewport, lerpCamera, type Size } from '../../canvas/camera';
import { currentCamera, isFollowing, useBoard } from '../../store/board';

const FOLLOW_SEND_INTERVAL_MS = 1000 / 15;
const FOLLOW_ANIMATION_MS = 150;

/**
 * Ученик: вид следует за учителем. Та же мировая область вписывается в
 * окно ученика (центр сохраняется), переход анимируется за 150 мс; при
 * смене страницы — сразу. Если ученик отошёл (нестрогий показ), вид не
 * трогается до нажатия «Вернуться к учителю».
 */
export function useFollowView(model: BoardModel, sizeRef: React.MutableRefObject<Size>): void {
  useEffect(() => {
    let raf = 0;
    const apply = (animate: boolean) => {
      const s = useBoard.getState();
      if (!s.follow || !isFollowing(s) || s.followDetached) return;
      const v = s.follow.viewport;
      if (!model.page(v.pageId)) return; // страница ещё не пришла — применим после синхронизации
      applySceneCameras(s.follow.scenes);
      const target = cameraForViewport(v, sizeRef.current);
      const samePage = s.pageId === v.pageId;
      if (!samePage) s.setPage(v.pageId, 'system');
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!animate || !samePage) {
        useBoard.getState().setCamera(target, 'system');
        return;
      }
      const from = currentCamera();
      const start = performance.now();
      const step = () => {
        const t = (performance.now() - start) / FOLLOW_ANIMATION_MS;
        useBoard.getState().setCamera(lerpCamera(from, target, t), 'system');
        raf = t < 1 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };

    const unsub = useBoard.subscribe((s, prev) => {
      if (s.follow !== prev.follow || s.followDetached !== prev.followDetached || s.caps !== prev.caps || s.synced !== prev.synced) {
        apply(s.follow?.viewport.pageId === prev.follow?.viewport.pageId && !prev.followDetached);
      }
    });
    const unsubPages = model.subscribePages(() => apply(false));
    const onResize = () => apply(false);
    window.addEventListener('resize', onResize);
    apply(false);
    return () => {
      unsub();
      unsubPages();
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [model, sizeRef]);
}

/**
 * Учитель, ведущий показ: при каждом изменении вида (страница, камера,
 * камеры 3D-сцен) отправляет follow.update — не чаще 15 раз в секунду,
 * последнее изменение не теряется.
 */
export function useFollowLead(session: BoardSession, sizeRef: React.MutableRefObject<Size>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const leading = () => {
      const s = useBoard.getState();
      return !!s.follow && s.follow.leaderId === s.userId && !!s.pageId;
    };
    const send = () => {
      timer = null;
      const s = useBoard.getState();
      if (!leading()) return;
      last = performance.now();
      session.send({ t: 'follow.update', viewport: cameraToViewport(currentCamera(), sizeRef.current, s.pageId!), scenes: collectSceneCameras() });
    };
    const schedule = () => {
      if (!leading() || timer) return;
      const wait = FOLLOW_SEND_INTERVAL_MS - (performance.now() - last);
      timer = setTimeout(send, Math.max(0, wait));
    };
    const unsub = useBoard.subscribe((s, prev) => {
      if (s.pageId !== prev.pageId || s.cameras !== prev.cameras) schedule();
    });
    const unsubScenes = subscribeSceneCameras(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      unsub();
      unsubScenes();
      window.removeEventListener('resize', schedule);
      if (timer) clearTimeout(timer);
    };
  }, [session, sizeRef]);
}

/** Начать показ с текущего вида. */
export function startFollow(session: BoardSession, sizeRef: React.MutableRefObject<Size>, strict: boolean): void {
  const s = useBoard.getState();
  if (!s.pageId) return;
  session.send({ t: 'follow.start', viewport: cameraToViewport(currentCamera(), sizeRef.current, s.pageId), strict });
}
