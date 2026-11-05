import type { BoardModel } from '../../collab/model';
import type { BoardCommands } from './commands';
import { useBoard } from '../../store/board';
import { pickFiles } from '../../media/insert';
import { formulaApi } from '../../api/formula';
import { handwritingStrokes } from '../../formula/handwriting';
import { recognizeSelection } from './recognize';

/** Команда доски для палитры Ctrl+K и справки. */
export interface PaletteCommand {
  id: string;
  title: string;
  keywords: string[];
  hotkey?: string;
  section: string;
  enabled: () => boolean;
  run: () => void;
}

/** Встроенные команды ядра (инструменты плагинов добавляются из реестра). */
export function coreCommands(commands: BoardCommands, model: BoardModel, extra: { help: () => void; export: () => void; versions: () => void }): PaletteCommand[] {
  const st = () => useBoard.getState();
  const hasSel = () => st().selection.length > 0;
  const canWrite = () => !!st().caps?.write;
  const ocr = { enabled: false };
  void formulaApi.ocrEnabled().then((v) => (ocr.enabled = v));
  return [
    { id: 'undo', title: 'Отменить', keywords: ['отмена', 'назад', 'undo'], hotkey: 'Ctrl+Z', section: 'Правка', enabled: () => model.undo.canUndo(), run: () => commands.undo() },
    { id: 'redo', title: 'Повторить', keywords: ['вернуть', 'redo'], hotkey: 'Ctrl+Shift+Z', section: 'Правка', enabled: () => model.undo.canRedo(), run: () => commands.redo() },
    { id: 'select-all', title: 'Выделить всё', keywords: ['выделение', 'все объекты'], hotkey: 'Ctrl+A', section: 'Правка', enabled: () => true, run: () => commands.selectAll() },
    { id: 'duplicate', title: 'Дублировать', keywords: ['копия', 'дубликат', 'копировать'], hotkey: 'Ctrl+D', section: 'Правка', enabled: () => hasSel() && canWrite(), run: () => commands.duplicate() },
    { id: 'delete', title: 'Удалить выделенное', keywords: ['стереть', 'удаление'], hotkey: 'Delete', section: 'Правка', enabled: hasSel, run: () => commands.deleteSelection() },
    { id: 'group', title: 'Сгруппировать', keywords: ['группа', 'объединить'], hotkey: 'Ctrl+G', section: 'Упорядочить', enabled: () => st().selection.length > 1, run: () => commands.group() },
    { id: 'ungroup', title: 'Разгруппировать', keywords: ['группа', 'разъединить'], hotkey: 'Ctrl+Shift+G', section: 'Упорядочить', enabled: hasSel, run: () => commands.ungroup() },
    { id: 'front', title: 'На передний план', keywords: ['слой', 'поверх', 'наверх'], hotkey: 'Ctrl+Shift+]', section: 'Упорядочить', enabled: hasSel, run: () => commands.reorder('front') },
    { id: 'back', title: 'На задний план', keywords: ['слой', 'под', 'вниз'], hotkey: 'Ctrl+Shift+[', section: 'Упорядочить', enabled: hasSel, run: () => commands.reorder('back') },
    { id: 'forward', title: 'Вперёд на один слой', keywords: ['слой', 'выше'], hotkey: 'Ctrl+]', section: 'Упорядочить', enabled: hasSel, run: () => commands.reorder('forward') },
    { id: 'backward', title: 'Назад на один слой', keywords: ['слой', 'ниже'], hotkey: 'Ctrl+[', section: 'Упорядочить', enabled: hasSel, run: () => commands.reorder('backward') },
    {
      id: 'insert-media',
      title: 'Вставить картинку или PDF…',
      keywords: ['картинка', 'изображение', 'фото', 'pdf', 'файл', 'загрузить'],
      hotkey: 'Ctrl+V',
      section: 'Вставка',
      enabled: canWrite,
      run: () => void pickFiles().then((files) => commands.insertFiles(files)),
    },
    {
      id: 'recognize-formula',
      title: 'Распознать рукописную формулу',
      keywords: ['распознать', 'рукопись', 'почерк', 'формула', 'ocr'],
      section: 'Вставка',
      enabled: () => ocr.enabled && canWrite() && handwritingStrokes(model, st().selection).length > 0,
      run: () => void recognizeSelection(model),
    },
    { id: 'lock', title: 'Заблокировать / разблокировать', keywords: ['замок', 'закрепить', 'блокировка'], hotkey: 'Ctrl+L', section: 'Упорядочить', enabled: () => hasSel() && !!st().caps?.moderate, run: () => commands.toggleLock() },
    { id: 'zoom-in', title: 'Увеличить', keywords: ['масштаб', 'приблизить', 'зум'], hotkey: 'Ctrl+=', section: 'Вид', enabled: () => true, run: () => commands.zoomStep(1) },
    { id: 'zoom-out', title: 'Уменьшить', keywords: ['масштаб', 'отдалить', 'зум'], hotkey: 'Ctrl+−', section: 'Вид', enabled: () => true, run: () => commands.zoomStep(-1) },
    { id: 'zoom-100', title: 'Масштаб 100 %', keywords: ['масштаб', 'реальный размер'], hotkey: 'Ctrl+0', section: 'Вид', enabled: () => true, run: () => commands.zoomTo(1) },
    { id: 'fit', title: 'Показать всё', keywords: ['масштаб', 'вписать', 'обзор'], hotkey: 'Shift+1', section: 'Вид', enabled: () => true, run: () => commands.fit(false) },
    { id: 'fit-selection', title: 'Показать выделенное', keywords: ['масштаб', 'приблизить к выделению'], hotkey: 'Shift+2', section: 'Вид', enabled: hasSel, run: () => commands.fit(true) },
    {
      id: 'add-page',
      title: 'Новая страница',
      keywords: ['страница', 'лист', 'добавить страницу'],
      section: 'Страницы',
      enabled: () => !!st().caps?.managePages,
      run: () => {
        const id = model.addPage(undefined, st().pageId ?? undefined);
        if (id) st().setPage(id);
      },
    },
    { id: 'next-page', title: 'Следующая страница', keywords: ['страница', 'вперёд'], hotkey: 'PageDown', section: 'Страницы', enabled: () => true, run: () => commands.gotoPage(1) },
    { id: 'prev-page', title: 'Предыдущая страница', keywords: ['страница', 'назад'], hotkey: 'PageUp', section: 'Страницы', enabled: () => true, run: () => commands.gotoPage(-1) },
    { id: 'export', title: 'Экспорт: PNG, SVG, PDF…', keywords: ['экспорт', 'сохранить', 'скачать', 'картинка', 'pdf', 'png', 'svg', 'печать'], hotkey: 'Ctrl+Shift+E', section: 'Файл', enabled: () => true, run: extra.export },
    { id: 'versions', title: 'История версий…', keywords: ['версия', 'история', 'восстановить', 'откатить', 'сохранить версию', 'резервная копия'], section: 'Файл', enabled: () => !!st().caps?.restoreVersions, run: extra.versions },
    { id: 'help', title: 'Горячие клавиши', keywords: ['справка', 'помощь', 'клавиши', 'help'], hotkey: '?', section: 'Справка', enabled: () => true, run: extra.help },
  ];
}
