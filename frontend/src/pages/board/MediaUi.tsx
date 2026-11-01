import { useEffect, useRef, useState } from 'react';
import { LIMITS, assetUrl, type AssetView } from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import { loadPdf, pdfPageSizes } from '../../media/pdf';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Checkbox, TextField } from '../../ui/Field';
import { Alert, Spinner } from '../../ui/misc';
import { applyCrop, clampCrop, type ImageCrop, type ImageProps } from '../../objects/image';

/** Сколько страниц PDF можно добавить за один раз. */
export const MAX_PDF_IMPORT_PAGES = 100;

/**
 * Импорт PDF: выбранные страницы становятся новыми страницами доски с
 * PDF в качестве фона (после текущей). Учитель может сразу закрепить фон —
 * ученики не сдвинут и не сотрут его.
 */
export function PdfImportDialog({ model, request, onClose }: { model: BoardModel; request: { asset: AssetView; name: string } | null; onClose: () => void }) {
  const caps = useBoard((s) => s.caps);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [lock, setLock] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    setPages(null);
    setError(null);
    setLock(!!useBoard.getState().caps?.moderate);
    loadPdf(request.asset.id)
      .then((doc) => {
        setPages(doc.numPages);
        setFrom('1');
        setTo(String(Math.min(doc.numPages, MAX_PDF_IMPORT_PAGES)));
      })
      .catch(() => setError('Не удалось открыть PDF: файл повреждён или защищён паролем'));
  }, [request]);

  const a = Math.max(1, Math.floor(Number(from) || 1));
  const b = Math.min(pages ?? 1, Math.floor(Number(to) || 1));
  const count = b - a + 1;
  const room = LIMITS.maxPagesPerBoard - model.pages().length;
  const invalid = !pages || count < 1 || count > MAX_PDF_IMPORT_PAGES || count > room;

  const submit = async () => {
    if (!request || invalid) return;
    setBusy(true);
    try {
      const doc = await loadPdf(request.asset.id);
      const sizes = await pdfPageSizes(doc, a, b);
      const base = request.name.replace(/\.pdf$/i, '').slice(0, 60);
      const created = model.addPages(
        sizes.map((size, i) => ({
          title: `${base} — с. ${a + i}`,
          background: { kind: 'blank', pdf: { assetId: request.asset.id, page: a + i, width: size.width, height: size.height } },
          backgroundLocked: lock && !!caps?.moderate,
        })),
        useBoard.getState().pageId ?? undefined,
      );
      if (!created.length) {
        toast.error('Не удалось добавить страницы');
        return;
      }
      useBoard.getState().setPage(created[0]!);
      toast.success(`Добавлено страниц: ${created.length}`);
      onClose();
    } catch {
      setError('Не удалось прочитать страницы PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!request}
      onClose={onClose}
      busy={busy}
      title="Добавить PDF как страницы доски"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={invalid}>
            Добавить {count > 0 && !invalid ? `${count} стр.` : ''}
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!pages && !error && <Spinner label="Чтение PDF…" />}
      {pages && (
        <>
          <p style={{ margin: 0 }}>
            «{request?.name}»: страниц — {pages}. Каждая выбранная страница станет отдельной страницей доски с PDF в качестве фона; поверх можно писать.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <TextField label="С страницы" type="number" min={1} max={pages} value={from} onChange={(e) => setFrom(e.target.value)} fieldClassName="access-filter" />
            <TextField label="По страницу" type="number" min={1} max={pages} value={to} onChange={(e) => setTo(e.target.value)} fieldClassName="access-filter" />
          </div>
          {count > MAX_PDF_IMPORT_PAGES && <Alert kind="warning">За один раз — не больше {MAX_PDF_IMPORT_PAGES} страниц.</Alert>}
          {count > room && <Alert kind="warning">На доске можно добавить ещё {Math.max(0, room)} стр. (предел — {LIMITS.maxPagesPerBoard}).</Alert>}
          {caps?.moderate && <Checkbox label="Закрепить фон: ученики не сдвинут и не сотрут страницы PDF" checked={lock} onChange={(e) => setLock(e.target.checked)} />}
        </>
      )}
    </Dialog>
  );
}

type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: ImageCrop };

/**
 * Обрезка картинки: рамка поверх исходного изображения, её можно двигать и
 * тянуть за углы. Обрезка не портит файл — меняется только видимая часть.
 */
export function CropDialog({ model, objectId, onClose }: { model: BoardModel; objectId: string | null; onClose: () => void }) {
  const obj = objectId ? model.getObject(objectId) : undefined;
  const p = obj?.props as ImageProps | undefined;
  const [crop, setCrop] = useState<ImageCrop>({ x: 0, y: 0, w: 1, h: 1 });
  const drag = useRef<Drag | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (p) setCrop(p.crop ?? { x: 0, y: 0, w: p.naturalW, h: p.naturalH });
    // Начальная рамка — при открытии для объекта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  if (!p || !objectId) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const viewW = Math.min(640, p.naturalW);
  const k = viewW / p.naturalW; // пикселей экрана на пиксель картинки
  const viewH = p.naturalH * k;

  const onDown = (mode: Drag['mode']) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / k;
    const dy = (e.clientY - d.startY) / k;
    const s = d.start;
    let next: ImageCrop;
    switch (d.mode) {
      case 'move':
        next = { ...s, x: Math.min(Math.max(0, s.x + dx), p.naturalW - s.w), y: Math.min(Math.max(0, s.y + dy), p.naturalH - s.h) };
        break;
      case 'nw':
        next = { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy };
        break;
      case 'ne':
        next = { x: s.x, y: s.y + dy, w: s.w + dx, h: s.h - dy };
        break;
      case 'sw':
        next = { x: s.x + dx, y: s.y, w: s.w - dx, h: s.h + dy };
        break;
      case 'se':
        next = { x: s.x, y: s.y, w: s.w + dx, h: s.h + dy };
        break;
    }
    if (next.w < 4 || next.h < 4) return;
    setCrop(clampCrop(next, p.naturalW, p.naturalH));
  };
  const onUp = () => {
    drag.current = null;
  };

  const save = (c: ImageCrop | null) => {
    const full = !c || (c.x <= 0.5 && c.y <= 0.5 && c.w >= p.naturalW - 0.5 && c.h >= p.naturalH - 0.5);
    model.updateObjects([{ id: objectId, patch: { props: applyCrop(p, full ? null : c) } }]);
    onClose();
  };

  const handle = (mode: Drag['mode'], style: React.CSSProperties) => (
    <div className={`crop-handle crop-handle--${mode}`} style={style} onPointerDown={onDown(mode)} aria-hidden />
  );

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Обрезать картинку"
      footer={
        <>
          <Button onClick={() => save(null)}>Без обрезки</Button>
          <span className="spacer" />
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={() => save(crop)}>
            Применить
          </Button>
        </>
      }
    >
      <div className="crop-area" ref={boxRef} style={{ width: viewW, height: viewH }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <img src={assetUrl(p.assetId)} alt={p.alt ?? ''} width={viewW} height={viewH} draggable={false} />
        <div
          className="crop-frame"
          data-testid="crop-frame"
          style={{ left: crop.x * k, top: crop.y * k, width: crop.w * k, height: crop.h * k }}
          onPointerDown={onDown('move')}
        >
          {/* Маркеры внутри рамки: область картинки обрезает всё, что снаружи. */}
          {handle('nw', { left: -2, top: -2 })}
          {handle('ne', { right: -2, top: -2 })}
          {handle('sw', { left: -2, bottom: -2 })}
          {handle('se', { right: -2, bottom: -2 })}
        </div>
      </div>
      <div className="small muted">
        Видимая часть: {Math.round(crop.w)}×{Math.round(crop.h)} из {p.naturalW}×{p.naturalH} пикселей. Исходный файл не меняется.
      </div>
    </Dialog>
  );
}
