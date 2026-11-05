import { useCallback, useSyncExternalStore } from 'react';
import { assetUrl } from '@doska/shared';

export interface CachedImage {
  status: 'loading' | 'ready' | 'error';
  img: HTMLImageElement;
}

const cache = new Map<string, CachedImage>();
const listeners = new Map<string, Set<() => void>>();

function notify(id: string): void {
  listeners.get(id)?.forEach((l) => l());
}

/**
 * Картинка файла доски: загружается один раз на вкладку (браузер её
 * кэширует), объекты с тем же файлом используют один элемент <img>.
 */
export function getAssetImage(assetId: string): CachedImage {
  let entry = cache.get(assetId);
  if (entry) return entry;
  const img = new Image();
  img.decoding = 'async';
  entry = { status: 'loading', img };
  cache.set(assetId, entry);
  img.onload = () => {
    cache.set(assetId, { status: 'ready', img });
    notify(assetId);
  };
  img.onerror = () => {
    cache.set(assetId, { status: 'error', img });
    notify(assetId);
  };
  img.src = assetUrl(assetId);
  return entry;
}

export function useAssetImage(assetId: string): CachedImage {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(assetId);
      if (!set) listeners.set(assetId, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },
    [assetId],
  );
  return useSyncExternalStore(subscribe, () => getAssetImage(assetId));
}

/** Сразу положить в кэш уже загруженную картинку (после вставки — без повторной загрузки). */
export function primeAssetImage(assetId: string, img: HTMLImageElement): void {
  if (img.complete && img.naturalWidth) {
    cache.set(assetId, { status: 'ready', img });
    notify(assetId);
  }
}
