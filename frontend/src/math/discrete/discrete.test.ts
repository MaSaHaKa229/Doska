import { describe, expect, it } from 'vitest';
import { arrangements, bfs, combinations, components, degrees, dfs, dijkstra, divideSteps, enumerate, euler, expanded, factorial, fracSteps, kruskal, parseBase, parseEdges, pascal, pathEdges, truthTable } from './discrete';

const N = ['A', 'B', 'C', 'D', 'E'];
const g = (src: string) => {
  const e = parseEdges(src, N);
  if ('error' in e) throw new Error(e.error);
  return e;
};

describe('графы', () => {
  it('разбор рёбер, степени, компоненты', () => {
    const e = g('AB 2, B-C:3; CD, a e = 1,5');
    expect(e).toEqual([{ a: 0, b: 1, w: 2 }, { a: 1, b: 2, w: 3 }, { a: 2, b: 3, w: 1 }, { a: 0, b: 4, w: 1.5 }]);
    expect(degrees(5, e)).toEqual([2, 2, 2, 1, 1]);
    expect(components(5, e)).toBe(1);
    expect(components(5, g('AB'))).toBe(4);
    expect(parseEdges('AZ', N)).toEqual({ error: 'нет вершины Z' });
    expect(parseEdges('AA', N)).toHaveProperty('error');
  });

  it('обходы в ширину и в глубину', () => {
    const e = g('AB, AC, BD, CE');
    expect(bfs(5, e, false, 0).map((v) => N[v.v]).join('')).toBe('ABCDE');
    expect(dfs(5, e, false, 0).map((v) => N[v.v]).join('')).toBe('ABDCE');
  });

  it('Дейкстра: кратчайший путь A → D через C', () => {
    const e = g('AB 4, AC 1, CB 2, BD 1, CD 5');
    const d = dijkstra(5, e, false, 0);
    expect(d.dist.slice(0, 4)).toEqual([0, 3, 1, 4]);
    expect(pathEdges(e, d.prevEdge, 3, false)).toEqual([1, 2, 3]);
    expect(d.dist[4]).toBe(Infinity);
  });

  it('остовное дерево Краскала', () => {
    const e = g('AB 4, AC 1, CB 2, BD 1, CD 5');
    const t = kruskal(5, e);
    expect(t.map((i) => e[i]!.w).reduce((a, b) => a + b, 0)).toBe(4);
    expect(t).toHaveLength(3);
  });

  it('эйлеров путь и цикл', () => {
    const house = g('AB, BC, CD, DA, AC, BD, BE, CE');
    const r = euler(5, house);
    if ('reason' in r) throw new Error(r.reason);
    expect(r.edges).toHaveLength(8);
    expect(r.cycle).toBe(false);
    const sq = euler(5, g('AB, BC, CD, DA'));
    expect(sq).toMatchObject({ cycle: true });
    expect(euler(5, g('AB, AC, AD, AE'))).toHaveProperty('reason');
  });
});

describe('комбинаторика', () => {
  it('формулы и перечисление', () => {
    expect(factorial(5)).toBe(120);
    expect(arrangements(5, 2)).toBe(20);
    expect(combinations(5, 2)).toBe(10);
    expect(enumerate(['A', 'B', 'C'], 2, true, 100)).toHaveLength(6);
    expect(enumerate(['A', 'B', 'C', 'D'], 2, false, 100).map((x) => x.join(''))).toEqual(['AB', 'AC', 'AD', 'BC', 'BD', 'CD']);
    expect(enumerate(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 7, true, 50)).toHaveLength(50);
    expect(pascal(4)[4]).toEqual([1, 4, 6, 4, 1]);
  });
});

describe('логика', () => {
  it('таблица истинности, СДНФ и СКНФ', () => {
    const t = truthTable('A → B');
    if ('error' in t) throw new Error(t.error);
    expect(t.rows.map((r) => r.result)).toEqual([true, true, false, true]);
    expect(t.sdnf).toBe('(¬A ∧ ¬B) ∨ (¬A ∧ B) ∨ (A ∧ B)');
    expect(t.sknf).toBe('(¬A ∨ B)');
  });

  it('школьная запись, приоритеты, виды формул', () => {
    const t = truthTable('не A или B и C');
    if ('error' in t) throw new Error(t.error);
    expect(t.vars).toEqual(['A', 'B', 'C']);
    // ¬A ∨ (B ∧ C): при A = 1, B = 1, C = 0 — ложь.
    expect(t.rows[6]!.result).toBe(false);
    expect((truthTable('A ∨ ¬A') as { kind: string }).kind).toBe('тождественно истинна');
    expect((truthTable('A & !A') as { kind: string }).kind).toBe('тождественно ложна');
    expect((truthTable('(A <-> B) xor C') as { rows: unknown[] }).rows).toHaveLength(8);
    expect(truthTable('(A ∧ B')).toEqual({ error: 'не закрыта скобка' });
    expect(truthTable('A ∧')).toEqual({ error: 'формула оборвалась' });
  });
});

describe('системы счисления', () => {
  it('в десятичную и обратно', () => {
    expect(parseBase('1011', 2)).toEqual({ value: 11, digits: '1011' });
    expect(parseBase('ff', 16)).toEqual({ value: 255, digits: 'FF' });
    expect(parseBase('0,101', 2)).toEqual({ value: 0.625, digits: '0.101' });
    expect(parseBase('12', 2)).toEqual({ error: 'цифры «2» нет в системе с основанием 2' });
    expect(expanded('1011', 2)).toBe('1·2³ + 0·2² + 1·2¹ + 1·2⁰');
    const d = divideSteps(25, 2);
    expect(d.digits).toBe('11001');
    expect(d.steps[0]).toEqual({ q: 25, d: 12, r: 1 });
    expect(divideSteps(255, 16).digits).toBe('FF');
    expect(fracSteps(0.625, 2).digits).toBe('101');
  });
});

describe('объекты раздела', () => {
  it('граф по умолчанию: путь Дейкстры A → F; удаление вершины убирает её рёбра; 4 инструмента', async () => {
    const { dropVertexEdges, graphModule, runGraph } = await import('./objects');
    const { registry } = await import('../../plugins/registry');
    const p = graphModule.createProps();
    const e = parseEdges(p.edges, ['A', 'B', 'C', 'D', 'E', 'F']);
    if ('error' in e) throw new Error(e.error);
    const r = runGraph(p, e);
    expect(r.lines[0]).toBe('Кратчайший путь A → F: A → C → B → D → E → F, длина 13');
    expect(runGraph({ ...p, algo: 'mst' }, e).lines[0]).toMatch(/вес 13$/);
    expect(dropVertexEdges('AB 4, BF 2, FC, DE 1,5', 'F')).toBe('AB 4, DE 1,5');
    expect(registry.listTools().filter((t) => t.id.startsWith('math.discrete.'))).toHaveLength(4);
  });
});
