import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  errors?: string[] | undefined;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Обёртка поля: подпись, подсказка, ошибки, связи aria. */
export function FieldShell({ label, hint, errors, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const invalid = !!errors?.length;
  const describedBy = [hint ? hintId : null, invalid ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      {children({ id, describedBy, invalid })}
      {hint && !invalid && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {invalid && (
        <span className="field__error" id={errId} role="alert">
          {errors!.join('. ')}
        </span>
      )}
    </div>
  );
}

type Common = { label?: ReactNode; hint?: ReactNode; errors?: string[] | undefined; fieldClassName?: string };

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(function TextField(
  { label, hint, errors, fieldClassName, className, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} errors={errors} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          className={['input', className].filter(Boolean).join(' ')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export function SelectField({
  label,
  hint,
  errors,
  fieldClassName,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  return (
    <FieldShell label={label} hint={hint} errors={errors} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className={['select', className].filter(Boolean).join(' ')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  errors,
  fieldClassName,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  return (
    <FieldShell label={label} hint={hint} errors={errors} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className={['textarea', className].filter(Boolean).join(' ')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={['check', className].filter(Boolean).join(' ')}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
