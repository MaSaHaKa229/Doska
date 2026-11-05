import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { REFERENCE, searchReference } from './reference';

describe('справочник формул', () => {
  it('каждая формула разбирается KaTeX без ошибок', () => {
    for (const t of REFERENCE)
      for (const it of t.items) {
        expect(() => katex.renderToString(it.latex, { throwOnError: true, strict: 'ignore', output: 'mathml' }), `${t.title}: ${it.title}`).not.toThrow();
      }
  });

  it('темы уникальны, в каждой есть формулы; математика и физика', () => {
    const ids = REFERENCE.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of REFERENCE) expect(t.items.length).toBeGreaterThan(3);
    expect(new Set(REFERENCE.map((t) => t.group))).toEqual(new Set(['Математика', 'Физика']));
  });

  it('поиск по словам, обозначениям, теме; ё и е не различаются; фильтр по теме', () => {
    expect(searchReference('пифагор').map((r) => r.item.title)).toEqual(['Теорема Пифагора']);
    expect(searchReference('гипотенуза')[0]!.item.title).toBe('Теорема Пифагора');
    expect(searchReference('объем шар')[0]!.item.title).toBe('Шар и сфера');
    expect(searchReference('', 'optics')).toHaveLength(REFERENCE.find((t) => t.id === 'optics')!.items.length);
    expect(searchReference('маятник', 'mechanics')).toEqual([]);
    expect(searchReference('маятник').length).toBe(2);
  });
});
