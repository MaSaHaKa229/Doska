import { useState } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { parseQ } from './rational';
import { MATRIX_TYPE, matrixModule, type MatrixProps } from './objects';

const LETTERS = 'ABCDEFGHKLMNPQRST';

/** Диалог матрицы: размер, имя, ячейки (дроби и десятичные с запятой), расширенная матрица. */
export function MatrixEditor({ objectId, at, ctx, close }: PluginEditorProps) {
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<MatrixProps> | undefined) : undefined;
  const used = new Set(ctx.listObjects(MATRIX_TYPE).map((m) => (m.props as unknown as MatrixProps).name));
  const init = obj?.props ?? { ...matrixModule.createProps(), name: [...LETTERS].find((l) => !used.has(l)) ?? 'M', cells: ['', '', '', ''] };
  const [name, setName] = useState(init.name);
  const [rows, setRows] = useState(init.rows);
  const [cols, setCols] = useState(init.cols);
  const [augmented, setAugmented] = useState(init.augmented);
  const [cells, setCells] = useState<string[][]>(Array.from({ length: 8 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i < init.rows && j < init.cols ? (init.cells[i * init.cols + j] ?? '') : ''))));

  const flat = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => cells[i]![j]!.trim() || '0')).flat();
  const bad = flat.map((c, k) => (parseQ(c) ? -1 : k)).filter((k) => k >= 0);
  const okSize = rows >= 1 && rows <= 8 && cols >= 1 && cols <= 9 && (!augmented || cols >= 2);

  const save = () => {
    if (bad.length || !okSize) return;
    const props: MatrixProps = { ...(obj?.props ?? matrixModule.createProps()), name: name.trim().slice(0, 12), rows, cols, cells: flat, augmented };
    let id = objectId;
    if (obj) ctx.updateObject<MatrixProps>(obj.id, { props });
    else id = ctx.createObject<MatrixProps>(MATRIX_TYPE, { x: at?.x ?? 0, y: at?.y ?? 0, props });
    if (id) ctx.setSelection([id]);
    close();
  };

  const num = (label: string, v: number, set: (n: number) => void, max: number) => (
    <label className="field" style={{ width: 110 }}>
      <span className="field__label">{label}</span>
      <input className="input" type="number" min={1} max={max} value={v} aria-label={label} onChange={(e) => set(Math.min(max, Math.max(1, Math.round(Number(e.target.value) || 1))))} />
    </label>
  );

  return (
    <Dialog
      open
      onClose={close}
      wide
      title={obj ? `Матрица ${obj.props.name}` : 'Новая матрица'}
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!!bad.length || !okSize}>
            {obj ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 90 }}>
          <span className="field__label">Имя</span>
          <input className="input" aria-label="Имя матрицы" maxLength={12} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {num('Строк', rows, setRows, 8)}
        {num('Столбцов', cols, setCols, 9)}
        <label className="row" style={{ gap: 6, paddingBottom: 8 }}>
          <input type="checkbox" checked={augmented} onChange={(e) => setAugmented(e.target.checked)} />
          <span>Расширенная матрица системы (последний столбец — свободные члены)</span>
        </label>
      </div>
      <div className="matrix-grid" style={{ gridTemplateColumns: `repeat(${cols}, 64px)` }} role="grid" aria-label="Ячейки матрицы">
        {Array.from({ length: rows }, (_, i) =>
          Array.from({ length: cols }, (_, j) => (
            <input
              key={`${i}:${j}`}
              className={`input mono${bad.includes(i * cols + j) ? ' input--error' : ''}${augmented && j === cols - 1 ? ' matrix-grid__aug' : ''}`}
              aria-label={`Ячейка ${i + 1}, ${j + 1}`}
              value={cells[i]![j]!}
              placeholder="0"
              maxLength={24}
              autoFocus={i === 0 && j === 0}
              onChange={(e) => setCells((c) => c.map((r, a) => (a === i ? r.map((v, b) => (b === j ? e.target.value : v)) : r)))}
            />
          )),
        )}
      </div>
      <p className="small muted">Целые числа, дроби (−2/3) и десятичные с запятой (1,5). Пустая ячейка — 0. Tab — к следующей ячейке.</p>
      {bad.length > 0 && <p className="small" style={{ color: 'var(--danger)' }}>Не число в ячейке {Math.floor(bad[0]! / cols) + 1}, {(bad[0]! % cols) + 1}</p>}
    </Dialog>
  );
}
