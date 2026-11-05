import { describe, expect, it } from 'vitest';
import { colorVar, normalizeDoc } from './schema';
import { colorVars, docToElement, rasterScale, textSvg } from './render';
import { textModule, type TextProps } from '../objects/text';
import type { BoardObject } from '@doska/shared';

const doc = normalizeDoc({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Задача <1> & "кавычки"' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Найдите ', marks: [{ type: 'textStyle', attrs: { color: colorVar('accent-1') } }] },
        { type: 'mathInline', attrs: { latex: '\\frac{x}{2}' } },
      ],
    },
  ],
});

describe('отрисовка текста', () => {
  it('SVG — корректный XML: текст экранирован, формула в пространстве имён MathML', () => {
    const svg = textSvg(doc, 300, 120, 'light', null, 2);
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).toContain('width="600"');
    expect(svg).toContain('Задача &lt;1&gt; &amp;');
    expect(parsed.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'mfrac')).toHaveLength(1);
    expect(svg).toContain('color: var(--c-accent-1)');
    expect(svg).not.toMatch(/<script|onerror=|javascript:/i);
  });

  it('цвета темы — переменные CSS; тёмная тема меняет основной цвет', () => {
    expect(colorVars('light')).toContain('--c-ink:#1b2420');
    expect(colorVars('dark')).not.toContain('--c-ink:#1b2420');
    expect(docToElement(doc).querySelector('h2')?.textContent).toBe('Задача <1> & "кавычки"');
  });

  it('масштаб картинки: степени двойки в пределах 0,5–8', () => {
    expect(rasterScale(1, 1)).toBe(1);
    expect(rasterScale(1, 2)).toBe(2);
    expect(rasterScale(1.3, 1)).toBe(2);
    expect(rasterScale(0.1, 1)).toBe(0.5);
    expect(rasterScale(40, 2)).toBe(8);
  });

  it('растяжение рамкой меняет ширину блока, а не масштаб букв', () => {
    const obj = { id: 'textObj001', type: 'core.text', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, props: { doc, w: 300, h: 100, fill: 'none' } } as unknown as BoardObject<TextProps>;
    const patch = textModule.applyResize!(obj, 1.5, 1.2);
    expect(patch).toMatchObject({ scaleX: 1, scaleY: 1, props: { w: 450 } });
    expect(textModule.applyResize!(obj, 0.01, 1).props!.w).toBe(40);
  });
});
