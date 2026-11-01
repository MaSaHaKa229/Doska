import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Sigma,
  Strikethrough,
  Table as TableIcon,
  Underline,
} from 'lucide-react';
import type { BoardModel } from '../../collab/model';
import type { Presence } from '../../collab/presence';
import { currentCamera, useBoard } from '../../store/board';
import { worldToScreen, type Size } from '../../canvas/camera';
import { resolveColor, type CanvasTheme } from '../../objects/colors';
import { TEXT_TYPE, type TextProps } from '../../objects/text';
import { FONT_SIZES, TEXT_COLOR_TOKENS, colorVar, isEmptyDoc, mathElement, normalizeDoc, textExtensions, MAX_LATEX } from '../../text/schema';
import { TEXT_CSS, colorVars, measureTextHeight } from '../../text/render';
import { EDIT_TEXT_EVENT, type EditTextDetail } from '../../tools/text-tool';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';

/** Как часто сохранять текст во время набора (другие участники видят его по ходу). */
const SAVE_DELAY_MS = 700;

/**
 * Редактор текстового блока поверх холста: блок рисуется настоящим
 * редактором (TipTap/ProseMirror) в том же масштабе и повороте, что и на
 * доске, над ним — панель форматирования. Пока блок открыт, у других
 * участников на нём отметка «Редактирует …» (мягкая блокировка: второй
 * редактор того же блока не открывается).
 */
export function TextEditorHost({ model, presence, sizeRef, theme }: { model: BoardModel; presence: Presence; sizeRef: React.MutableRefObject<Size>; theme: CanvasTheme }) {
  const editingId = useBoard((s) => s.editingText);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    const onEdit = (e: Event) => {
      const { id, created: isNew } = (e as CustomEvent<EditTextDetail>).detail;
      const obj = model.getObject(id);
      if (!obj || obj.type !== TEXT_TYPE) return;
      if (!model.canModify(id, 'props')) {
        toast.info('Этот текст нельзя изменить');
        return;
      }
      const other = presence.peers().find((p) => p.editing === id);
      if (other) {
        toast.info(`Этот текст сейчас редактирует ${other.user.fullName}`);
        return;
      }
      setCreated(isNew);
      useBoard.getState().setEditingText(id);
    };
    window.addEventListener(EDIT_TEXT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_TEXT_EVENT, onEdit);
  }, [model, presence]);

  useEffect(() => {
    presence.setEditing(editingId);
  }, [presence, editingId]);

  if (!editingId) return null;
  return <TextEditor key={editingId} id={editingId} created={created} model={model} sizeRef={sizeRef} theme={theme} onClose={() => useBoard.getState().setEditingText(null)} />;
}

function TextEditor({
  id,
  created,
  model,
  sizeRef,
  theme,
  onClose,
}: {
  id: string;
  created: boolean;
  model: BoardModel;
  sizeRef: React.MutableRefObject<Size>;
  theme: CanvasTheme;
  onClose: () => void;
}) {
  const obj = useSyncExternalStore(
    useCallback((cb) => model.subscribeObject(id, cb), [model, id]),
    () => model.getObject(id),
  );
  // Подписка на камеру: редактор двигается вместе с доской.
  useBoard((s) => (s.pageId ? s.cameras[s.pageId] : undefined));
  const rootRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedOnce = useRef(false);
  const closed = useRef(false);
  const [mathEdit, setMathEdit] = useState<{ latex: string; pos: number | null } | null>(null);
  const props = obj?.props as TextProps | undefined;

  const save = useCallback(
    (editor: Editor, final: boolean) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const cur = model.getObject(id);
      if (!cur) return;
      const doc = normalizeDoc(editor.getJSON());
      const p = cur.props as TextProps;
      if (final && isEmptyDoc(doc) && (created || isEmptyDoc(p.doc))) {
        // Пустой блок не остаётся на доске.
        model.deleteObjects([id]);
        return;
      }
      const h = measureTextHeight(doc, p.w);
      if (JSON.stringify(doc) === JSON.stringify(p.doc) && h === p.h) return;
      // Вся правка блока — один шаг отмены доски.
      model.updateObjects([{ id, patch: { props: { doc, h } } }], { merge: savedOnce.current });
      savedOnce.current = true;
    },
    [model, id, created],
  );

  const editor = useEditor({
    extensions: textExtensions(true),
    content: props?.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'doska-text', 'aria-label': 'Текст на доске', spellcheck: 'true' },
      handleDoubleClickOn: (_view, pos, node) => {
        if (node.type.name !== 'mathInline') return false;
        setMathEdit({ latex: String(node.attrs.latex), pos });
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(ed, false), SAVE_DELAY_MS);
    },
  });

  // Последние версии для обработчиков (документ, Esc, размонтирование):
  // сами обработчики не пересоздаются при каждом рендере.
  const latest = useRef({ editor, save, onClose });
  latest.current = { editor, save, onClose };
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    const { editor: ed, save: sv, onClose: done } = latest.current;
    if (ed) sv(ed, true);
    done();
  }, []);

  // Закрытие: Esc, щелчок мимо блока и панели, смена страницы, удаление блока другим.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (rootRef.current?.contains(t) || t?.closest('dialog[open]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    const unsub = useBoard.subscribe((s, prev) => {
      if (s.pageId !== prev.pageId) close();
    });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      unsub();
    };
  }, [close]);
  useEffect(() => {
    if (!obj) latest.current.onClose();
  }, [obj]);
  // Настоящее размонтирование (уход со страницы доски) — сохранить набранное.
  // Закрытие откладывается: в StrictMode React размонтирует и сразу снова
  // монтирует компонент, и тогда закрывать редактор не нужно.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) close();
      }, 0);
    };
  }, [close]);

  if (!obj || !props) return null;
  const cam = currentCamera();
  const s = worldToScreen(cam, sizeRef.current, { x: obj.x, y: obj.y });
  const sx = cam.zoom * obj.scaleX;
  const sy = cam.zoom * obj.scaleY;
  const fill = props.fill === 'none' ? 'transparent' : resolveColor(props.fill, theme);

  const insertMath = (latex: string, pos: number | null) => {
    if (!editor) return;
    const value = latex.trim().slice(0, MAX_LATEX);
    if (pos !== null) {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { latex: value });
        return true;
      }).run();
    } else if (value) {
      editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: value } }).run();
    }
  };

  return (
    <div
      ref={rootRef}
      className="text-editor-host"
      style={Object.fromEntries(colorVars(theme).split(';').filter(Boolean).map((d) => d.split(':') as [string, string])) as React.CSSProperties}
    >
      <style>{TEXT_CSS}</style>
      {editor && <TextToolbar editor={editor} anchorY={s.y} blockBottom={s.y + props.h * sy} left={Math.max(4, s.x)} onMath={() => {
        const sel = editor.state.selection as unknown as { node?: { type: { name: string }; attrs: { latex: string } }; from: number };
        if (sel.node?.type.name === 'mathInline') setMathEdit({ latex: sel.node.attrs.latex, pos: sel.from });
        else setMathEdit({ latex: '', pos: null });
      }} />}
      <div
        className="text-editor"
        data-testid="text-editor"
        style={{
          transform: `translate(${s.x}px, ${s.y}px) rotate(${obj.rotation}rad) scale(${sx}, ${sy})`,
          width: props.w,
          minHeight: props.h,
          background: fill,
        }}
      >
        <EditorContent editor={editor} />
      </div>
      <MathDialog
        request={mathEdit}
        onClose={() => setMathEdit(null)}
        onSave={(latex) => {
          insertMath(latex, mathEdit?.pos ?? null);
          setMathEdit(null);
        }}
      />
    </div>
  );
}

/** Кнопка панели: не забирает фокус у редактора. */
function TB({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Высота, нужная панели над блоком (две строки кнопок с запасом). */
const TOOLBAR_ROOM = 96;

function TextToolbar({ editor, anchorY, blockBottom, left, onMath }: { editor: Editor; anchorY: number; blockBottom: number; left: number; onMath: () => void }) {
  // Над блоком (нижним краем к блоку), а у верхнего края экрана — под блоком.
  const above = anchorY > TOOLBAR_ROOM;
  const place: React.CSSProperties = above ? { top: anchorY - 8, left, transform: 'translateY(-100%)' } : { top: blockBottom + 8, left };
  // Перерисовка панели при каждом изменении выделения и форматирования.
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  const c = () => editor.chain().focus();
  const style = editor.getAttributes('textStyle') as { color?: string; fontSize?: string };
  const block = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const inTable = editor.isActive('table');
  return (
    <div className="text-toolbar" role="toolbar" aria-label="Форматирование текста" style={place} onMouseDown={(e) => e.target instanceof HTMLSelectElement || e.preventDefault()}>
      <select
        className="select select--small"
        aria-label="Стиль абзаца"
        value={block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') c().setParagraph().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">Текст</option>
        <option value="h1">Заголовок 1</option>
        <option value="h2">Заголовок 2</option>
        <option value="h3">Заголовок 3</option>
      </select>
      <select
        className="select select--small"
        aria-label="Размер шрифта"
        value={style.fontSize ?? ''}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
      >
        <option value="">Размер</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={`${s}px`}>
            {s}
          </option>
        ))}
      </select>
      <TB label="Жирный (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
        <Bold size={16} />
      </TB>
      <TB label="Курсив (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
        <Italic size={16} />
      </TB>
      <TB label="Подчёркнутый (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}>
        <Underline size={16} />
      </TB>
      <TB label="Зачёркнутый" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={16} />
      </TB>
      <span className="tb-sep" />
      <div className="tb-colors" role="radiogroup" aria-label="Цвет текста">
        {TEXT_COLOR_TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            className="swatch"
            role="radio"
            aria-checked={(style.color ?? colorVar('ink')) === colorVar(t)}
            aria-label={`Цвет ${t}`}
            style={{ background: `var(--c-${t})` }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (t === 'ink' ? c().unsetColor().run() : c().setColor(colorVar(t)).run())}
          />
        ))}
      </div>
      <span className="tb-sep" />
      <TB label="Маркированный список" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>
        <List size={16} />
      </TB>
      <TB label="Нумерованный список" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </TB>
      <TB label="По левому краю" active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()}>
        <AlignLeft size={16} />
      </TB>
      <TB label="По центру" active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()}>
        <AlignCenter size={16} />
      </TB>
      <TB label="По правому краю" active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()}>
        <AlignRight size={16} />
      </TB>
      <span className="tb-sep" />
      <TB label="Формула ($…$ при наборе)" active={editor.isActive('mathInline')} onClick={onMath}>
        <Sigma size={16} />
      </TB>
      {!inTable ? (
        <TB label="Вставить таблицу 3×3" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()}>
          <TableIcon size={16} />
        </TB>
      ) : (
        <span className="tb-table">
          <TB label="Строка ниже" onClick={() => c().addRowAfter().run()}>+стр</TB>
          <TB label="Столбец справа" onClick={() => c().addColumnAfter().run()}>+стлб</TB>
          <TB label="Удалить строку" onClick={() => c().deleteRow().run()}>−стр</TB>
          <TB label="Удалить столбец" onClick={() => c().deleteColumn().run()}>−стлб</TB>
          <TB label="Удалить таблицу" onClick={() => c().deleteTable().run()}>×</TB>
        </span>
      )}
    </div>
  );
}

/** Ввод формулы в LaTeX с предпросмотром (палитра шаблонов и MathLive — этап 5.3). */
function MathDialog({ request, onClose, onSave }: { request: { latex: string } | null; onClose: () => void; onSave: (latex: string) => void }) {
  const [latex, setLatex] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (request) setLatex(request.latex);
  }, [request]);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.replaceChildren(latex.trim() ? mathElement(latex) : document.createTextNode('Предпросмотр формулы'));
  }, [latex, request]);
  return (
    <Dialog
      open={!!request}
      onClose={onClose}
      title="Формула"
      onSubmit={() => onSave(latex)}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!latex.trim()}>
            {request?.latex ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">LaTeX</span>
        <textarea
          className="input mono"
          rows={3}
          maxLength={MAX_LATEX}
          value={latex}
          autoFocus
          onChange={(e) => setLatex(e.target.value)}
          placeholder="\frac{a}{b} + x^2 = \sqrt{c}"
        />
      </label>
      <div className="math-preview" ref={previewRef} aria-live="polite" />
      <div className="small muted">При наборе текста формулу можно ввести между знаками доллара: $x^2$. Двойной щелчок по формуле в тексте — изменить её.</div>
    </Dialog>
  );
}

