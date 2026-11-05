import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { DEFAULT_TEXT_WIDTH, TEXT_TYPE, type TextProps } from '../objects/text';
import { EMPTY_DOC } from '../text/schema';
import { measureTextHeight } from '../text/render';

export const TEXT_TOOL_ID = 'core.text';

/** Открыть текстовый блок в редакторе (страница доски слушает это событие). */
export const EDIT_TEXT_EVENT = 'doska:edit-text';
export interface EditTextDetail {
  id: string;
  /** Блок только что создан: пустым при закрытии он удаляется. */
  created: boolean;
}
export function requestEditText(id: string, created = false): void {
  window.dispatchEvent(new CustomEvent<EditTextDetail>(EDIT_TEXT_EVENT, { detail: { id, created } }));
}

/**
 * «Текст»: щелчок по пустому месту создаёт блок и открывает редактор,
 * щелчок по существующему текстовому блоку — редактирует его.
 */
export const textTool: ToolModule<ReactNode> = {
  id: TEXT_TOOL_ID,
  title: 'Текст',
  icon: 'Type',
  group: 'media',
  hotkey: 'T',
  keywords: ['текст', 'надпись', 'абзац', 'таблица', 'список', 'формула в тексте', 'text'],
  requiresWrite: true,
  cursor: 'text',
  onPointerDown(e, ctx) {
    const hit = ctx.hitTest(e.world, ctx.screenToWorld(4)).find((o) => o.type === TEXT_TYPE);
    if (hit) {
      if (ctx.canModify(hit.id)) requestEditText(hit.id);
      ctx.activateTool('core.select');
      return;
    }
    // Ширина нового блока — 360 пунктов экрана; шрифт — в мировых единицах, как у остальной доски.
    const w = ctx.screenToWorld(DEFAULT_TEXT_WIDTH);
    const id = ctx.createObject<TextProps>(TEXT_TYPE, { x: e.world.x, y: e.world.y, props: { doc: EMPTY_DOC, w, h: measureTextHeight(EMPTY_DOC, w), fill: 'none' } });
    ctx.activateTool('core.select');
    if (id) {
      ctx.setSelection([id]);
      requestEditText(id, true);
    }
  },
};
