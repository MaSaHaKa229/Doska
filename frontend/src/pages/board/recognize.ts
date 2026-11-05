import type { BoardModel } from '../../collab/model';
import { formulaApi } from '../../api/formula';
import { errorMessage } from '../../api/http';
import { handwritingPng, handwritingStrokes } from '../../formula/handwriting';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { requestObjectEditor } from '../../tools/formula-tools';

/**
 * Распознать выделенную рукопись: штрихи → PNG → сервер → редактор
 * формулы с распознанной записью. Формула встаёт на место рукописи и
 * заменяет её (одним шагом отмены); перед вставкой запись можно поправить.
 */
export async function recognizeSelection(model: BoardModel): Promise<void> {
  const ids = handwritingStrokes(model, useBoard.getState().selection);
  if (!ids.length) {
    toast.info('Выделите рукописную формулу (штрихи пера)');
    return;
  }
  const img = await handwritingPng(model, ids);
  if (!img) return;
  let latex: string;
  try {
    latex = await formulaApi.recognize(img.png);
  } catch (err) {
    toast.error(errorMessage(err) || 'Не удалось распознать формулу');
    return;
  }
  if (!latex) toast.info('Формула не распознана — наберите её в редакторе');
  const deletable = ids.filter((id) => model.canDelete(id));
  requestObjectEditor({
    editor: 'formula',
    id: null,
    at: { x: img.bounds.x, y: img.bounds.y },
    latex,
    // Кегль — по высоте рукописи (строка формулы примерно в полтора кегля).
    size: Math.round(Math.min(200, Math.max(16, img.bounds.height / 1.5))),
    replaces: deletable,
  });
}
