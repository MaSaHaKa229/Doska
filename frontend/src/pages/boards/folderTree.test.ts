import { describe, expect, it } from 'vitest';
import { descendantsOf, flattenFolders } from './folderTree';

const f = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, boardCount: 0, createdAt: '' });

describe('дерево папок', () => {
  const folders = [f('b', 'Физика', null), f('a', 'Алгебра', null), f('c', 'Механика', 'b'), f('d', 'Кинематика', 'c')];
  it('обход с глубиной и сортировкой', () => {
    expect(flattenFolders(folders).map((x) => `${x.depth}:${x.name}`)).toEqual(['0:Алгебра', '0:Физика', '1:Механика', '2:Кинематика']);
  });
  it('потомки', () => {
    expect([...descendantsOf(folders, 'b')].sort()).toEqual(['b', 'c', 'd']);
  });
});
