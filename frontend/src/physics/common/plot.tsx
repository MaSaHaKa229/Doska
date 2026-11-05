import { Arrow, Circle, Group, Line, Shape, Text } from 'react-konva';
import { useBoard } from '../../store/board';
import { fmt } from './quantities';

const useZoom = () => useBoard((s) => (s.pageId && s.cameras[s.pageId]?.zoom) || 1);

const raw = (c: unknown) => (c as { _context: CanvasRenderingContext2D })._context;
const italic = { fontStyle: 'italic', fontFamily: 'Times New Roman, serif' } as const;

export interface PlotCurve {
  pts: [number, number][];
  color: string;
  dash?: boolean;
  /** Стрелка направления процесса посередине кривой. */
  arrow?: boolean;
  width?: number;
}

export interface PlotPoint {
  x: number;
  y: number;
  label?: string;
  color: string;
  /** Пунктирные проекции на оси и подписи значений на осях. */
  guides?: boolean;
  xText?: string;
  yText?: string;
}

export interface PlotProps {
  x: number;
  y: number;
  w: number;
  h: number;
  xMin?: number;
  xMax: number;
  yMin?: number;
  yMax: number;
  curves: PlotCurve[];
  /** Закрашенные области (работа газа, площадь цикла). */
  fills?: { pts: [number, number][]; color: string }[];
  points?: PlotPoint[];
  xLabel: string;
  yLabel: string;
  ink: string;
  /** Подпись нуля в начале координат. */
  origin?: boolean;
}

/** Диаграмма по точкам (параметрические кривые): оси от min до max, закраски, отмеченные точки с проекциями. */
export function Plot({ x, y, w, h, xMin = 0, xMax, yMin = 0, yMax, curves, fills = [], points = [], xLabel, yLabel, ink, origin = true }: PlotProps) {
  const zoom = useZoom();
  const X = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * w;
  const Y = (v: number) => h - ((v - yMin) / (yMax - yMin || 1)) * h;
  // Оси проходят через ноль, если он в пределах, иначе по краю.
  const ax = yMin < 0 && yMax > 0 ? Y(0) : h;
  const ay = xMin < 0 && xMax > 0 ? X(0) : 0;
  const path = (pts: [number, number][]) => pts.flatMap(([a, b]) => [X(a), Y(b)]);
  return (
    <Group x={x} y={y} listening={false}>
      {fills.map((f, i) => (
        <Line key={i} points={path(f.pts)} closed fill={f.color} opacity={0.22} listening={false} />
      ))}
      <Arrow points={[0, ax, w + 16, ax]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
      <Arrow points={[ay, h, ay, -14]} stroke={ink} fill={ink} strokeWidth={1.2} strokeScaleEnabled={false} pointerLength={8 / zoom} pointerWidth={6 / zoom} listening={false} />
      <Text x={w + 8} y={ax + 4} text={xLabel} fontSize={15} {...italic} fill={ink} listening={false} />
      <Text x={ay + 8} y={-18} text={yLabel} fontSize={15} {...italic} fill={ink} listening={false} />
      {origin && <Text x={ay - 12} y={ax + 3} text="0" fontSize={13} fill={ink} listening={false} />}
      {curves.map((c, i) => (
        <Group key={i}>
          <Line points={path(c.pts)} stroke={c.color} strokeWidth={c.width ?? 2} dash={c.dash ? [6 / zoom, 4 / zoom] : undefined} strokeScaleEnabled={false} lineJoin="round" listening={false} />
          {c.arrow && c.pts.length > 2 && <MidArrow pts={c.pts.map(([a, b]) => [X(a), Y(b)] as [number, number])} color={c.color} />}
        </Group>
      ))}
      {points.map((p, i) => (
        <Group key={i}>
          {p.guides && <Line points={[ay, Y(p.y), X(p.x), Y(p.y), X(p.x), ax]} stroke={ink} opacity={0.45} strokeWidth={1} dash={[3 / zoom, 3 / zoom]} strokeScaleEnabled={false} listening={false} />}
          {p.guides && p.xText && <Text x={X(p.x) - 30} y={ax + 4} width={60} align="center" text={p.xText} fontSize={12} fill={ink} listening={false} />}
          {p.guides && p.yText && <Text x={ay - 66} y={Y(p.y) - 6} width={60} align="right" text={p.yText} fontSize={12} fill={ink} listening={false} />}
          <Circle x={X(p.x)} y={Y(p.y)} radius={4.5} fill={p.color} listening={false} />
          {p.label && <Text x={X(p.x) + 6} y={Y(p.y) - 18} text={p.label} fontSize={15} {...italic} fill={p.color} listening={false} />}
        </Group>
      ))}
    </Group>
  );
}

/** Стрелка в середине ломаной (по длине). */
function MidArrow({ pts, color }: { pts: [number, number][]; color: string }) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const d = Math.hypot(bx - ax, by - ay);
    if (acc + d >= total / 2 && d > 0) {
      const f = (total / 2 - acc) / d;
      const mx = ax + (bx - ax) * f;
      const my = ay + (by - ay) * f;
      const ux = (bx - ax) / d;
      const uy = (by - ay) / d;
      return (
        <Shape
          sceneFunc={(c, shape) => {
            const g = raw(c);
            g.beginPath();
            g.moveTo(mx + ux * 7, my + uy * 7);
            g.lineTo(mx - ux * 6 - uy * 5, my - uy * 6 + ux * 5);
            g.lineTo(mx - ux * 6 + uy * 5, my - uy * 6 - ux * 5);
            g.closePath();
            c.fillShape(shape);
          }}
          fill={color}
          listening={false}
        />
      );
    }
    acc += d;
  }
  return null;
}

/** Деления шкалы: «красивый» шаг для отрезка [0, max]. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

export const valueText = (v: number) => fmt(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
