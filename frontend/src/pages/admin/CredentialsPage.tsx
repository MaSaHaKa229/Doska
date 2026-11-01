import { useState } from 'react';
import { Download, KeyRound, Printer, Trash2 } from 'lucide-react';
import { credentialsToCsv } from '@doska/shared';
import { useCredentials } from '../../store/credentials';
import { downloadText } from '../../lib/files';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Alert, EmptyState, PageHeader } from '../../ui/misc';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Checkbox } from '../../ui/Field';

/**
 * Листки с логинами и временными паролями для раздачи ученикам.
 * Данные живут только в памяти вкладки и исчезают после перезагрузки.
 */
export function CredentialsPage() {
  const { title, items, createdAt, clear } = useCredentials();
  const [confirmClear, setConfirmClear] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const site = window.location.origin;

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Пароли для печати" />
        <EmptyState icon={<KeyRound size={40} />} title="Нет паролей для печати">
          Временные пароли появляются здесь после создания пользователей, импорта или сброса паролей. Они не сохраняются — после
          перезагрузки страницы их можно только сбросить заново.
        </EmptyState>
      </>
    );
  }

  const stamp = createdAt ? new Date(createdAt).toISOString().slice(0, 16).replace(/[T:]/g, '-') : 'list';

  return (
    <>
      <div className="no-print stack">
        <PageHeader
          title="Пароли для печати"
          subtitle={`${title} · ${formatDateTime(createdAt ? new Date(createdAt).toISOString() : null)}`}
          actions={
            <>
              <Button variant="primary" icon={<Printer size={16} />} onClick={() => window.print()}>
                Печать
              </Button>
              <Button icon={<Download size={16} />} onClick={() => downloadText(`пароли-${stamp}.csv`, credentialsToCsv(items))}>
                Скачать CSV
              </Button>
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setConfirmClear(true)}>
                Убрать
              </Button>
            </>
          }
        />
        <Alert kind="warning">
          Пароли показываются только сейчас и не хранятся на сервере в открытом виде. Распечатайте или сохраните их, затем
          нажмите «Убрать». Не оставляйте страницу открытой на общем компьютере.
        </Alert>
        <Checkbox label="Печатать таблицей (компактно), а не карточками для разрезания" checked={asTable} onChange={(e) => setAsTable(e.target.checked)} />
      </div>

      {asTable ? (
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Класс</th>
                  <th>Логин</th>
                  <th>Временный пароль</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.login}>
                    <td>{c.fullName}</td>
                    <td>{c.className ?? ''}</td>
                    <td className="mono">{c.login}</td>
                    <td className="mono">{c.tempPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="cred-sheet">
          {items.map((c) => (
            <div key={c.login} className="cred-card">
              <div className="cred-card__name">{c.fullName}</div>
              {c.className && <div className="small muted">{c.className}</div>}
              <div className="small">
                Сайт: <span className="mono">{site}</span>
              </div>
              <div>
                Логин: <span className="cred-card__secret">{c.login}</span>
              </div>
              <div>
                Пароль: <span className="cred-card__secret">{c.tempPassword}</span>
              </div>
              <div className="small muted">При первом входе придумайте свой пароль.</div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Убрать пароли со страницы?"
        message="Вы сохранили или распечатали пароли? Восстановить их будет нельзя — только сбросить заново."
        confirmLabel="Убрать"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
        }}
      />
    </>
  );
}
