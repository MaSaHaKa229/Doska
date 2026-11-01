import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PluginRegistry, normalizeSearchText } from './registry.js';
import type { BoardPlugin, ObjectModule, ToolModule } from './types.js';

function objectModule(type: string): ObjectModule {
  return {
    type,
    title: type,
    version: 1,
    propsSchema: z.record(z.any()),
    createProps: () => ({}),
    serialize: (o) => o,
    deserialize: (o) => o,
    getLocalBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    hitTest: () => false,
    getHandles: () => [],
    render: () => null,
  };
}

function tool(id: string, title: string, keywords: string[], hotkey?: string): ToolModule {
  return { id, title, icon: 'Circle', group: 'physics', keywords, requiresWrite: true, hotkey };
}

const optics: BoardPlugin = {
  id: 'physics.optics',
  title: 'Оптика',
  objects: [objectModule('physics.optics.lens')],
  tools: [
    tool('physics.optics.lens', 'Собирающая линза', ['линза', 'оптика', 'фокус'], 'Shift+L'),
    tool('physics.optics.mirror', 'Зеркало', ['отражение']),
  ],
};
const circuits: BoardPlugin = {
  id: 'physics.circuits',
  title: 'Электрические цепи',
  tools: [tool('physics.circuits.capacitor', 'Конденсатор', ['ёмкость', 'обкладки'], 'Shift+L')],
};
const linalg: BoardPlugin = {
  id: 'math.linalg',
  title: 'Линейная алгебра',
  tools: [tool('math.linalg.matrix', 'Матрица', ['определитель', 'гаусс'])],
};

describe('PluginRegistry', () => {
  it('регистрирует плагины и ищет по Ctrl+K', () => {
    const r = new PluginRegistry();
    r.register(optics);
    r.register(circuits);
    r.register(linalg);
    expect(r.search('линза')[0]?.id).toBe('physics.optics.lens');
    expect(r.search('конденс')[0]?.id).toBe('physics.circuits.capacitor');
    expect(r.search('матрица')[0]?.id).toBe('math.linalg.matrix');
    expect(r.search('емкость')[0]?.id).toBe('physics.circuits.capacitor'); // ё = е
    expect(r.search('линза фокус')[0]?.id).toBe('physics.optics.lens');
    expect(r.search('линза гаусс')).toHaveLength(0);
    expect(r.getObjectModule('physics.optics.lens')).toBeDefined();
  });

  it('конфликт горячих клавиш — предупреждение, первая регистрация побеждает', () => {
    const r = new PluginRegistry();
    r.register(optics);
    r.register(circuits);
    expect(r.getToolByHotkey('shift+l')?.id).toBe('physics.optics.lens');
    expect(r.warnings).toHaveLength(1);
  });

  it('пространства имён и повторная регистрация', () => {
    const r = new PluginRegistry();
    r.register(optics);
    expect(() => r.register(optics)).toThrow();
    expect(() =>
      r.register({ id: 'math.planimetry', title: 'x', objects: [objectModule('physics.optics.prism')] }),
    ).toThrow(/пространства имён/);
    expect(() => r.register({ id: 'Bad Id', title: 'x' })).toThrow();
    expect(() => r.register({ id: 'math.analysis', title: 'x', dependsOn: ['core'] })).toThrow(/требует/);
    // Неудачная регистрация не оставляет следов.
    expect(r.listPlugins().map((p) => p.id)).toEqual(['physics.optics']);
  });

  it('нормализация поиска', () => {
    expect(normalizeSearchText('  Ёмкость   Конденсатора ')).toBe('емкость конденсатора');
  });
});
