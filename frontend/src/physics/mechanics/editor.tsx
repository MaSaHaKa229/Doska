import { useState } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { getMath, useMathReady } from '../../math/analysis/expr';
import { parseNum } from '../common/si';
import { compileLaw, sample } from './kinematics';
import { MOTION_TYPE, motionModule, type MotionProps } from './objects';

const PRESETS: { title: string; x: string; y: string; tEnd: number; scale: number }[] = [
  { title: 'Равномерное: x = 2 + 3t', x: '2 + 3t', y: '0', tEnd: 5, scale: 20 },
  { title: 'Равноускоренное: x = 2t + t²', x: '2t + t²', y: '0', tEnd: 4, scale: 20 },
  { title: 'Торможение: x = 10t − t²', x: '10t − t²', y: '0', tEnd: 5, scale: 15 },
  { title: 'Горизонтальный бросок с 20 м', x: '5t', y: '20 − 4,9t²', tEnd: 2, scale: 15 },
  { title: 'По окружности R = 3 м, ω = 1 рад/с', x: '3cos(t)', y: '3sin(t)', tEnd: 6.28, scale: 30 },
  { title: 'Колебания: x = 4sin(2t)', x: '4sin(2t)', y: '0', tEnd: 6.28, scale: 25 },
];

/** Диалог закона движения: x(t), y(t) в метрах, время показа, масштаб; примеры. */
export function MotionEditor({ objectId, at, ctx, close, readOnly }: PluginEditorProps) {
  useMathReady();
  const math = getMath();
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<MotionProps> | undefined) : undefined;
  const init = obj?.props ?? motionModule.createProps();
  const [x, setX] = useState(init.x);
  const [y, setY] = useState(init.y);
  const [tEnd, setTEnd] = useState(String(init.tEnd).replace('.', ','));
  const [scale, setScale] = useState(String(init.scale).replace('.', ','));
  const T = parseNum(tEnd);
  const S = parseNum(scale);
  const law = math ? compileLaw(math, x, y) : null;
  const err = !math ? null : law && 'error' in law ? law.error : T === null || T < 0.1 || T > 1000 ? 'Время — от 0,1 до 1000 с' : S === null || S < 0.5 || S > 1000 ? 'Масштаб — от 0,5 до 1000 пикселей на метр' : null;
  const span = law && !('error' in law) && T ? (() => {
    const pts = sample(law, T, 60);
    const w = Math.max(...pts.map((q) => q.x)) - Math.min(0, ...pts.map((q) => q.x));
    return `Путь по x — до ${Math.round(w * 10) / 10} м, на доске ≈ ${Math.round(w * (S ?? 1))} пикс.`;
  })() : '';

  const save = () => {
    if (err || !math || readOnly || T === null || S === null) return;
    const props: MotionProps = { ...init, x: x.trim() || '0', y: y.trim() || '0', tEnd: T, scale: S, play: { running: false, t0: 0, at: Date.now() } };
    let id = objectId;
    if (obj) ctx.updateObject<MotionProps>(obj.id, { props });
    else id = ctx.createObject<MotionProps>(MOTION_TYPE, { x: at?.x ?? 0, y: at?.y ?? 0, props });
    if (id) ctx.setSelection([id]);
    close();
  };

  const field = (label: string, value: string, set: (v: string) => void, width: number) => (
    <label className="field" style={{ width }}>
      <span className="field__label">{label}</span>
      <input className="input" aria-label={label} value={value} maxLength={120} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <Dialog
      open
      onClose={close}
      title="Движение по закону"
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!!err || !math || readOnly}>
            {obj ? 'Сохранить' : 'Вставить'}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Пример</span>
        <select
          className="select"
          aria-label="Пример движения"
          defaultValue=""
          onChange={(e) => {
            const p = PRESETS[Number(e.target.value)];
            if (!p) return;
            setX(p.x);
            setY(p.y);
            setTEnd(String(p.tEnd).replace('.', ','));
            setScale(String(p.scale));
          }}
        >
          <option value="">Выберите…</option>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        {field('x(t), м', x, setX, 190)}
        {field('y(t), м', y, setY, 190)}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        {field('Показать до t, с', tEnd, setTEnd, 130)}
        {field('Пикселей на метр', scale, setScale, 130)}
      </div>
      <p className="small" aria-live="polite" style={{ color: err ? 'var(--danger)' : undefined }}>
        {!math ? 'Загрузка вычислений…' : err ?? `${span} Время — t (с), запись как в тетради: 2t + 0,5t², 3cos(2t). y вверх; y = 0 — движение по прямой.`}
      </p>
    </Dialog>
  );
}
