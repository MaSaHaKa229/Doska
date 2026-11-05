import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { TextField } from './Field';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Требовать ввести эту строку для подтверждения (удаление). */
  requireText?: string;
  requireTextLabel?: string;
  busy?: boolean;
  onConfirm: (typed: string) => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  requireText,
  requireTextLabel,
  busy,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const ok = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      onSubmit={() => ok && onConfirm(typed.trim())}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
      {children}
      {requireText && (
        <TextField
          label={requireTextLabel ?? `Для подтверждения введите «${requireText}»`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      )}
    </Dialog>
  );
}
