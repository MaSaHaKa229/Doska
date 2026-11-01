import { InputRule, Node, getSchema, mergeAttributes, type Extensions, type JSONContent } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import katex from 'katex';

/**
 * Документ текстового блока — дерево ProseMirror (JSON), а не HTML: в
 * документ доски не попадает разметка, которую нужно очищать. Одна и та же
 * схема используется редактором и отрисовкой на доске.
 *
 * Разрешено: абзацы, заголовки 1–3, жирный, курсив, подчёркнутый,
 * зачёркнутый, списки, цитата, таблицы, выравнивание, цвет и размер
 * шрифта (только из набора приложения), формулы в строке.
 */

/** Размеры шрифта (мировые единицы; 20 ≈ клетка 5 мм). */
export const FONT_SIZES = [12, 16, 20, 24, 32, 40, 56, 72];
export const DEFAULT_FONT_SIZE = 20;

/** Цвета текста — токены палитры, в теме они становятся конкретными цветами. */
export const TEXT_COLOR_TOKENS = ['ink', 'muted', 'accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6', 'accent-7', 'accent-8'];
export const colorVar = (token: string) => `var(--c-${token})`;

const COLOR_RE = /^var\(--c-(ink|muted|accent-[1-8])\)$/;
const SIZE_RE = /^(\d{1,3})px$/;

/** Параметры KaTeX: без внешних ссылок и команд, с ограничением «раздувания» макросов. */
const KATEX_OPTIONS = { output: 'mathml', throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 30 } as const;
export const MAX_LATEX = 1000;

/** MathML формулы (KaTeX). Ошибка в формуле показывается красным текстом самой формулы. */
export function latexToMathML(latex: string): string {
  return katex.renderToString(latex.slice(0, MAX_LATEX), KATEX_OPTIONS);
}

/** DOM-элемент формулы (для редактора и для отрисовки). */
export function mathElement(latex: string, doc: Document = document): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'math-inline';
  span.setAttribute('data-latex', latex);
  // Разбор строки KaTeX через DOMParser: скрипты в разобранном документе не выполняются,
  // а KaTeX с trust: false не порождает ссылок и обработчиков.
  const parsed = new DOMParser().parseFromString(latexToMathML(latex), 'text/html');
  const math = parsed.body.firstElementChild;
  if (math) span.appendChild(doc.importNode(math, true));
  else span.textContent = latex;
  return span;
}

/** Формула внутри строки: атом с исходным LaTeX. */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el.getAttribute('data-latex') ?? '').slice(0, MAX_LATEX),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span.math-inline[data-latex]' }];
  },
  addInputRules() {
    // «$формула$» при наборе превращается в формулу.
    // Своё правило: стандартное nodeInputRule заменяет только содержимое
    // группы и оставило бы знаки доллара вокруг формулы.
    const type = this.type;
    return [
      new InputRule({
        find: /\$([^$\n]{1,500})\$$/,
        handler: ({ state, range, match }) => {
          const latex = (match[1] ?? '').trim();
          if (!latex) return null;
          state.tr.replaceWith(range.from, range.to, type.create({ latex }));
        },
      }),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    if (typeof document === 'undefined') return ['span', mergeAttributes(HTMLAttributes, { class: 'math-inline', 'data-latex': node.attrs.latex }), node.attrs.latex];
    return mathElement(String(node.attrs.latex));
  },
  addNodeView() {
    return ({ node }) => {
      const dom = mathElement(String(node.attrs.latex));
      dom.contentEditable = 'false';
      dom.title = 'Формула — двойной щелчок, чтобы изменить';
      return { dom };
    };
  },
});

/** Расширения схемы; editing — для редактора (с собственной историей правок). */
export function textExtensions(editing = false): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      undoRedo: editing ? { depth: 200 } : false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    TextStyle,
    Color,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TableKit.configure({ table: { resizable: false } }),
    MathInline,
  ];
}

let schemaCache: Schema | null = null;
export function textSchema(): Schema {
  schemaCache ??= getSchema(textExtensions());
  return schemaCache;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Предел размера документа в JSON (props объекта доски — до 512 КБ). */
export const MAX_DOC_BYTES = 200 * 1024;

/**
 * Привести документ к разрешённому: неизвестные узлы и метки отклоняет
 * схема (ошибка — документ битый), цвет и размер шрифта вне набора
 * приложения удаляются (вставка из Word и браузера приносит любые стили).
 */
export function normalizeDoc(json: unknown): JSONContent {
  const node = PMNode.fromJSON(textSchema(), json);
  node.check();
  const out = node.toJSON() as JSONContent;
  const walk = (n: JSONContent) => {
    for (const m of n.marks ?? []) {
      if (m.type !== 'textStyle' || !m.attrs) continue;
      const attrs = { ...m.attrs };
      if (attrs.color != null && !COLOR_RE.test(String(attrs.color))) attrs.color = null;
      if (attrs.fontSize != null) {
        const px = SIZE_RE.exec(String(attrs.fontSize));
        attrs.fontSize = px && Number(px[1]) >= 6 && Number(px[1]) <= 200 ? `${px[1]}px` : null;
      }
      m.attrs = attrs;
    }
    if (n.type === 'mathInline' && n.attrs) n.attrs.latex = String(n.attrs.latex ?? '').slice(0, MAX_LATEX);
    n.content?.forEach(walk);
  };
  walk(out);
  return out;
}

/** Пустой ли документ (нет текста, формул и таблиц). */
export function isEmptyDoc(json: JSONContent): boolean {
  let empty = true;
  const walk = (n: JSONContent) => {
    if ((n.type === 'text' && n.text?.trim()) || n.type === 'mathInline' || n.type === 'table') empty = false;
    n.content?.forEach(walk);
  };
  walk(json);
  return empty;
}

/** Обычный текст (из буфера) → документ: абзацы по строкам. */
export function plainTextToDoc(text: string): JSONContent {
  const lines = text.replace(/\r\n?/g, '\n').slice(0, 50_000).split('\n');
  return {
    type: 'doc',
    content: lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })),
  };
}

/** Текст документа без разметки (поиск, подписи, доступность). */
export function docPlainText(json: JSONContent): string {
  const parts: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    if (n.type === 'mathInline') parts.push(`$${String(n.attrs?.latex ?? '')}$`);
    n.content?.forEach(walk);
    if (n.type === 'paragraph' || n.type === 'heading') parts.push('\n');
  };
  walk(json);
  return parts.join('').trim();
}
