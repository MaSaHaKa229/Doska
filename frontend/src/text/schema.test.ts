import { describe, expect, it } from 'vitest';
import { EMPTY_DOC, colorVar, docPlainText, isEmptyDoc, latexToMathML, normalizeDoc, plainTextToDoc } from './schema';

describe('документ текстового блока', () => {
  it('разрешённое сохраняется, посторонние цвета и размеры удаляются', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            { type: 'text', text: 'Синий ', marks: [{ type: 'textStyle', attrs: { color: colorVar('accent-2'), fontSize: '32px' } }, { type: 'bold' }] },
            { type: 'text', text: 'чужой', marks: [{ type: 'textStyle', attrs: { color: 'url(javascript:alert(1))', fontSize: 'calc(1px + 9999px)' } }] },
            { type: 'mathInline', attrs: { latex: 'x^2' } },
          ],
        },
      ],
    };
    const n = normalizeDoc(doc);
    const runs = n.content![0]!.content!;
    expect(runs[0]!.marks![0]!.attrs).toMatchObject({ color: 'var(--c-accent-2)', fontSize: '32px' });
    expect(runs[1]!.marks![0]!.attrs).toMatchObject({ color: null, fontSize: null });
    expect(n.content![0]!.attrs!.textAlign).toBe('center');
    expect(docPlainText(n)).toBe('Синий чужой$x^2$');
  });

  it('неизвестные узлы — ошибка (объект считается повреждённым)', () => {
    expect(() => normalizeDoc({ type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] })).toThrow();
    expect(() => normalizeDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }] }] })).toThrow();
  });

  it('таблица и списки допустимы', () => {
    const t = {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'пункт' }] }] }] },
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }],
        },
      ],
    };
    expect(() => normalizeDoc(t)).not.toThrow();
    expect(isEmptyDoc(normalizeDoc(t))).toBe(false);
  });

  it('пустой документ, обычный текст из буфера', () => {
    expect(isEmptyDoc(EMPTY_DOC)).toBe(true);
    expect(isEmptyDoc(plainTextToDoc('  \n '))).toBe(true);
    const d = normalizeDoc(plainTextToDoc('Первая\r\n\r\nТретья'));
    expect(d.content).toHaveLength(3);
    expect(docPlainText(d)).toBe('Первая\n\nТретья');
  });

  it('формулы: MathML без ссылок и обработчиков, ошибка не роняет отрисовку', () => {
    const ml = latexToMathML('\\frac{a}{b}');
    expect(ml).toContain('<math');
    expect(ml).toContain('<mfrac>');
    const evil = latexToMathML('\\href{javascript:alert(1)}{x}\\url{http://evil}');
    // Ссылки не создаются: команды показаны как ошибка, исходник — только текстом в <annotation>.
    expect(evil).not.toMatch(/href=/);
    expect(evil).toContain('mathcolor="#cc0000"');
    expect(evil.replace(/<annotation[^>]*>.*?<\/annotation>/, '')).not.toContain('javascript:');
    expect(() => latexToMathML('\\frac{')).not.toThrow();
  });
});
