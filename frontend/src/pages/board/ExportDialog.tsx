import { useEffect, useState } from 'react';
import type { BoardModel } from '../../collab/model';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox, SelectField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { canvasBlob, clampRatio, download, exportArea, fileName, fitOnPage, pdfPage, renderArea, snapshotModel, toCanvas, toSvg } from '../../export/render';

type Format = 'png' | 'svg' | 'pdf';
type Scope = 'selection' | 'page' | 'board';

/**
 * Экспорт доски: PNG (выделение или страница, 1×–3×), SVG (векторно,
 * формулы и картинки — встроенными изображениями), PDF (страница или вся
 * доска, лист A4 или по содержимому). Доступен всем, кто видит доску.
 */
export function ExportDialog({ open, onClose, model, title }: { open: boolean; onClose: () => void; model: BoardModel; title: string }) {
  const [format, setFormat] = useState<Format>('png');
  const [scope, setScope] = useState<Scope>('page');
  const [ratio, setRatio] = useState(2);
  const [background, setBackground] = useState(true);
  const [sheet, setSheet] = useState<'a4' | 'content'>('a4');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasSelection = useBoard((s) => s.selection.length > 0);

  useEffect(() => {
    if (!open) return;
    setScope(hasSelection ? 'selection' : 'page');
    setError(null);
    setProgress('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (format !== 'pdf' && scope === 'board') setScope('page');
  }, [format, scope]);

  const run = async () => {
    const st = useBoard.getState();
    const pageId = st.pageId;
    if (!pageId) return;
    setBusy(true);
    setError(null);
    const snap = snapshotModel(model);
    try {
      const pages = model.pages();
      const pageNo = pages.findIndex((p) => p.id === pageId) + 1;
      if (format === 'pdf') {
        const list = scope === 'board' ? pages.map((p) => p.id) : [pageId];
        const { jsPDF } = await import('jspdf');
        let pdf: InstanceType<typeof jsPDF> | null = null;
        let n = 0;
        for (const id of list) {
          n++;
          setProgress(list.length > 1 ? `Страница ${n} из ${list.length}…` : 'Готовим страницу…');
          const area = exportArea(snap, id, scope === 'selection' ? st.selection : []);
          if (!area) continue;
          const page = pdfPage(area.rect, sheet);
          const r = await renderArea(snap, area, { background: true });
          try {
            const img = toCanvas(r, clampRatio(area.rect, 2)).toDataURL('image/jpeg', 0.92);
            const orientation = page.landscape ? 'landscape' : 'portrait';
            if (!pdf) pdf = new jsPDF({ orientation, unit: 'mm', format: [page.w, page.h] });
            else pdf.addPage([page.w, page.h], orientation);
            const box = sheet === 'a4' ? fitOnPage(area.rect, page, 10) : { x: 0, y: 0, w: page.w, h: page.h };
            pdf.addImage(img, 'JPEG', box.x, box.y, box.w, box.h);
          } finally {
            r.dispose();
          }
        }
        if (!pdf) throw new Error('На доске нечего сохранять');
        download(pdf.output('blob'), fileName(title, scope === 'board' ? '' : `стр. ${pageNo}`, 'pdf'));
      } else {
        setProgress('Готовим рисунок…');
        const area = exportArea(snap, pageId, scope === 'selection' ? st.selection : []);
        if (!area) throw new Error(scope === 'selection' ? 'Нет выделенных объектов' : 'На странице нет объектов');
        const r = await renderArea(snap, area, { background });
        try {
          const suffix = scope === 'selection' ? `фрагмент стр. ${pageNo}` : `стр. ${pageNo}`;
          if (format === 'png') download(await canvasBlob(toCanvas(r, clampRatio(area.rect, ratio))), fileName(title, suffix, 'png'));
          else download(new Blob([await toSvg(r)], { type: 'image/svg+xml' }), fileName(title, suffix, 'svg'));
        } finally {
          r.dispose();
        }
      }
      toast.success('Файл сохранён');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      snap.destroy();
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Экспорт"
      onSubmit={() => void run()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Скачать
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <SelectField label="Формат" value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={busy}>
        <option value="png">PNG — картинка</option>
        <option value="svg">SVG — векторный рисунок</option>
        <option value="pdf">PDF — документ</option>
      </SelectField>
      <SelectField label="Что сохранить" value={scope} onChange={(e) => setScope(e.target.value as Scope)} disabled={busy}>
        {hasSelection && <option value="selection">Выделенные объекты</option>}
        <option value="page">Текущую страницу</option>
        {format === 'pdf' && <option value="board">Всю доску — все страницы</option>}
      </SelectField>
      {format === 'png' && (
        <SelectField label="Разрешение" value={ratio} onChange={(e) => setRatio(Number(e.target.value))} disabled={busy}>
          <option value={1}>Обычное (1×)</option>
          <option value={2}>Высокое (2×)</option>
          <option value={3}>Для печати (3×)</option>
        </SelectField>
      )}
      {format === 'pdf' ? (
        <SelectField label="Лист" value={sheet} onChange={(e) => setSheet(e.target.value as 'a4' | 'content')} disabled={busy}>
          <option value="a4">A4 (ориентация — по содержимому)</option>
          <option value="content">По размеру содержимого</option>
        </SelectField>
      ) : (
        <Checkbox label="Фон и сетка страницы" checked={background} onChange={(e) => setBackground(e.target.checked)} disabled={busy} />
      )}
      {format === 'svg' && <p className="small muted">Линии, фигуры и подписи — векторные; формулы и картинки встраиваются изображениями.</p>}
      {progress && (
        <p className="small muted" aria-live="polite">
          {progress}
        </p>
      )}
    </Dialog>
  );
}
