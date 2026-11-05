import type { Scene3dCamera } from '@doska/shared';

/**
 * Камеры 3D-сцен для «Следуйте за мной». Объект-сцена (этап 6.4 и разделы
 * физики) регистрирует здесь, как прочитать и как установить свою камеру,
 * и сообщает об её изменении. Ведущий отправляет камеры всех
 * зарегистрированных сцен вместе с видом доски, ученик применяет их к
 * сценам с теми же id.
 */
export interface SceneCameraBinding {
  get(): Omit<Scene3dCamera, 'objectId'>;
  set(camera: Omit<Scene3dCamera, 'objectId'>): void;
}

const bindings = new Map<string, SceneCameraBinding>();
const listeners = new Set<() => void>();

export function registerSceneCamera(objectId: string, binding: SceneCameraBinding): () => void {
  bindings.set(objectId, binding);
  return () => {
    if (bindings.get(objectId) === binding) bindings.delete(objectId);
  };
}

/** Камера сцены изменилась (пользователь повернул сцену). */
export function notifySceneCamera(): void {
  listeners.forEach((l) => l());
}

export function subscribeSceneCameras(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Камеры всех открытых сцен (не более 16 — предел протокола). */
export function collectSceneCameras(): Scene3dCamera[] {
  return [...bindings.entries()].slice(0, 16).map(([objectId, b]) => ({ objectId, ...b.get() }));
}

export function applySceneCameras(cameras: readonly Scene3dCamera[]): void {
  for (const { objectId, ...cam } of cameras) bindings.get(objectId)?.set(cam);
}
