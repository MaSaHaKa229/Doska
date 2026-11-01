import { Navigate } from 'react-router-dom';
import { LogOut, Settings2 } from 'lucide-react';
import { BoardsSection } from './boards/BoardsSection';
import { USER_ROLE_LABELS } from '@doska/shared';
import { useAuth } from '../store/auth';
import { Checkbox, SelectField } from '../ui/Field';
import { Button } from '../ui/Button';
import { Alert, Avatar, PageHeader } from '../ui/misc';
import { errorMessage } from '../api/http';
import { toast } from '../store/toast';
import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useNavigate } from 'react-router-dom';

/**
 * Главная страница учителя и ученика: доски, конспекты, настройки.
 * Администратор попадает в панель. Задания добавляются на этапе 4.2.
 */
export function HomePage() {
  const { user, updatePreferences, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmAll, setConfirmAll] = useState(false);
  if (!user) return null;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;

  const save = (patch: Parameters<typeof updatePreferences>[0]) =>
    updatePreferences(patch).catch((err) => toast.error(errorMessage(err)));

  return (
    <main className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: 12 }}>
            <Avatar name={user.fullName} color={user.color} size={40} />
            Здравствуйте, {user.fullName.split(' ').slice(1, 3).join(' ') || user.fullName}!
          </span>
        }
        subtitle={USER_ROLE_LABELS[user.role]}
      />

      <BoardsSection user={user} />

      <section className="card">
        <div className="card__header">
          <Settings2 size={18} />
          <h2>Настройки</h2>
        </div>
        <div className="card__body stack">
          <div className="form-grid">
            <SelectField
              label="Тема оформления"
              value={user.preferences.theme}
              onChange={(e) => save({ theme: e.target.value as 'light' | 'dark' | 'system' })}
            >
              <option value="system">Как в системе</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </SelectField>
          </div>
          <Checkbox
            label="Режим «только перо»: на планшете рисует только стилус, касания пальцем и ладонью двигают доску"
            checked={user.preferences.penOnly}
            onChange={(e) => save({ penOnly: e.target.checked })}
          />
          <Checkbox
            label="Привязка к сетке"
            checked={user.preferences.snapToGrid}
            onChange={(e) => save({ snapToGrid: e.target.checked })}
          />
          <Checkbox
            label="Привязка к объектам (концы, середины, центры, пересечения)"
            checked={user.preferences.snapToObjects}
            onChange={(e) => save({ snapToObjects: e.target.checked })}
          />
          <Alert kind="info">Настройки сохраняются в вашей учётной записи и действуют на всех устройствах.</Alert>
          <div className="row">
            <Button icon={<LogOut size={16} />} onClick={() => setConfirmAll(true)}>
              Выйти на всех устройствах
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmAll}
        title="Выйти на всех устройствах?"
        message="Сессии на всех компьютерах, планшетах и телефонах будут завершены. Понадобится войти заново."
        confirmLabel="Выйти везде"
        onClose={() => setConfirmAll(false)}
        onConfirm={async () => {
          await logout(true).catch(() => undefined);
          navigate('/login', { replace: true });
        }}
      />
    </main>
  );
}
