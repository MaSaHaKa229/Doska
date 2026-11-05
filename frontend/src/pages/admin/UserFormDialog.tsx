import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  USER_COLORS,
  USER_ROLE_LABELS,
  createUserSchema,
  type AdminUser,
  type ClassSummary,
  type Credential,
  type UserRole,
} from '@doska/shared';
import { adminApi } from '../../api/admin';
import { ApiError, errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox, SelectField, TextField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { useDebounced } from '../../lib/hooks';

interface Props {
  open: boolean;
  /** null — создание нового пользователя. */
  user: AdminUser | null;
  classes: ClassSummary[];
  /** Класс, выбранный по умолчанию (создание из фильтра по классу). */
  defaultClassId?: string;
  onClose: () => void;
  onSaved: (user: AdminUser, credential?: Credential) => void;
}

/** Создание и редактирование пользователя. */
export function UserFormDialog({ open, user, classes, defaultClassId, onClose, onSaved }: Props) {
  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [loginTouched, setLoginTouched] = useState(false);
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [classFilter, setClassFilter] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState('');

  useEffect(() => {
    if (!open) return;
    setFullName(user?.fullName ?? '');
    setLogin(user?.login ?? '');
    setLoginTouched(!!user);
    setRole(user?.role ?? 'STUDENT');
    setClassIds(user ? user.classes.map((c) => c.id) : defaultClassId ? [defaultClassId] : []);
    setColor(user?.color);
    setClassFilter('');
    setErrors({});
    setError(null);
    setSuggested('');
  }, [open, user, defaultClassId]);

  // Подсказка логина по ФИО (только при создании, пока админ не ввёл логин сам).
  const debouncedName = useDebounced(fullName, 350);
  useEffect(() => {
    if (!open || user || loginTouched || debouncedName.trim().length < 2) return;
    const ctrl = new AbortController();
    adminApi
      .suggestLogin(debouncedName.trim(), ctrl.signal)
      .then((r) => setSuggested(r.login))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [debouncedName, open, user, loginTouched]);

  const visibleClasses = useMemo(() => {
    const q = classFilter.trim().toLowerCase();
    return classes.filter((c) => !c.archived && (!q || c.name.toLowerCase().includes(q)));
  }, [classes, classFilter]);

  const submit = async () => {
    setError(null);
    const body = {
      fullName,
      login: login.trim() || (user ? undefined : suggested || undefined),
      role,
      classIds: role === 'ADMIN' ? [] : classIds,
      color,
    };
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      setErrors(fe);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (user) {
        const patch: Record<string, unknown> = {};
        if (parsed.data.fullName !== user.fullName) patch.fullName = parsed.data.fullName;
        if (parsed.data.login && parsed.data.login !== user.login) patch.login = parsed.data.login;
        if (parsed.data.role !== user.role) patch.role = parsed.data.role;
        const before = user.classes.map((c) => c.id).sort().join();
        if (parsed.data.classIds.slice().sort().join() !== before) patch.classIds = parsed.data.classIds;
        if (color && color !== user.color) patch.color = color;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        const res = await adminApi.updateUser(user.id, patch);
        onSaved(res.user);
      } else {
        const res = await adminApi.createUser(parsed.data);
        onSaved(res.user, res.credential);
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title={user ? 'Изменение пользователя' : 'Новый пользователь'}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {user ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!user && <Alert kind="info">Система создаст временный пароль. При первом входе пользователь придумает свой.</Alert>}
      <div className="form-grid">
        <TextField
          label="ФИО"
          placeholder="Иванов Пётр Сергеевич"
          autoFocus
          value={fullName}
          errors={errors.fullName}
          onChange={(e) => setFullName(e.target.value)}
          fieldClassName="field--grow"
        />
        <div className="field">
          <TextField
            label="Логин"
            placeholder={suggested || 'будет создан из ФИО'}
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            errors={errors.login}
            hint={!user && !login && suggested ? `Будет создан логин ${suggested}` : 'Латиница, цифры, точка, дефис'}
            onChange={(e) => {
              setLogin(e.target.value);
              setLoginTouched(e.target.value !== '');
            }}
          />
          {!user && suggested && login !== suggested && (
            <Button size="small" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => setLogin(suggested)}>
              Подставить {suggested}
            </Button>
          )}
        </div>
        <SelectField label="Роль" value={role} errors={errors.role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {(['STUDENT', 'TEACHER', 'ADMIN'] as const).map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
      </div>

      {role !== 'ADMIN' && (
        <div className="field">
          <span className="field__label">
            {role === 'TEACHER' ? 'Классы, в которых преподаёт' : 'Класс и группы'} ({classIds.length})
          </span>
          {classes.length > 8 && (
            <input
              className="input"
              placeholder="Найти класс…"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Фильтр классов"
            />
          )}
          <div className="check-list">
            {visibleClasses.length === 0 && <div className="muted small" style={{ padding: 8 }}>Классов пока нет — создайте их в разделе «Классы и группы»</div>}
            {visibleClasses.map((c) => (
              <div key={c.id}>
                <Checkbox
                  label={
                    <>
                      {c.name} {c.academicYear && <span className="muted small">{c.academicYear}</span>}
                    </>
                  }
                  checked={classIds.includes(c.id)}
                  onChange={(e) =>
                    setClassIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))
                  }
                />
              </div>
            ))}
          </div>
          {errors.classIds && <span className="field__error">{errors.classIds.join('. ')}</span>}
        </div>
      )}

      <div className="field">
        <span className="field__label">Цвет курсора и подписей на доске</span>
        <div className="swatches" role="radiogroup" aria-label="Цвет">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        {!user && !color && <span className="field__hint">Не выбран — будет назначен случайно</span>}
      </div>
    </Dialog>
  );
}
