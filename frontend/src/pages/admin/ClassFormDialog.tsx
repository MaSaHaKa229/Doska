import { useEffect, useState } from 'react';
import { academicYearSchema, type ClassDetails, type ClassSummary } from '@doska/shared';
import { adminApi } from '../../api/admin';
import { ApiError, errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { TextAreaField, TextField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { currentAcademicYear } from '../../lib/format';

/** Создание и редактирование класса или группы. */
export function ClassFormDialog({
  open,
  cls,
  onClose,
  onSaved,
}: {
  open: boolean;
  cls: ClassSummary | null;
  onClose: () => void;
  onSaved: (c: ClassDetails) => void;
}) {
  const [name, setName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(cls?.name ?? '');
    setAcademicYear(cls ? (cls.academicYear ?? '') : currentAcademicYear());
    setDescription(cls?.description ?? '');
    setErrors({});
    setError(null);
  }, [open, cls]);

  const submit = async () => {
    const fe: Record<string, string[]> = {};
    if (!name.trim()) fe.name = ['Укажите название'];
    if (academicYear.trim()) {
      const r = academicYearSchema.safeParse(academicYear);
      if (!r.success) fe.academicYear = r.error.issues.map((i) => i.message);
    }
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    setError(null);
    try {
      const year = academicYear.trim() || undefined;
      const res = cls
        ? await adminApi.updateClass(cls.id, {
            name: name.trim(),
            academicYear: year ?? null,
            description: description.trim() || null,
          })
        : await adminApi.createClass({ name: name.trim(), academicYear: year, description: description.trim() || undefined });
      onSaved(res.class);
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
      title={cls ? 'Изменение класса' : 'Новый класс или группа'}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {cls ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <TextField label="Название" placeholder="9 «А», Физтех-кружок, МА-101" autoFocus value={name} errors={errors.name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Учебный год"
        placeholder="2026/2027"
        value={academicYear}
        errors={errors.academicYear}
        hint="Необязательно. Помогает отличать 9 «А» разных лет"
        onChange={(e) => setAcademicYear(e.target.value)}
      />
      <TextAreaField
        label="Описание"
        value={description}
        maxLength={1000}
        style={{ fontFamily: 'inherit', minHeight: 80 }}
        onChange={(e) => setDescription(e.target.value)}
      />
    </Dialog>
  );
}
