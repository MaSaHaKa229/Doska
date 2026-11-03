import { describe, expect, it } from 'vitest';
import type { BoardObject, ResolveContext } from '@doska/shared';
import { registry } from '../../plugins/registry';
import { drawingOf, sceneModule, sceneSvg, sceneWith, scenePropsSchema, SCENE_TYPE, type SceneProps } from './objects';
import { newBody } from './solids';

const obj = (props: SceneProps): BoardObject<SceneProps> =>
  ({ id: 's1', type: SCENE_TYPE, v: 1, pageId: 'p', x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1, z: 'a', layer: 'main', locked: false, groupId: null, deps: [], props, createdBy: 'u', createdAt: 0, updatedBy: 'u', updatedAt: 0 }) as unknown as BoardObject<SceneProps>;
const rctx = { getObject: () => undefined, getComputed: () => undefined, zoom: 1, theme: 'light' } as ResolveContext;

describe('объект «3D-сцена»', () => {
  it('плагин зарегистрирован: тип, 10 инструментов, редактор', () => {
    expect(registry.getObjectModule(SCENE_TYPE)).toBeTruthy();
    const tools = registry.listTools().filter((t) => t.id.startsWith('math.stereo.'));
    expect(tools).toHaveLength(10);
    expect(registry.listPlugins().find((p) => p.id === 'math.stereo')?.editors?.['stereo.scene']).toBeTruthy();
  });

  it('сцена по умолчанию проходит схему и вписана в рамку', () => {
    for (const k of ['cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'tcone', 'sphere'] as const) {
      const p = sceneWith(k);
      expect(scenePropsSchema.safeParse(p).success).toBe(true);
      const d = drawingOf(p);
      expect(Math.abs(d.bounds.x)).toBeLessThanOrEqual(p.w / 2);
      expect(d.bounds.x + d.bounds.width).toBeLessThanOrEqual(p.w / 2);
      expect(Math.abs(d.bounds.y)).toBeLessThanOrEqual(p.h / 2);
    }
  });

  it('больше 12 тел и неверные размеры отклоняются', () => {
    const p = sceneWith('cube');
    expect(scenePropsSchema.safeParse({ ...p, bodies: Array.from({ length: 13 }, (_, i) => newBody('cube', `b${i}`)) }).success).toBe(false);
    expect(scenePropsSchema.safeParse({ ...p, bodies: [{ ...newBody('cube', 'b1'), a: -1 }] }).success).toBe(false);
    expect(scenePropsSchema.safeParse({ ...p, bodies: [{ ...newBody('prism', 'b1'), n: 2 }] }).success).toBe(false);
  });

  it('размер сцены с 12 телами — далеко от предела 512 КБ', () => {
    const p = { ...sceneWith('cube'), bodies: Array.from({ length: 12 }, (_, i) => ({ ...newBody('prism', `b${i}`), base: Array.from({ length: 12 }, (_, k) => [Math.cos(k / 2), Math.sin(k / 2)] as [number, number]), labels: 'A'.repeat(200) })) };
    expect(JSON.stringify(p).length).toBeLessThan(40_000);
  });

  it('габарит и попадание — рамка сцены', () => {
    const o = obj(sceneWith('cube'));
    expect(sceneModule.getLocalBounds(o, rctx)).toEqual({ x: 0, y: 0, width: 360, height: 300 });
    expect(sceneModule.hitTest(o, { x: 110, y: 60 }, 1, rctx)).toBe(true);
    expect(sceneModule.hitTest(o, { x: 470, y: 60 }, 1, rctx)).toBe(false);
  });

  it('растяжение рамкой меняет рамку и масштаб чертежа, а не масштаб объекта', () => {
    const o = obj(sceneWith('cube'));
    const patch = sceneModule.applyResize!(o, 2, 1.5);
    expect(patch).toEqual({ scaleX: 1, scaleY: 1, props: { w: 720, h: 450, scale: o.props.scale * 1.5 } });
  });

  it('SVG: невидимые рёбра пунктиром, подписи вершин', () => {
    const svg = sceneSvg(sceneWith('cube'), 0, 0, 'light');
    expect(svg.match(/stroke-dasharray/g)?.length).toBeGreaterThanOrEqual(1);
    for (const l of ['A', 'B', 'C', 'D', 'A₁', 'D₁']) expect(svg).toContain(`>${l}</text>`);
    expect(sceneSvg({ ...sceneWith('cube'), hidden: 'hide' }, 0, 0, 'light')).not.toContain('stroke-dasharray');
  });

  it('чертёж кэшируется по объекту props', () => {
    const p = sceneWith('cone');
    expect(drawingOf(p)).toBe(drawingOf(p));
    expect(drawingOf({ ...p })).not.toBe(drawingOf(p));
  });
});
