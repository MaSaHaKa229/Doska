import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, PenLine } from 'lucide-react';
import { loginRequestSchema } from '@doska/shared';
import { useAuth } from '../store/auth';
import { ApiError, errorMessage } from '../api/http';
import { TextField } from '../ui/Field';
import { Button } from '../ui/Button';
import { Alert } from '../ui/misc';

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const notice = useAuth((s) => s.notice);
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginRequestSchema.safeParse(form);
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      setErrors(fe);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const user = await login(parsed.data);
      const from = (location.state as { from?: string } | null)?.from;
      if (user.mustChangePassword) navigate('/change-password', { replace: true });
      else navigate(from && from !== '/login' ? from : user.role === 'ADMIN' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setForm((f) => ({ ...f, password: '' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <form className="card__body" onSubmit={submit} noValidate>
          <div className="row" style={{ gap: 12 }}>
            <span className="brand__mark" style={{ width: 42, height: 42, borderRadius: 12 }}>
              <PenLine size={22} />
            </span>
            <div>
              <h1>Учебная доска</h1>
              <div className="muted small">Вход для учителей и учеников</div>
            </div>
          </div>
          {notice && !error && <Alert kind="info">{notice}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          <TextField
            label="Логин"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={form.login}
            errors={errors.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
          <div style={{ position: 'relative' }}>
            <TextField
              label="Пароль"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              errors={errors.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={{ paddingRight: 44 }}
            />
            <Button
              variant="ghost"
              size="small"
              iconOnly
              icon={showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              onClick={() => setShowPassword((v) => !v)}
              style={{ position: 'absolute', right: 4, top: 28 }}
            />
          </div>
          <Button type="submit" variant="primary" block loading={busy} icon={<LogIn size={18} />}>
            Войти
          </Button>
          <p className="muted small">
            Учётные записи выдаёт администратор школы. Забыли пароль — обратитесь к нему, он выдаст временный.
          </p>
        </form>
      </div>
    </div>
  );
}
