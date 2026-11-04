import { useState } from 'react';
import type { BoardObject, EditorContext, Point, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { QUANTITIES, QUANTITY_INFO, type Quantity } from './quantities';
import { SCALE_TYPE, scaleModule, scaleText, type ScaleProps } from './axes';
import { VECTOR_TYPE, type VectorProps } from './vectors';

const num = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() && Number.isFinite(v) ? v : null;
};

/**
 * Поставить или изменить масштаб величины и пересчитать значения всех её
 * векторов на странице — одной транзакцией. Масштаб этой величины уже есть
 * на странице — меняется он, второй не ставится. Возвращает id масштаба.
 */
export function applyScale(ctx: EditorContext, objectId: string | null, at: Point | null, q: Quantity, perCell: number): string {
  let id = objectId ?? '';
  ctx.transact(() => {
    const scales = ctx.listObjects(SCALE_TYPE) as BoardObject<ScaleProps>[];
    const own = scales.find((s) => s.id === objectId);
    const same = own ? undefined : scales.find((s) => s.props.q === q);
    if (same) id = same.id;
    const base = own?.props ?? same?.props ?? scaleModule.createProps();
    if (id) ctx.updateObject<ScaleProps>(id, { props: { ...base, q, perCell } });
    else id = ctx.createObject<ScaleProps>(SCALE_TYPE, { x: at?.x ?? 0, y: at?.y ?? 0, props: { ...base, q, perCell } });
    for (const vec of ctx.listObjects(VECTOR_TYPE) as BoardObject<VectorProps>[])
      if (vec.props.q === q && vec.props.perCell !== perCell && ctx.canModify(vec.id)) ctx.updateObject<VectorProps>(vec.id, { props: { perCell } });
  });
  return id;
}

/**
 * Диалог масштаба: величина и «сколько единиц в клетке». Сохранение
 * переписывает значение у всех векторов этой величины на странице — одной
 * транзакцией (одним шагом отмены). На странице один масштаб на величину.
 */
export function ScaleEditor({ objectId, at, ctx, close, readOnly }: PluginEditorProps) {
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<ScaleProps> | undefined) : undefined;
  const init = obj?.props ?? scaleModule.createProps();
  const [q, setQ] = useState<Quantity>(init.q);
  const [text, setText] = useState(String(init.perCell).replace('.', ','));
  const v = num(text);
  const bad = v === null || v <= 0 || v > 1e9;

  const save = () => {
    if (bad || readOnly) return;
    const id = applyScale(ctx, objectId, at, q, v!);
    if (id) ctx.setSelection([id]);
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Масштаб"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={bad || readOnly}>
            {obj ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 200 }}>
          <span className="field__label">Величина</span>
          <select className="select" aria-label="Величина" value={q} onChange={(e) => setQ(e.target.value as Quantity)}>
            {QUANTITIES.map((k) => (
              <option key={k} value={k}>
                {QUANTITY_INFO[k].title}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 140 }}>
          <span className="field__label">В одной клетке{QUANTITY_INFO[q].unit ? `, ${QUANTITY_INFO[q].unit}` : ''}</span>
          <input className="input" inputMode="decimal" aria-label="Единиц в клетке" aria-invalid={bad} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <p className="small muted">{bad ? 'Положительное число, например 2 или 0,5.' : `${scaleText({ q, perCell: v! })}. Значения всех векторов этой величины на странице пересчитаются.`}</p>
    </Dialog>
  );
}
