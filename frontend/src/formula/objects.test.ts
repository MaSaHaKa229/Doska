import { describe, expect, it } from 'vitest';
import katex from 'katex';
import type { BoardObject } from '@doska/shared';
import { solutionElement, type SolutionProps } from '../objects/solution';
import { formulaModule, type FormulaProps } from '../objects/formula';
import { registry } from '../plugins/registry';
import { allPaletteItems } from './palette';

describe('формулы и решения', () => {
  it('блок «Решение»: номера, формулы, отметки переходов и комментарии', () => {
    const p: SolutionProps = {
      title: 'Решите уравнение',
      steps: [
        { latex: '2x+3=11', note: '' },
        { latex: '2x=8', note: 'перенесли 3' },
        { latex: 'x=5', note: '' },
      ],
      w: 500,
      size: 22,
      check: true,
    };
    const el = solutionElement(p, ['ok', 'unknown']);
    const rows = [...el.querySelectorAll('tr')];
    expect(rows).toHaveLength(3);
    expect(el.querySelector('.doska-solution__title')?.textContent).toBe('Решите уравнение');
    expect(rows.map((r) => r.querySelector('.doska-solution__mark')?.textContent)).toEqual(['', '✓', '?']);
    expect(rows[1]!.querySelector('.doska-solution__note')?.textContent).toBe('перенесли 3');
    expect(rows[0]!.querySelector('math')).not.toBeNull();
  });

  it('растяжение формулы меняет кегль, а не масштаб', () => {
    const obj = { scaleX: 1, scaleY: 1, props: { latex: 'x', size: 32, color: 'ink' } } as unknown as BoardObject<FormulaProps>;
    expect(formulaModule.applyResize!(obj, 1.5, 1.5)).toEqual({ scaleX: 1, scaleY: 1, props: { size: 48 } });
  });

  it('шаблоны палитры: корректный LaTeX и поиск в Ctrl+K', () => {
    for (const it of allPaletteItems()) {
      expect(() => katex.renderToString(it.example, { throwOnError: true, strict: 'ignore' }), it.title).not.toThrow();
    }
    const found = registry.search('дробь', 10);
    expect(found.some((r) => r.kind === 'command' && r.title === 'Формула: дробь')).toBe(true);
    expect(registry.getTool('core.formula')?.hotkey).toBe('F');
  });
});
