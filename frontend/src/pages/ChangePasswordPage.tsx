import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, X } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@doska/shared';
import { useAuth } from '../store/auth';
import { ApiError, errorMessage } from '../api/http';
import { TextField } from '../ui/Field';
import { Button } from '../ui/Button';
import { Alert } from '../ui/misc';
import { toast } from '../store/toast';

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = !!user?.mustChangePassword;

  const rules = useMemo(() => {
    const p = form.next;
    return [
      { ok: p.length >= PASSWORD_MIN_LENGTH, text: `не короче ${PASSWORD_MIN_LENGTH} символов` },
      { ok: /\p{L}/u.test(p), text: 'есть буква' },
      { ok: /\p{Nd}/u.test(p), text: 'есть цифра' },
      { ok: !!p && !p.toLowerCase().includes(user?.login ?? '\u0000'), text: 'не содержит логин' },
    ];
  }, [form.next, user?.login]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const fe: Record<string, string[]> = {};
    if (!form.current) fe.currentPassword = ['Введите текущий пароль'];
    const problems = checkPasswordPolicy(form.next, user?.login);
    if (problems.length) fe.newPassword = problems;
    if (form.next !== form.repeat) fe.repeat = ['Пароли не совпадают'];
    if (form.next && form.next === form.current) fe.newPassword = ['Новый пароль должен отличаться от текущего'];
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      await changePassword(form.current, form.next);
      toast.success('Пароль изменён');
      navigate(user?.role === 'ADMIN' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <form className="card__body" onSubmit={submit} noValidate>
          <div className="row">
            <KeyRound size={22} color="var(--accent)" />
            <h1>{forced ? 'Придумайте свой пароль' : 'Смена пароля'}</h1>
          </div>
          {forced && (
            <Alert kind="info">
              Вы вошли с временным паролем. Придумайте постоянный — его будете знать только вы.
            </Alert>
          )}
          {error && <Alert kind="error">{error}</Alert>}
          {/* Скрытое поле логина помогает менеджерам паролей сохранить пару логин/пароль. */}
          <input type="text" name="username" autoComplete="username" value={user?.login ?? ''} readOnly hidden />
          <TextField
            label={forced ? 'Временный пароль' : 'Текущий пароль'}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={form.current}
            errors={errors.currentPassword}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
          <TextField
            label="Новый пароль"
            type="password"
            autoComplete="new-password"
            value={form.next}
            errors={errors.newPassword}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
          <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 2 }} aria-label="Требования к паролю">
            {rules.map((r) => (
              <li key={r.text} className="row" style={{ gap: 6, color: r.ok ? 'var(--success)' : 'var(--text-3)' }}>
                {r.ok ? <Check size={14} /> : <X size={14} />} {r.text}
              </li>
            ))}
          </ul>
          <TextField
            label="Повторите новый пароль"
            type="password"
            autoComplete="new-password"
            value={form.repeat}
            errors={errors.repeat}
            onChange={(e) => setForm({ ...form, repeat: e.target.value })}
          />
          <Button type="submit" variant="primary" block loading={busy}>
            Сохранить пароль
          </Button>
          {forced ? (
            <Button
              variant="ghost"
              block
              onClick={async () => {
                await logout().catch(() => undefined);
                navigate('/login', { replace: true });
              }}
            >
              Выйти
            </Button>
          ) : (
            <Button variant="ghost" block onClick={() => navigate(-1)}>
              Отмена
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
