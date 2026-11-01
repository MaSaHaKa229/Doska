import { Suspense, lazy, type ReactNode } from 'react';
import { useOnScreen } from '../lib/onScreen';

// Отрисовка миниатюр тянет Konva и модули объектов — они грузятся отдельным
// чанком только там, где миниатюры видны.
const SnapshotThumb = lazy(() => import('../canvas/BoardThumbnail').then((m) => ({ default: m.SnapshotThumb })));
const LiveThumb = lazy(() => import('../canvas/BoardThumbnail').then((m) => ({ default: m.LiveThumb })));

interface ThumbProps {
  boardId: string;
  width: number;
  height: number;
  /** Что показать, пока миниатюры нет (иконка). */
  placeholder?: ReactNode;
}

function Frame({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <div className="thumb-frame" style={{ width: '100%', aspectRatio: `${width} / ${height}` }}>
      {children}
    </div>
  );
}

/** Миниатюра доски в списке: загружается, когда карточка на экране; обновляется после изменений доски. */
export function BoardSnapshotThumb({ boardId, version, width, height, placeholder }: ThumbProps & { version: string }) {
  const [ref, visible] = useOnScreen<HTMLDivElement>();
  return (
    <div ref={ref} className="thumb-host">
      <Frame width={width} height={height}>
        {visible ? (
          <Suspense fallback={placeholder}>
            <SnapshotThumb boardId={boardId} version={version} width={width} height={height} />
          </Suspense>
        ) : (
          placeholder
        )}
      </Frame>
    </div>
  );
}

/** Живая миниатюра работы: подписка открыта, только пока карточка на экране. */
export function BoardLiveThumb({ boardId, width, height, placeholder }: ThumbProps) {
  const [ref, visible] = useOnScreen<HTMLDivElement>();
  return (
    <div ref={ref} className="thumb-host">
      <Frame width={width} height={height}>
        {visible ? (
          <Suspense fallback={placeholder}>
            <LiveThumb boardId={boardId} width={width} height={height} />
          </Suspense>
        ) : (
          placeholder
        )}
      </Frame>
    </div>
  );
}
