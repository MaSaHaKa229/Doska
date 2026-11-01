import type { ReactNode } from 'react';
import { Group } from 'react-konva';
import { newEntityId, type BoardObject, type Point, type ToolContext, type ToolModule } from '@doska/shared';
import { isLinear, shapeModule, type ShapeKind, type ShapeProps } from '../objects/shape';
import { resolveColor } from '../objects/colors';
import type { ToolOptions } from '../store/board';

interface ShapePreview {
  start: Point;
  end: Point;
}

/** Ограничение Shift: квадрат/круг для фигур, шаг 15° для отрезков. */
export function constrain(kind: ShapeKind, start: Point, end: Point, shift: boolean): Point {
  if (!shift) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (isLinear(kind)) {
    const step = Math.PI / 12;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.hypot(dx, dy);
    return { x: start.x + Math.cos(angle) * len, y: start.y + Math.sin(angle) * len };
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + Math.sign(dx || 1) * size, y: start.y + Math.sign(dy || 1) * size };
}

function propsFrom(kind: ShapeKind, opts: ToolOptions, w: number, h: number): ShapeProps {
  return {
    kind,
    w,
    h,
    stroke: opts.stroke,
    fill: isLinear(kind) ? 'none' : opts.fill,
    strokeWidth: opts.strokeWidth,
    dash: opts.dash,
  };
}

const META: Record<ShapeKind, { title: string; icon: string; hotkey: string; keywords: string[] }> = {
  rect: { title: 'Прямоугольник', icon: 'Square', hotkey: 'R', keywords: ['прямоугольник', 'квадрат', 'фигура', 'rectangle'] },
  ellipse: { title: 'Эллипс', icon: 'Circle', hotkey: 'O', keywords: ['эллипс', 'круг', 'овал', 'окружность', 'фигура'] },
  triangle: { title: 'Треугольник', icon: 'Triangle', hotkey: 'Shift+R', keywords: ['треугольник', 'фигура'] },
  line: { title: 'Линия', icon: 'Minus', hotkey: 'L', keywords: ['линия', 'отрезок', 'прямая', 'line'] },
  arrow: { title: 'Стрелка', icon: 'MoveUpRight', hotkey: 'A', keywords: ['стрелка', 'arrow', 'указатель'] },
};

/** Инструмент рисования фигуры: протянуть от угла до угла (Shift — правильная фигура). */
export function shapeTool(kind: ShapeKind): ToolModule<ReactNode> {
  const meta = META[kind];
  let shift = false;
  return {
    id: `core.shape-${kind}`,
    title: meta.title,
    icon: meta.icon,
    group: 'shapes',
    hotkey: meta.hotkey,
    keywords: meta.keywords,
    requiresWrite: true,
    snapping: true,
    cursor: 'crosshair',
    options: [
      { kind: 'color', key: 'stroke', label: 'Цвет' },
      ...(isLinear(kind) ? [] : [{ kind: 'color' as const, key: 'fill', label: 'Заливка' }]),
      { kind: 'stroke-width', key: 'strokeWidth', label: 'Толщина' },
      { kind: 'line-style', key: 'dash', label: 'Стиль' },
    ],
    onPointerDown(e, ctx) {
      shift = e.modifiers.shift;
      ctx.setPreview({ start: e.snapped, end: e.snapped } satisfies ShapePreview);
    },
    onPointerMove(e, ctx) {
      const p = ctx.getPreview<ShapePreview>();
      if (!p) return;
      shift = e.modifiers.shift;
      ctx.setPreview({ start: p.start, end: constrain(kind, p.start, e.snapped, shift) });
    },
    onPointerUp(e, ctx) {
      const p = ctx.getPreview<ShapePreview>();
      ctx.setPreview(null);
      if (!p) return;
      const end = constrain(kind, p.start, e.snapped, e.modifiers.shift);
      let w = end.x - p.start.x;
      let h = end.y - p.start.y;
      let x = p.start.x;
      let y = p.start.y;
      const minDrag = ctx.screenToWorld(4);
      if (Math.abs(w) < minDrag && Math.abs(h) < minDrag) {
        // Щелчок без протягивания: фигура стандартного размера с центром в точке.
        if (isLinear(kind)) {
          w = ctx.screenToWorld(120);
          h = 0;
        } else {
          w = ctx.screenToWorld(120);
          h = kind === 'rect' ? ctx.screenToWorld(80) : w;
          x -= w / 2;
          y -= h / 2;
        }
      }
      const id = ctx.createObject('core.shape', { x, y, props: propsFrom(kind, ctx.getToolOptions<ToolOptions>(), w, h) });
      if (id) {
        ctx.setSelection([id]);
        ctx.activateTool('core.select');
      }
    },
    onKeyDown(key, _m, ctx) {
      if (key === 'Escape' && ctx.getPreview()) {
        ctx.setPreview(null);
        return true;
      }
      return false;
    },
    renderOverlay(ctx: ToolContext) {
      const p = ctx.getPreview<ShapePreview>();
      if (!p) return null;
      const opts = ctx.getToolOptions<ToolOptions>();
      const obj = {
        id: 'preview-' + newEntityId(6),
        x: p.start.x,
        y: p.start.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        props: propsFrom(kind, opts, p.end.x - p.start.x, p.end.y - p.start.y),
      } as BoardObject<ShapeProps>;
      const theme = ctx.resolve.theme;
      return (
        <Group x={obj.x} y={obj.y} opacity={0.8} listening={false}>
          {shapeModule.render(obj, {
            ...ctx.resolve,
            selected: false,
            hovered: false,
            viewport: { x: 0, y: 0, width: 0, height: 0 },
            resolveColor: (c) => resolveColor(c, theme),
          })}
        </Group>
      );
    },
  };
}

export const SELECT_TOOL_ID = 'core.select';
export const HAND_TOOL_ID = 'core.hand';
export const LASER_TOOL_ID = 'core.laser';

/** Выделение и перемещение (логика — в ядре холста, canvas/interaction). */
export const selectTool: ToolModule<ReactNode> = {
  id: SELECT_TOOL_ID,
  title: 'Выделение',
  icon: 'MousePointer2',
  group: 'select',
  hotkey: 'V',
  keywords: ['выделение', 'выбрать', 'курсор', 'переместить', 'select'],
  requiresWrite: false,
};

/** Перемещение по доске (то же — пробел + мышь или средняя кнопка). */
export const handTool: ToolModule<ReactNode> = {
  id: HAND_TOOL_ID,
  title: 'Рука',
  icon: 'Hand',
  group: 'select',
  hotkey: 'H',
  keywords: ['рука', 'перемещение', 'панорама', 'сдвинуть доску', 'hand'],
  requiresWrite: false,
  cursor: 'grab',
};

/**
 * Лазерная указка: след виден всем и угасает за 1,5 с, в документ ничего не
 * записывается. Ученикам доступна, если у них есть право записи и учитель
 * не выключил настройку allowStudentLaser. Нажатия обрабатывает холст.
 */
export const laserTool: ToolModule<ReactNode> = {
  id: LASER_TOOL_ID,
  title: 'Лазерная указка',
  icon: 'Zap',
  group: 'select',
  hotkey: 'K',
  keywords: ['лазер', 'указка', 'показать', 'указать', 'laser', 'pointer'],
  requiresWrite: false,
  requiresCapability: 'laser',
  cursor: 'crosshair',
};
