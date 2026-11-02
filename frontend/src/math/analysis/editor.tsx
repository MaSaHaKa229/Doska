import { useState } from 'react';
import type { BoardObject, EditorContext, PluginEditorProps, Point, Rect } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { KIND_TITLES, parseCurve, useMathReady } from './expr';
import { AXES_TYPE, CURVE_TYPE, SLIDER_TYPE, frameOf, type AxesProps, type CurveProps } from './plot';
import { axesModule, curveModule, sliderModule, type SliderProps } from './objects';

const EXAMPLES = ['y = x^2 - 2x - 3', 'y = a·sin(b·x)', 'x^2 + y^2 = 16', 'y > x^2 - 4', '(3cos(t); 2sin(t))', 'r = 2(1 + cos(t))'];
const CURVE_COLORS = ['accent-3', 'accent-1', 'accent-2', 'accent-5', 'accent-6', 'accent-7', 'accent-4'];

/**
 * Система координат под точкой или новая — с центром в точке. Возвращает и
 * её прямоугольник: новый объект в той же транзакции ещё не прочитать.
 */
export function axesAt(ctx: EditorContext, at: Point | null): { id: string; rect: Rect } {
  const hit = at ? ctx.listObjects(AXES_TYPE).reverse().find((a) => {
    const r = frameOf(a).rect;
    return at.x >= r.x && at.x <= r.x + r.width && at.y >= r.y && at.y <= r.y + r.height;
  }) : undefined;
  if (hit) return { id: hit.id, rect: frameOf(hit).rect };
  const props = axesModule.createProps();
  const c = at ?? { x: 0, y: 0 };
  const rect = { x: c.x - props.w / 2, y: c.y - props.h / 2, width: props.w, height: props.h };
  return { id: ctx.createObject<AxesProps>(AXES_TYPE, { x: rect.x, y: rect.y, props }), rect };
}

/**
 * Слайдеры для параметров: существующие на странице по имени, недостающие —
 * новые под системой координат. Возвращает id по порядку параметров.
 */
export function sliderIds(ctx: EditorContext, r: Rect, params: string[]): string[] {
  const existing = ctx.listObjects(SLIDER_TYPE);
  let row = existing.filter((s) => s.y > r.y + r.height && s.x >= r.x - 1 && s.x <= r.x + r.width).length;
  return params.map((name) => {
    const s = existing.find((x) => (x.props as unknown as SliderProps).name === name);
    if (s) return s.id;
    const props: SliderProps = { ...sliderModule.createProps(), name };
    return ctx.createObject<SliderProps>(SLIDER_TYPE, { x: r.x + 20, y: r.y + r.height + 50 + 60 * row++, props });
  });
}

/** Диалог графика: запись, вид кривой, ошибки, примеры. */
export function CurveEditor({ objectId, at, ctx, close }: PluginEditorProps) {
  const ready = useMathReady();
  const obj = objectId ? (ctx.resolve.getObject(objectId) as BoardObject<CurveProps> | undefined) : undefined;
  const [text, setText] = useState(obj?.props.text ?? '');
  const parsed = ready && text.trim() ? parseCurve(text) : null;
  const ok = parsed && !('error' in parsed);

  const save = () => {
    if (!parsed || 'error' in parsed) return;
    let id = objectId;
    ctx.transact(() => {
      if (obj) {
        const axes = ctx.resolve.getObject(obj.deps[0]!);
        const sliders = sliderIds(ctx, axes ? frameOf(axes).rect : { x: 0, y: 0, width: 0, height: 0 }, parsed.params);
        ctx.updateObject<CurveProps>(obj.id, { props: { text: text.trim() }, deps: [obj.deps[0]!, ...sliders] });
        return;
      }
      const { id: axesId, rect } = axesAt(ctx, at);
      if (!axesId) return;
      const used = ctx.listObjects(CURVE_TYPE).filter((c) => c.deps[0] === axesId).map((c) => (c.props as unknown as CurveProps).color);
      const color = CURVE_COLORS.find((c) => !used.includes(c)) ?? CURVE_COLORS[0]!;
      const sliders = sliderIds(ctx, rect, parsed.params);
      const props: CurveProps = { ...curveModule.createProps(), text: text.trim(), color };
      id = ctx.createObject<CurveProps>(CURVE_TYPE, { x: 0, y: 0, props, deps: [axesId, ...sliders] });
    });
    if (id) ctx.setSelection([id]);
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      wide
      title={obj ? 'График' : 'Новый график'}
      onSubmit={save}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!ok}>
            {obj ? 'Сохранить' : 'Построить'}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Функция, уравнение или неравенство</span>
        <input
          className="input mono"
          aria-label="Запись графика"
          autoFocus
          maxLength={300}
          value={text}
          placeholder="y = x^2 - 2x - 3"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="small" aria-live="polite" data-testid="curve-kind" style={{ minHeight: '1.4em', color: parsed && 'error' in parsed ? 'var(--danger)' : 'var(--text-2)' }}>
        {!ready
          ? 'Загрузка…'
          : !parsed
            ? ' '
            : 'error' in parsed
              ? parsed.error
              : `${KIND_TITLES[parsed.kind]}${parsed.params.length ? ` · параметры: ${parsed.params.join(', ')} (слайдеры появятся под осями)` : ''}`}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {EXAMPLES.map((ex) => (
          <Button key={ex} size="small" variant="ghost" className="mono" onClick={() => setText(ex)}>
            {ex}
          </Button>
        ))}
      </div>
      <p className="small muted">
        Десятичная запятая, умножение можно не писать (2x, 3cos(t)). Функции: sin, cos, tg, ctg, ln, lg, sqrt, abs, exp. Параметрическая кривая — (x(t); y(t)), полярная — r = …
        (переменная t). Пределы t — на панели свойств графика.
      </p>
    </Dialog>
  );
}
