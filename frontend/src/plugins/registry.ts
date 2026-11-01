import type { ReactNode } from 'react';
import { PluginRegistry, type BoardPlugin } from '@doska/shared';
import { shapeModule } from '../objects/shape';
import { groupModule } from '../objects/group';
import { handTool, laserTool, selectTool, shapeTool } from '../tools/shape-tools';
import { eraserTool, markerTool, penTool } from '../tools/draw-tools';
import { strokeModule } from '../objects/stroke/stroke';
import { imageModule } from '../objects/image';
import { textModule } from '../objects/text';
import { textTool } from '../tools/text-tool';
import { mediaTool } from '../tools/media-tool';

/**
 * Базовый плагин ядра: выделение, рука, лазер, перо, маркер, ластик,
 * группа, фигуры и рукописные штрихи. Текст, картинки и формулы — этапы 5.2–5.3,
 * разделы математики и физики — плагинами в src/math и src/physics.
 */
export const corePlugin: BoardPlugin<ReactNode> = {
  id: 'core',
  title: 'Основные',
  objects: [shapeModule, groupModule, strokeModule, imageModule, textModule],
  tools: [selectTool, handTool, laserTool, penTool, markerTool, eraserTool, ...(['rect', 'ellipse', 'triangle', 'line', 'arrow'] as const).map(shapeTool), textTool, mediaTool],
};

/**
 * Разделы-плагины находятся автоматически: любой файл plugin.ts в
 * src/math/** и src/physics/** (экспорт по умолчанию — BoardPlugin)
 * регистрируется без изменений ядра. Порядок учитывает dependsOn.
 */
const discovered = import.meta.glob<{ default: BoardPlugin<ReactNode> }>(['/src/math/**/plugin.ts', '/src/physics/**/plugin.ts'], {
  eager: true,
});

export function orderByDependencies(plugins: BoardPlugin<ReactNode>[], registered: Set<string>): BoardPlugin<ReactNode>[] {
  const result: BoardPlugin<ReactNode>[] = [];
  const pending = [...plugins];
  const done = new Set(registered);
  while (pending.length) {
    const i = pending.findIndex((p) => (p.dependsOn ?? []).every((d) => done.has(d)));
    if (i < 0) {
      throw new Error(`Не удалось разрешить зависимости плагинов: ${pending.map((p) => p.id).join(', ')}`);
    }
    const [p] = pending.splice(i, 1);
    result.push(p!);
    done.add(p!.id);
  }
  return result;
}

function createRegistry(): PluginRegistry<ReactNode> {
  const registry = new PluginRegistry<ReactNode>();
  registry.register(corePlugin);
  const plugins = Object.values(discovered).map((m) => m.default);
  for (const p of orderByDependencies(plugins, new Set(['core']))) registry.register(p);
  for (const w of registry.warnings) console.warn(w.message);
  return registry;
}

export const registry = createRegistry();
