import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileClock, Search } from 'lucide-react';
import { AUDIT_ACTIONS, AUDIT_ACTION_GROUPS, AUDIT_ACTION_LABELS, type AuditActionName } from '@doska/shared';
import { adminApi } from '../../api/admin';
import { useDebounced, useLoader } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../ui/Button';
import { SelectField, TextField } from '../../ui/Field';
import { Alert, Badge, EmptyState, PageHeader, Pagination, Spinner } from '../../ui/misc';

const DANGER: ReadonlySet<AuditActionName> = new Set(['LOGIN_FAILED', 'LOGIN_BLOCKED', 'TOKEN_REUSE_DETECTED', 'USER_BLOCKED', 'USER_DELETED', 'CLASS_DELETED']);

/** Человекочитаемое описание деталей события. */
function describe(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  const reasons: Record<string, string> = {
    'unknown-login': 'неизвестный логин',
    'wrong-password': 'неверный пароль',
    blocked: 'учётная запись заблокирована',
    locked: 'вход временно приостановлен',
    'too-many-failures': 'слишком много неудачных попыток',
  };
  if (typeof d.reason === 'string') parts.push(reasons[d.reason] ?? d.reason);
  if (typeof d.lockMinutes === 'number') parts.push(`блокировка на ${d.lockMinutes} мин`);
  if (typeof d.count === 'number') parts.push(`создано: ${d.count}`);
  if (Array.isArray(d.added)) parts.push(`добавлены: ${d.added.join(', ')}`);
  if (Array.isArray(d.removed)) parts.push(`убраны: ${d.removed.join(', ')}`);
  if (d.allDevices) parts.push('на всех устройствах');
  if (d.changes && typeof d.changes === 'object') {
    const names: Record<string, string> = { fullName: 'ФИО', login: 'логин', role: 'роль', classIds: 'классы', color: 'цвет', name: 'название', academicYear: 'учебный год', description: 'описание', archived: 'архив' };
    parts.push('изменено: ' + Object.keys(d.changes).map((k) => names[k] ?? k).join(', '));
  }
  return parts.join('; ');
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput, 300);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const actionsParam = params.get('actions') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const list = useLoader(
    (signal) =>
      adminApi.listAudit(
        {
          actions: actionsParam ? actionsParam.split(',') : undefined,
          search: search || undefined,
          // Даты: «с» — начало дня, «по» — конец дня (локальное время).
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          pageSize: 50,
        },
        signal,
      ),
    [actionsParam, search, from, to, page],
  );

  const groupValue = Object.entries(AUDIT_ACTION_GROUPS).find(([, a]) => a.join(',') === actionsParam)?.[0];
  const selectValue = groupValue ? `group:${groupValue}` : actionsParam && !actionsParam.includes(',') ? actionsParam : actionsParam ? 'custom' : '';

  return (
    <>
      <PageHeader title="Журнал действий" subtitle="Входы, создание и изменение учётных записей и классов — кто, что и когда" />
      <div className="card card__body toolbar">
        <SelectField
          label="Событие"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) set({ actions: null });
            else if (v.startsWith('group:')) set({ actions: AUDIT_ACTION_GROUPS[v.slice(6)]!.join(',') });
            else if (v !== 'custom') set({ actions: v });
          }}
        >
          <option value="">Все события</option>
          {selectValue === 'custom' && <option value="custom">Выбранные события</option>}
          {Object.keys(AUDIT_ACTION_GROUPS).map((g) => (
            <option key={g} value={`group:${g}`}>
              {g} (все)
            </option>
          ))}
          <optgroup label="Отдельные события">
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </optgroup>
        </SelectField>
        <div className="field field--grow">
          <label className="field__label" htmlFor="audit-search">
            Кто
          </label>
          <div className="input-with-icon">
            <Search size={16} />
            <input
              id="audit-search"
              className="input"
              type="search"
              placeholder="Логин или ФИО"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                set({ search: e.target.value || null });
              }}
            />
          </div>
        </div>
        <TextField label="С" type="date" value={from} onChange={(e) => set({ from: e.target.value || null })} />
        <TextField label="По" type="date" value={to} onChange={(e) => set({ to: e.target.value || null })} />
        {(actionsParam || from || to || searchInput) && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Сбросить
          </Button>
        )}
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th aria-label="Подробности" />
                <th>Когда</th>
                <th>Событие</th>
                <th>Кто</th>
                <th>Над кем / чем</th>
                <th>Подробности</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((e) => {
                const open = expanded.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr>
                      <td>
                        <Button
                          size="small"
                          variant="ghost"
                          iconOnly
                          aria-label={open ? 'Скрыть подробности' : 'Показать подробности'}
                          aria-expanded={open}
                          icon={open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          onClick={() =>
                            setExpanded((s) => {
                              const n = new Set(s);
                              open ? n.delete(e.id) : n.add(e.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="nowrap small">{formatDateTime(e.createdAt)}</td>
                      <td>
                        <Badge kind={DANGER.has(e.action) ? 'danger' : e.action === 'LOGIN_SUCCESS' ? 'accent' : undefined}>
                          {AUDIT_ACTION_LABELS[e.action]}
                        </Badge>
                      </td>
                      <td>
                        {e.actor ? (
                          <>
                            {e.actor.fullName} <span className="muted small mono">{e.actor.login}</span>
                          </>
                        ) : (
                          <span className="mono">{e.actorLogin ?? '—'}</span>
                        )}
                      </td>
                      <td>{e.targetLabel ?? ''}</td>
                      <td className="small">{describe(e.details)}</td>
                      <td className="mono small nowrap">{e.ip ?? ''}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td />
                        <td colSpan={6}>
                          <div className="small muted" style={{ marginBottom: 4 }}>
                            {e.userAgent}
                          </div>
                          <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(e.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.loading && !list.data && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {list.data?.items.length === 0 && <EmptyState icon={<FileClock size={40} />} title="Событий не найдено" />}
        {list.data && list.data.total > 0 && (
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) }, false)} />
        )}
      </section>
    </>
  );
}
