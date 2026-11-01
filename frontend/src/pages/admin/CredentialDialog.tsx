import { Copy, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Credential } from '@doska/shared';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/misc';
import { toast } from '../../store/toast';
import { useCredentials } from '../../store/credentials';

/** Показ одного временного пароля (после создания или сброса). */
export function CredentialDialog({ credential, title, onClose }: { credential: Credential | null; title: string; onClose: () => void }) {
  const navigate = useNavigate();
  const setCredentials = useCredentials((s) => s.set);
  const copy = async () => {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(`Логин: ${credential.login}\nВременный пароль: ${credential.tempPassword}`);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать — выделите текст вручную');
    }
  };
  return (
    <Dialog
      open={!!credential}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button icon={<Copy size={16} />} onClick={copy}>
            Скопировать
          </Button>
          <Button
            icon={<Printer size={16} />}
            onClick={() => {
              if (!credential) return;
              setCredentials(title, [credential]);
              onClose();
              navigate('/admin/credentials');
            }}
          >
            Печать
          </Button>
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        </>
      }
    >
      {credential && (
        <>
          <Alert kind="warning">Пароль показывается только сейчас. Запишите или распечатайте его — позже его можно только сбросить.</Alert>
          <dl className="kv">
            <dt>ФИО</dt>
            <dd>{credential.fullName}</dd>
            {credential.className && (
              <>
                <dt>Класс</dt>
                <dd>{credential.className}</dd>
              </>
            )}
            <dt>Логин</dt>
            <dd className="secret">{credential.login}</dd>
            <dt>Пароль</dt>
            <dd className="secret">{credential.tempPassword}</dd>
          </dl>
        </>
      )}
    </Dialog>
  );
}
