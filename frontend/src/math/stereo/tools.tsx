import type { ReactNode } from 'react';
import { Text } from 'react-konva';
import type { BoardObject, Point, ToolContext, ToolModule } from '@doska/shared';
import { requestObjectEditor } from '../../tools/formula-tools';
import { toast } from '../../store/toast';
import { POINT_TYPE } from '../planimetry/eval';
import { figureType, pointModule, type FigureProps, type PointProps } from '../planimetry/objects';
import { PLUGIN_ID, SCENE_EDITOR, SCENE_TYPE, sceneWith, viewOf, type SceneProps } from './objects';
import { BODY_TITLES, keyPoints, projection, sceneCenter, type Body, type BodyKind } from './solids';
import { netOf } from './net';
import { NET_TYPE, netModule, type NetProps } from './nets';
import { flatDrawing } from './flat';

const section = PLUGIN_ID;

const ICONS: Record<BodyKind, string> = {
  cube: 'Box',
  box: 'Cuboid',
  prism: 'Hexagon',
  pyramid: 'Pyramid',
  frustum: 'Triangle',
  cylinder: 'Cylinder',
  cone: 'Cone',
  tcone: 'Database',
  sphere: 'Globe',
};

const KEYWORDS: Record<BodyKind, string[]> = {
  cube: ['куб', 'гексаэдр', 'abcda1b1c1d1'],
  box: ['параллелепипед', 'прямоугольный параллелепипед', 'кирпич', 'брусок'],
  prism: ['призма', 'треугольная призма', 'шестиугольная призма', 'наклонная призма'],
  pyramid: ['пирамида', 'четырёхугольная пирамида', 'тетраэдр', 'правильная пирамида'],
  frustum: ['усечённая пирамида', 'усеченная пирамида'],
  cylinder: ['цилиндр', 'тело вращения'],
  cone: ['конус', 'тело вращения'],
  tcone: ['усечённый конус', 'усеченный конус', 'ведро'],
  sphere: ['шар', 'сфера', 'тело вращения'],
};

/** Инструмент тела: щелчок ставит сцену с телом (центр — в точке щелчка). */
function bodyTool(kind: BodyKind, openEditor = false, title = BODY_TITLES[kind]): ToolModule<ReactNode> {
  return {
    id: openEditor ? `${PLUGIN_ID}.scene` : `${PLUGIN_ID}.${kind}`,
    title,
    icon: openEditor ? 'Rotate3d' : ICONS[kind],
    group: 'math',
    section,
    keywords: openEditor ? ['3d', '3д', 'трёхмерная сцена', 'объёмное тело', 'стереометрия', 'пространство'] : [...KEYWORDS[kind], 'стереометрия', '3d'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const props = sceneWith(kind);
      const id = ctx.createObject<SceneProps>(SCENE_TYPE, { x: e.world.x - props.w / 2, y: e.world.y - props.h / 2, props });
      ctx.activateTool('core.select');
      if (!id) return;
      ctx.setSelection([id]);
      if (openEditor) requestObjectEditor({ editor: SCENE_EDITOR, id, at: e.world });
    },
  };
}

/** Сцена под курсором. */
const sceneAt = (ctx: ToolContext, at: Point) => ctx.hitTest(at, ctx.screenToWorld(4)).find((o) => o.type === SCENE_TYPE) as BoardObject<SceneProps> | undefined;

/** Тело сцены, ближайшее к точке щелчка на чертеже (по центру его характерных точек). */
export function bodyAt(scene: BoardObject<SceneProps>, at: Point, filter: (b: Body) => boolean = () => true): Body | null {
  const p = scene.props;
  const proj = projection(viewOf(p), sceneCenter(p.bodies as Body[]));
  const lx = at.x - scene.x - p.w / 2;
  const ly = at.y - scene.y - p.h / 2;
  let best: { d: number; b: Body } | null = null;
  for (const b of p.bodies as Body[]) {
    if (!filter(b)) continue;
    const pts = keyPoints(b).map((k) => proj.project(k.p));
    const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
    const d = Math.hypot(c.x - lx, c.y - ly);
    if (!best || d < best.d) best = { d, b };
  }
  return best?.b ?? null;
}

/** Подсказка у курсора для инструментов, которые применяются к сцене. */
function hintOverlay(text: string) {
  return (ctx: ToolContext) => {
    const p = ctx.getPreview<Point>();
    if (!p) return null;
    const w = ctx.screenToWorld(1);
    return <Text x={p.x + 14 * w} y={p.y + 14 * w} text={text} fontSize={13 * w} fill="#2a7de1" listening={false} />;
  };
}

const netTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.net`,
  title: 'Развёртка',
  icon: 'PanelsTopLeft',
  group: 'math',
  section,
  keywords: ['развёртка', 'развертка', 'поверхность', 'площадь поверхности', 'стереометрия'],
  requiresWrite: true,
  cursor: 'pointer',
  onPointerMove: (e, ctx) => ctx.setPreview(e.world),
  onDeactivate: (ctx) => ctx.setPreview(null),
  renderOverlay: hintOverlay('Развёртка: щёлкните по телу в 3D-сцене'),
  onPointerDown(e, ctx) {
    const scene = sceneAt(ctx, e.world);
    if (!scene) return;
    const body = bodyAt(scene, e.world, (b) => !!netOf(b));
    if (!body) {
      toast.info('У шара развёртки нет');
      return;
    }
    const props: NetProps = { ...netModule.createProps(), body: body.id, fill: body.fill };
    const id = ctx.createObject<NetProps>(NET_TYPE, { x: scene.x + scene.props.w + 40, y: scene.y, props, deps: [scene.id] });
    ctx.activateTool('core.select');
    if (id) ctx.setSelection([id]);
  },
};

const flatTool: ToolModule<ReactNode> = {
  id: `${PLUGIN_ID}.flat`,
  title: 'Плоский чертёж',
  icon: 'PenLine',
  group: 'math',
  section,
  keywords: ['плоский чертёж', 'плоский чертеж', 'снимок сцены', 'чертёж из 3d', 'проекция'],
  requiresWrite: true,
  cursor: 'pointer',
  onPointerMove: (e, ctx) => ctx.setPreview(e.world),
  onDeactivate: (ctx) => ctx.setPreview(null),
  renderOverlay: hintOverlay('Плоский чертёж: щёлкните по 3D-сцене'),
  onPointerDown(e, ctx) {
    const scene = sceneAt(ctx, e.world);
    if (!scene) return;
    // Под сценой (справа обычно встаёт развёртка), в том же масштабе и виде.
    const flat = flatDrawing(scene.props, scene.x, scene.y + scene.props.h + 40);
    const created: string[] = [];
    ctx.transact(() => {
      const ids = flat.points.map((p) => {
        const props: PointProps = { ...pointModule.createProps(), label: p.label, color: 'ink', auto: false, ...(p.ghost ? { ghost: true } : {}) };
        const id = ctx.createObject<PointProps>(POINT_TYPE, { x: p.x, y: p.y, props });
        if (id && !p.ghost) created.push(id);
        return id;
      });
      for (const l of flat.lines) {
        const deps = l.pts.map((i) => ids[i]!).filter(Boolean);
        if (deps.length < 2) continue;
        const name = l.curve ? (l.closed ? 'polygon' : 'polyline') : 'segment';
        const props: FigureProps = {
          color: l.color,
          width: l.dashed ? 1.5 : 2,
          dash: l.dashed ? 'dashed' : 'solid',
          label: '',
          fill: false,
          fb: l.pts.flatMap((i) => [flat.points[i]!.x, flat.points[i]!.y]),
        };
        const id = ctx.createObject<FigureProps>(figureType(name), { x: 0, y: 0, props, deps });
        if (id) created.push(id);
      }
    });
    ctx.activateTool('core.select');
    ctx.setSelection(created);
  },
};

export const stereoTools: ToolModule<ReactNode>[] = [
  bodyTool('cube', true, '3D-сцена'),
  ...(['cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'tcone', 'sphere'] as const).map((k) => bodyTool(k)),
  netTool,
  flatTool,
];
