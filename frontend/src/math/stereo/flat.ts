import { keyPoints, projection, sceneCenter, type Body } from './solids';
import { pointPositions } from './space';
import { drawingOf, viewOf, type SceneProps } from './objects';

/**
 * «Плоский чертёж» (этап 6.4b): снимок сцены в текущем виде обычными
 * объектами планиметрии — точками с подписями и отрезками (невидимые —
 * пунктиром); кривые (окружности оснований, очертание шара) — ломаными на
 * невидимых опорных точках. Дальше чертёж правят инструментами планиметрии.
 */

export interface FlatPoint {
  x: number;
  y: number;
  label: string;
  /** Опора без подписи (конец куска, точка кривой): не рисуется. */
  ghost: boolean;
}

export interface FlatDrawing {
  points: FlatPoint[];
  /** Отрезки и ломаные — индексы точек. */
  lines: { pts: number[]; dashed: boolean; color: string; curve: boolean; closed?: boolean }[];
}

/** Не больше точек на одну кривую (предел опор объекта — 64). */
const MAX_CURVE = 40;

export function flatDrawing(p: SceneProps, ox: number, oy: number): FlatDrawing {
  const d = drawingOf(p);
  const cx = ox + p.w / 2;
  const cy = oy + p.h / 2;
  const points: FlatPoint[] = [];
  const index = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const pointAt = (x: number, y: number, label = '', ghost = true) => {
    const k = key(x, y);
    const i = index.get(k);
    if (i !== undefined) {
      if (label && !points[i]!.label) Object.assign(points[i]!, { label, ghost: false });
      return i;
    }
    points.push({ x, y, label, ghost: ghost && !label });
    index.set(k, points.length - 1);
    return points.length - 1;
  };

  // Подписанные точки — первыми: вершины тел и точки построений.
  const proj = projection(viewOf(p), sceneCenter(p.bodies as Body[]));
  for (const b of p.bodies as Body[]) {
    if (!b.showLabels) continue;
    for (const k of keyPoints(b)) {
      const q = proj.project(k.p);
      pointAt(cx + q.x, cy + q.y, k.name, false);
    }
  }
  const pos = pointPositions(p as never);
  for (const sp of p.points) {
    const v = pos.get(sp.id);
    if (!v) continue;
    const q = proj.project(v);
    pointAt(cx + q.x, cy + q.y, sp.name, false);
  }

  const lines: FlatDrawing['lines'] = [];
  for (const l of d.lines) {
    const n = l.pts.length / 2;
    const at = (i: number) => [cx + l.pts[2 * i]!, cy + l.pts[2 * i + 1]!] as const;
    if (n <= 6) {
      // Отрезки (несколько рёбер одного вида, склеенные в ломаную) — по одному.
      for (let i = 0; i + 1 < n; i++) {
        const a = at(i);
        const b = at(i + 1);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue;
        lines.push({ pts: [pointAt(a[0], a[1]), pointAt(b[0], b[1])], dashed: l.hidden, color: l.color, curve: false });
      }
      continue;
    }
    // Кривая: прореживание до MAX_CURVE точек, концы сохраняются.
    const step = Math.max(1, Math.ceil((n - 1) / (MAX_CURVE - 1)));
    const idx: number[] = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const pts = idx.map((i) => pointAt(...at(i)));
    // Замкнутая кривая (окружность целиком видна): многоугольник без повтора первой точки.
    const closed = pts.length > 3 && pts[0] === pts[pts.length - 1];
    lines.push({ pts: closed ? pts.slice(0, -1) : pts, dashed: l.hidden, color: l.color, curve: true, ...(closed ? { closed } : {}) });
  }
  return { points, lines };
}
