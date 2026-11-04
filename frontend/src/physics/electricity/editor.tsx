import { useState } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { parseNum } from '../common/si';
import { MAX_CHARGES, nextChargeId, qName, type SystemProps } from './objects';

/** Диалог системы зарядов: величины зарядов (нКл), удаление и добавление, масштаб, ε. */
export function ChargesEditor({ objectId, ctx, close, readOnly }: PluginEditorProps) {
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<SystemProps> | undefined) : undefined;
  const [rows, setRows] = useState(() => (obj?.props.charges ?? []).map((c) => ({ ...c, text: String(c.q).replace('.', ',') })));
  const [cell, setCell] = useState(String(obj?.props.cell ?? 1).replace('.', ','));
  const [eps, setEps] = useState(String(obj?.props.eps ?? 1).replace('.', ','));
  if (!obj) return null;
  const vals = rows.map((r) => parseNum(r.text));
  const badRow = vals.findIndex((v) => v === null || v === 0 || Math.abs(v) > 1e6);
  const cellV = parseNum(cell);
  const epsV = parseNum(eps);
  const bad = badRow >= 0 || cellV === null || cellV <= 0 || epsV === null || epsV < 1;

  const save = () => {
    if (bad || readOnly) return;
    const charges = rows.map((r, i) => ({ id: r.id, x: r.x, y: r.y, q: vals[i]! }));
    ctx.updateObject<SystemProps>(obj.id, { props: { charges, cell: cellV!, eps: epsV! } });
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Система зарядов"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={bad || readOnly}>
            Сохранить
          </Button>
        </>
      }
    >
      {rows.map((r, i) => (
        <div key={r.id} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ width: 36, fontStyle: 'italic' }}>{qName(i)} =</span>
          <input className="input" style={{ width: 110 }} aria-label={`Заряд ${qName(i)}, нКл`} aria-invalid={vals[i] === null || vals[i] === 0} value={r.text} onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
          <span>нКл</span>
          <Button size="small" variant="ghost" aria-label={`Удалить ${qName(i)}`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <Button
        size="small"
        disabled={rows.length >= MAX_CHARGES}
        onClick={() => setRows((rs) => [...rs, { id: nextChargeId(rs), x: obj.props.w / 2 + 20 * rs.length, y: obj.props.h / 2, q: 1, text: '1' }])}
      >
        + Заряд
      </Button>
      <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 140 }}>
          <span className="field__label">См в клетке</span>
          <input className="input" aria-label="Сантиметров в клетке" value={cell} onChange={(e) => setCell(e.target.value)} />
        </label>
        <label className="field" style={{ width: 140 }}>
          <span className="field__label">ε среды</span>
          <input className="input" aria-label="Диэлектрическая проницаемость" value={eps} onChange={(e) => setEps(e.target.value)} />
        </label>
      </div>
      <p className="small" style={{ color: bad ? 'var(--danger)' : undefined }}>
        {badRow >= 0 ? `${qName(badRow)}: число, не ноль (−5 — отрицательный заряд)` : 'Положительные заряды — со знаком «+» или без знака, отрицательные — с «−». Перемещайте заряды на доске мышью.'}
      </p>
    </Dialog>
  );
}
