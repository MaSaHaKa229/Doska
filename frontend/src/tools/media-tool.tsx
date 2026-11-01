import type { ReactNode } from 'react';
import type { ToolModule } from '@doska/shared';
import { pickFiles, requestInsertFiles } from '../media/insert';

export const MEDIA_TOOL_ID = 'core.media';

/**
 * «Картинка или PDF»: щелчок по доске открывает выбор файла, картинка
 * встаёт в точку щелчка (PDF — новыми страницами через диалог). То же
 * делают вставка из буфера (Ctrl+V) и перетаскивание файлов на доску.
 */
export const mediaTool: ToolModule<ReactNode> = {
  id: MEDIA_TOOL_ID,
  title: 'Картинка или PDF',
  icon: 'ImagePlus',
  group: 'media',
  hotkey: 'I',
  keywords: ['картинка', 'изображение', 'фото', 'рисунок', 'pdf', 'файл', 'загрузить', 'вставить', 'image', 'picture'],
  requiresWrite: true,
  cursor: 'copy',
  onPointerDown(e, ctx) {
    const at = e.world;
    // Выбор файла открывается из жеста пользователя (иначе браузер его запретит).
    void pickFiles().then((files) => {
      if (files.length) requestInsertFiles(files, at);
    });
    ctx.activateTool('core.select');
  },
};
