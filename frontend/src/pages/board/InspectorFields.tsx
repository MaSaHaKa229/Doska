import type { InspectorField } from '@doska/shared';
import { PALETTE, resolveColor, type CanvasTheme } from '../../objects/colors';

const WIDTHS = [1, 2, 3, 4, 6, 8, 12, 16];
const LINE_STYLES = [
  { value: 'solid', label: 'Сплошная' },
  { value: 'dashed', label: 'Штрих' },
  { value: 'dotted', label: 'Точки' },
];

/**
 * Поле контекстной панели свойств по описанию из модуля объекта
 * (ObjectModule.inspector) или инструмента (ToolModule.options).
 * value === undefined — у выделенных объектов значения различаются.
 */
export function InspectorFieldView({
  field,
  value,
  theme,
  disabled,
  onChange,
}: {
  field: InspectorField;
  value: unknown;
  theme: CanvasTheme;
  disabled?: boolean;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case 'color': {
      const allowNone = field.key === 'fill';
      return (
        <div className="prop" role="radiogroup" aria-label={field.label}>
          <span className="prop__label">{field.label}</span>
          <div className="swatches swatches--small">
            {allowNone && (
              <button
                type="button"
                className="swatch swatch--none"
                role="radio"
                aria-checked={value === 'none'}
                aria-label="Без заливки"
                title="Без заливки"
                disabled={disabled}
                onClick={() => onChange('none')}
              />
            )}
            {PALETTE.map((c) => (
              <button
                key={c.value}
                type="button"
                className="swatch"
                style={{ background: resolveColor(c.value, theme) }}
                role="radio"
                aria-checked={value === c.value}
                aria-label={c.label}
                title={c.label}
                disabled={disabled}
                onClick={() => onChange(c.value)}
              />
            ))}
          </div>
        </div>
      );
    }
    case 'stroke-width':
      return (
        <label className="prop">
          <span className="prop__label">{field.label}</span>
          <select className="select select--small" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
            {value === undefined && <option value="">—</option>}
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w} пт
              </option>
            ))}
          </select>
        </label>
      );
    case 'line-style':
      return (
        <label className="prop">
          <span className="prop__label">{field.label}</span>
          <select className="select select--small" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {value === undefined && <option value="">—</option>}
            {LINE_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'select':
      return (
        <label className="prop">
          <span className="prop__label">{field.label}</span>
          <select className="select select--small" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {value === undefined && <option value="">—</option>}
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'toggle':
      return (
        <label className="prop check">
          <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    case 'number':
      return (
        <label className="prop">
          <span className="prop__label">
            {field.label}
            {field.unit ? `, ${field.unit}` : ''}
          </span>
          <input
            className="input input--small"
            type={field.slider ? 'range' : 'number'}
            min={field.min}
            max={field.max}
            step={field.step ?? 'any'}
            value={typeof value === 'number' ? value : ''}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(n);
            }}
          />
          {field.slider && <span className="small mono">{typeof value === 'number' ? value : '—'}</span>}
        </label>
      );
    case 'action':
      return (
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => onChange(true)}>
          {field.label}
        </button>
      );
    case 'text':
    case 'latex':
      return (
        <label className="prop">
          <span className="prop__label">{field.label}</span>
          <input
            className="input input--small"
            value={typeof value === 'string' ? value : ''}
            maxLength={field.kind === 'text' ? field.maxLength : 2000}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}
