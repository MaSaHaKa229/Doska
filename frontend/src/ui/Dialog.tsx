import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Если задан — тело оборачивается в <form>, Enter отправляет форму. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Запретить закрытие (например, во время запроса). */
  busy?: boolean;
}

/**
 * Модальный диалог на нативном <dialog>: браузер сам удерживает фокус
 * внутри, закрывает по Esc и делает остальную страницу инертной.
 */
export function Dialog({ open, onClose, title, children, footer, wide, onSubmit, busy }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  const content = (
    <>
      <div className="dialog__header">
        <h2 id={titleId} style={{ flex: 1 }}>{title}</h2>
        <Button variant="ghost" iconOnly icon={<X size={18} />} aria-label="Закрыть" onClick={onClose} disabled={busy} />
      </div>
      <div className="dialog__body">{children}</div>
      {footer && <div className="dialog__footer">{footer}</div>}
    </>
  );

  return (
    <dialog
      aria-labelledby={titleId}
      ref={ref}
      className={['dialog', wide && 'dialog--wide'].filter(Boolean).join(' ')}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(e) => {
        // Клик по подложке (сам <dialog>, а не его содержимое) закрывает диалог.
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      {open &&
        (onSubmit ? (
          <form
            className="dialog__form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {content}
          </form>
        ) : (
          <div className="dialog__form">{content}</div>
        ))}
    </dialog>
  );
}
