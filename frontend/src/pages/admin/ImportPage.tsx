import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import {
  MAX_IMPORT_ROWS,
  USER_ROLE_LABELS,
  toCsv,
  type ClassSummary,
  type ImportUsersResponse,
} from '@doska/shared';
import { adminApi } from '../../api/admin';
import { ApiError, errorMessage } from '../../api/http';
import { downloadText, readTextFile } from '../../lib/files';
import { currentAcademicYear, pluralize } from '../../lib/format';
import { toast } from '../../store/toast';
import { useCredentials } from '../../store/credentials';
import { Button } from '../../ui/Button';
import { Checkbox, SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Alert, Badge, PageHeader } from '../../ui/misc';

const SAMPLE = toCsv([
  ['ФИО', 'Логин', 'Роль', 'Класс'],
  ['Иванов Пётр Сергеевич', '', 'ученик', '9А'],
  ['Смирнова Анна Олеговна', '', 'ученик', '9А'],
  ['Кузнецов Игорь Петрович', 'kuznetsov.ip', 'учитель', '9А'],
]);

/**
 * Импорт пользователей из CSV в два шага: «Проверить» (предпросмотр на
 * сервере, без изменений) → «Импортировать». После импорта временные
 * пароли открываются на странице печати.
 */
export function ImportPage() {
  const navigate = useNavigate();
  const setCredentials = useCredentials((s) => s.set);
  const [csv, setCsv] = useState('');
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [defaultRole, setDefaultRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [classId, setClassId] = useState('');
  const [createMissing, setCreateMissing] = useState(true);
  const [academicYear, setAcademicYear] = useState(currentAcademicYear());
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [preview, setPreview] = useState<ImportUsersResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    adminApi.allClasses().then(setClasses).catch((err) => toast.error(errorMessage(err)));
  }, []);

  const options = { csv, defaultRole, classId: classId || undefined, createMissingClasses: createMissing, academicYear: academicYear || undefined };
  const key = JSON.stringify(options);
  const stale = preview !== null && previewKey !== key;
  const errorLines = useMemo(() => new Map(preview?.errors.map((e) => [e.line, e.messages]) ?? []), [preview]);

  const loadFile = async (file: File) => {
    if (file.size > 1_000_000) {
      setError('Файл больше 1 МБ — разделите его на части');
      return;
    }
    const { text, encoding } = await readTextFile(file);
    setCsv(text);
    setFileInfo(`${file.name} · ${encoding === 'utf-8' ? 'UTF-8' : 'Windows-1251'}`);
    setPreview(null);
    setError(null);
  };

  const call = async (dryRun: boolean) => {
    setError(null);
    setFieldErrors({});
    setBusy(dryRun ? 'check' : 'import');
    try {
      const res = await adminApi.importUsers({ ...options, dryRun });
      if (dryRun) {
        setPreview(res);
        setPreviewKey(key);
      } else {
        setCredentials(`Импорт: ${res.credentials.length} ${pluralize(res.credentials.length, 'пользователь', 'пользователя', 'пользователей')}`, res.credentials);
        toast.success(`Создано ${res.credentials.length} ${pluralize(res.credentials.length, 'учётная запись', 'учётные записи', 'учётных записей')}`);
        navigate('/admin/credentials');
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        const details = err.details as { errors?: ImportUsersResponse['errors'] } | undefined;
        if (details?.errors && preview) setPreview({ ...preview, errors: details.errors });
      }
    } finally {
      setBusy(null);
    }
  };

  const canImport = preview && !stale && preview.errors.length === 0 && preview.rows.length > 0;

  return (
    <>
      <PageHeader
        title="Импорт пользователей"
        subtitle={<Link to="/admin/users">← Пользователи</Link>}
        actions={
          <Button icon={<Download size={16} />} onClick={() => downloadText('образец-импорта.csv', SAMPLE)}>
            Образец CSV
          </Button>
        }
      />

      <Alert kind="info">
        Колонки: <strong>ФИО; Логин; Роль; Класс</strong> (заголовок необязателен, порядок колонок — любой при наличии
        заголовка). Логин и роль можно не заполнять — логин создастся из ФИО. Разделитель «;», «,» или табуляция. Подходит
        файл, сохранённый из Excel как «CSV (разделители — точка с запятой)». До {MAX_IMPORT_ROWS} строк за раз.
      </Alert>

      <section className="card card__body stack">
        <div
          className="field"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void loadFile(f);
          }}
          style={{ outline: dragOver ? '2px dashed var(--accent)' : undefined, borderRadius: 'var(--radius)' }}
        >
          <div className="row">
            <label className="btn">
              <Upload size={16} /> Выбрать файл
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="muted small">{fileInfo ?? 'или перетащите файл сюда, или вставьте текст ниже'}</span>
          </div>
          <TextAreaField
            label="Содержимое CSV"
            value={csv}
            errors={fieldErrors.csv}
            rows={8}
            spellCheck={false}
            placeholder={'ФИО;Логин;Роль;Класс\nИванов Пётр Сергеевич;;ученик;9А'}
            onChange={(e) => {
              setCsv(e.target.value);
              setFileInfo(null);
            }}
          />
        </div>

        <div className="form-grid">
          <SelectField label="Роль, если не указана" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as 'STUDENT' | 'TEACHER')}>
            <option value="STUDENT">Ученик</option>
            <option value="TEACHER">Учитель</option>
          </SelectField>
          <SelectField label="Добавить всех в класс" value={classId} errors={fieldErrors.classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">— не добавлять —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.academicYear ? ` (${c.academicYear})` : ''}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Учебный год для классов из файла"
            value={academicYear}
            placeholder="2026/2027"
            errors={fieldErrors.academicYear}
            hint="Пусто — классы без учебного года"
            onChange={(e) => setAcademicYear(e.target.value)}
          />
        </div>
        <Checkbox label="Создавать классы из файла, которых ещё нет" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />

        {error && <Alert kind="error">{error}</Alert>}

        <div className="row">
          <Button icon={<CheckCircle2 size={16} />} disabled={!csv.trim()} loading={busy === 'check'} onClick={() => call(true)}>
            Проверить
          </Button>
          <Button variant="primary" icon={<FileUp size={16} />} disabled={!canImport} loading={busy === 'import'} onClick={() => call(false)}>
            {preview && !stale
              ? `Импортировать ${preview.rows.length} ${pluralize(preview.rows.length, 'запись', 'записи', 'записей')}`
              : 'Импортировать'}
          </Button>
          {stale && <span className="muted small">Данные изменились — проверьте снова</span>}
        </div>
      </section>

      {preview && (
        <section className="card">
          <div className="card__header" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ flex: 1 }}>Предпросмотр</h2>
            <Badge>{preview.rows.length} строк</Badge>
            {preview.errors.length > 0 ? (
              <Badge kind="danger">ошибок: {preview.errors.length}</Badge>
            ) : (
              <Badge kind="accent">ошибок нет</Badge>
            )}
            {preview.createdClasses.length > 0 && <Badge kind="info">новые классы: {preview.createdClasses.join(', ')}</Badge>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Строка</th>
                  <th>ФИО</th>
                  <th>Логин</th>
                  <th>Роль</th>
                  <th>Класс</th>
                  <th>Проблемы</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const errs = errorLines.get(r.line);
                  return (
                    <tr key={r.line} className={errs ? 'is-error' : undefined}>
                      <td className="muted">{r.line}</td>
                      <td>{r.fullName}</td>
                      <td className="mono">
                        {r.login} {r.loginGenerated && <span className="muted small">(авто)</span>}
                      </td>
                      <td>{USER_ROLE_LABELS[r.role]}</td>
                      <td>
                        {r.className ?? '—'} {r.newClass && <Badge kind="info">новый</Badge>}
                      </td>
                      <td style={{ color: 'var(--danger)' }}>{errs?.join('; ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
