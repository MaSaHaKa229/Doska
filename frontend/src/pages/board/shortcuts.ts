import { useEffect } from 'react';
import { toolUnavailable } from '../../tools/availability';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { HAND_TOOL_ID, SELECT_TOOL_ID } from '../../tools/shape-tools';
import type { BoardCommands } from './commands';
import { decodeClipboard, encodeClipboard } from './clipboard';
import { toast } from '../../store/toast';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Строка клавиши в формате реестра: «Shift+R», «Ctrl+G», «V». */
export function hotkeyOf(e: KeyboardEvent): string {
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

/**
 * Горячие клавиши доски. Буквы определяются по физической клавише
 * (e.code), поэтому работают и в русской раскладке.
 */
export function useBoardShortcuts(commands: BoardCommands | null, ui: { palette: () => void; help: () => void }): void {
  useEffect(() => {
    if (!commands) return;
    const store = () => useBoard.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      // Пока открыт модальный диалог, клавиши принадлежат ему (Esc закрывает
      // диалог — его нельзя перехватывать).
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const code = e.code;

      if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat) store().setPanning(true);
        return;
      }
      const handled = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (ctrl && code === 'KeyK') return handled(() => ui.palette());
      if (e.key === '?' || (e.shiftKey && code === 'Slash') || code === 'F1') return handled(() => ui.help());
      if (ctrl && code === 'KeyZ') return handled(() => (e.shiftKey ? commands.redo() : commands.undo()));
      if (ctrl && code === 'KeyY') return handled(() => commands.redo());
      if (ctrl && code === 'KeyA') return handled(() => commands.selectAll());
      if (ctrl && code === 'KeyD') return handled(() => commands.duplicate());
      if (ctrl && code === 'KeyG') return handled(() => (e.shiftKey ? commands.ungroup() : commands.group()));
      if (ctrl && code === 'KeyL') return handled(() => commands.toggleLock());
      if (ctrl && code === 'BracketRight') return handled(() => commands.reorder(e.shiftKey ? 'front' : 'forward'));
      if (ctrl && code === 'BracketLeft') return handled(() => commands.reorder(e.shiftKey ? 'back' : 'backward'));
      if (ctrl && (code === 'Equal' || code === 'NumpadAdd')) return handled(() => commands.zoomStep(1));
      if (ctrl && (code === 'Minus' || code === 'NumpadSubtract')) return handled(() => commands.zoomStep(-1));
      if (ctrl && (code === 'Digit0' || code === 'Numpad0')) return handled(() => commands.zoomTo(1));
      if (ctrl) return;

      if (e.shiftKey && code === 'Digit1') return handled(() => commands.fit(false));
      if (e.shiftKey && code === 'Digit2') return handled(() => commands.fit(true));
      if (code === 'PageDown') return handled(() => commands.gotoPage(1));
      if (code === 'PageUp') return handled(() => commands.gotoPage(-1));
      if (code === 'Delete' || code === 'Backspace') return handled(() => commands.deleteSelection());
      if (code.startsWith('Arrow') && store().selection.length) {
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[code] as [number, number];
        return handled(() => commands.nudge(d[0], d[1]));
      }
      if (code === 'Escape') {
        if (store().preview) return handled(() => store().setPreview(null));
        if (store().toolId !== SELECT_TOOL_ID) return handled(() => store().setTool(SELECT_TOOL_ID));
        return handled(() => store().setSelection([]));
      }
      // Инструменты по горячим клавишам из реестра плагинов.
      const t = registry.getToolByHotkey(hotkeyOf(e));
      if (t) {
        e.preventDefault();
        const caps = store().caps;
        const reason = toolUnavailable(t, caps);
        if (reason) {
          toast.info(reason);
          return;
        }
        store().setTool(t.id);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') store().setPanning(false);
    };
    const onBlur = () => store().setPanning(false);

    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !store().selection.length) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', encodeClipboard(commands.copyObjects()));
    };
    const onCut = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !store().selection.length) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', encodeClipboard(commands.copyObjects()));
      commands.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const objects = decodeClipboard(e.clipboardData?.getData('text/plain'));
      if (!objects) return; // картинки и текст из буфера — этап 5.2
      e.preventDefault();
      commands.paste(objects);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [commands, ui]);
}

export { HAND_TOOL_ID };
