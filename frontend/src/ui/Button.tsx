import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'normal' | 'small';
  icon?: ReactNode;
  /** Только иконка (обязательно укажите aria-label/title). */
  iconOnly?: boolean;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'normal', icon, iconOnly, loading, block, className, children, disabled, type, ...rest },
  ref,
) {
  const cls = [
    'btn',
    variant !== 'default' && `btn--${variant}`,
    size === 'small' && 'btn--small',
    iconOnly && 'btn--icon',
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type ?? 'button'} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden /> : icon}
      {!iconOnly && children}
    </button>
  );
});
