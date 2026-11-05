import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TEMPLATE_LEVELS, TEMPLATE_LEVEL_LABELS, TEMPLATE_SECTIONS, TEMPLATE_VISIBILITY_LABELS, type DirectoryUser, type TemplateLevel, type TemplateSummary } from '@doska/shared';
import { boardsApi } from '../../api/boards';
import { templatesApi } from '../../api/templates';
import { ApiError, errorMessage } from '../../api/http';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Alert } from '../../ui/misc';
import { toast } from '../../store/toast';

type Visibility = 'PRIVATE' | 'TEACHERS' | 'SELECTED';

/** Разделы для выбора: группы — заголовками, внутри — разделы. */
export function SectionOptions() {
  const out: JSX.Element[] = [];
  let group: { id: string; title: string } | null = null;
  let items: JSX.Element[] = [];
  const flush = () => {
    if (group) out.push(<optgroup key={group.id} label={group.title}>{[<option key={group.id} value={group.id}>{group.title} — в целом</option>, ...items]}</optgroup>);
    items = [];
  };
  for (const s of TEMPLATE_SECTIONS) {
    if (s.group) {
      flush();
      group = s;
    } else items.push(<option key={s.id} value={s.id}>{s.title}</option>);
  }
  flush();
  return <>{out}</>;
}

/**
 * Сохранить доску как шаблон (boardId) или изменить свой шаблон (template).
 * Содержимое копируется в момент сохранения; дальше шаблон правится как доска.
 */
export function TemplateDialog({ open, onClose, board, template, onSaved }: { open: boolean; onClose: () => void; board?: { id: string; title: string; description?: string | null } | null; template?: TemplateSummary | null; onSaved?: (t: TemplateSummary) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [section, setSection] = useState('math');
  const [level, setLevel] = useState<TemplateLevel>('SCHOOL');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE');
  const [shared, setShared] = useState<{ id: string; fullName: string }[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<DirectoryUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? board?.title ?? '');
    setDescription(template?.description ?? board?.description ?? '');
    setSection(template?.section ?? 'math');
    setLevel(template?.level ?? 'SCHOOL');
    setTags(template?.tags.join(', ') ?? '');
    setVisibility(template && template.visibility !== 'BUILTIN' ? template.visibility : 'PRIVATE');
    setShared(template?.sharedWith ?? []);
    setSearch('');
    setFound([]);
    setError(null);
    setErrors({});
  }, [open, template, board]);

  // Поиск учителей для «выбранным учителям».
  useEffect(() => {
    if (!open || visibility !== 'SELECTED') return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      boardsApi
        .directory({ role: 'TEACHER', search: search.trim() || undefined, limit: 20 }, ctrl.signal)
        .then((r) => setFound(r.users))
        .catch((err) => {
          if (!(err instanceof Error && err.name === 'AbortError')) setError(errorMessage(err));
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, visibility, search]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      title,
      description: description.trim() || (template ? null : undefined),
      section,
      level,
      tags: tags.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      visibility,
      shareUserIds: visibility === 'SELECTED' ? shared.map((u) => u.id) : [],
    };
    try {
      const res = template ? await templatesApi.update(template.id, body) : await templatesApi.create({ ...body, description: body.description ?? undefined, boardId: board!.id });
      toast.success(template ? 'Шаблон сохранён' : 'Доска сохранена в библиотеку шаблонов');
      onSaved?.(res.template);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sharedIds = new Set(shared.map((u) => u.id));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title={template ? `Шаблон «${template.title}»` : 'Сохранить как шаблон'}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!template && <Alert kind="info">В шаблон копируется текущее содержимое доски. Саму доску это не меняет.</Alert>}
      <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} errors={errors.title} required maxLength={300} />
      <TextAreaField label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} errors={errors.description} rows={2} maxLength={2000} />
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <SelectField label="Раздел" value={section} onChange={(e) => setSection(e.target.value)} errors={errors.section} fieldClassName="field--grow">
          <SectionOptions />
        </SelectField>
        <SelectField label="Уровень" value={level} onChange={(e) => setLevel(e.target.value as TemplateLevel)} errors={errors.level}>
          {TEMPLATE_LEVELS.map((l) => (
            <option key={l} value={l}>
              {TEMPLATE_LEVEL_LABELS[l]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="Теги" hint="Через запятую: «кинематика, ЕГЭ»" value={tags} onChange={(e) => setTags(e.target.value)} errors={errors.tags} />
      <SelectField label="Кому виден" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} errors={errors.visibility}>
        {(['PRIVATE', 'TEACHERS', 'SELECTED'] as const).map((v) => (
          <option key={v} value={v}>
            {TEMPLATE_VISIBILITY_LABELS[v]}
          </option>
        ))}
      </SelectField>
      {visibility === 'SELECTED' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {shared.map((u) => (
              <span key={u.id} className="badge badge--accent">
                {u.fullName}
                <button type="button" className="badge__remove" aria-label={`Убрать ${u.fullName}`} onClick={() => setShared((l) => l.filter((x) => x.id !== u.id))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {!shared.length && <span className="muted small">Учителя не выбраны</span>}
          </div>
          <TextField label="Найти учителя" type="search" value={search} onChange={(e) => setSearch(e.target.value)} errors={errors.shareUserIds} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {found
              .filter((u) => !sharedIds.has(u.id))
              .map((u) => (
                <Button key={u.id} size="small" onClick={() => setShared((l) => [...l, { id: u.id, fullName: u.fullName }])}>
                  + {u.fullName}
                </Button>
              ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
