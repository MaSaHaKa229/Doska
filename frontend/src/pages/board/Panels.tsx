import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronLeft,
  ChevronRight,
  Copy,
  Group as GroupIcon,
  Lock,
  Maximize,
  Plus,
  Settings2,
  Trash2,
  Ungroup,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BACKGROUND_KINDS,
  BACKGROUND_LABELS,
  TOOL_GROUP_LABELS,
  noWriteHint,
  type InspectorField,
  type PageRecord,
  type ToolGroup,
} from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard, currentCamera } from '../../store/board';
import { toolIcon } from '../../ui/icons';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Checkbox, SelectField, TextField } from '../../ui/Field';
import { ActionMenu } from '../../ui/Menu';
import { InspectorFieldView } from './InspectorFields';
import type { BoardCommands } from './commands';
import type { CanvasTheme } from '../../objects/colors';
import { toast } from '../../store/toast';

// ---------------------------------------------------------------------
//  Панель инструментов (слева)
// ---------------------------------------------------------------------

const GROUP_ORDER: ToolGroup[] = ['select', 'draw', 'shapes', 'formulas', 'math', 'physics', 'media'];

export function Toolbar() {
  const toolId = useBoard((s) => s.toolId);
  const caps = useBoard((s) => s.caps);
  const setTool = useBoard((s) => s.setTool);
  const tools = registry.listTools();
  const groups = GROUP_ORDER.map((g) => ({ group: g, tools: tools.filter((t) => t.group === g) })).filter((g) => g.tools.length);
  const hint = caps && !caps.write ? noWriteHint(caps.noWriteReason) : null;

  return (
    <nav className="board-toolbar" aria-label="Инструменты">
      {groups.map(({ group, tools: list }) => (
        <div key={group} className="board-toolbar__group" role="group" aria-label={TOOL_GROUP_LABELS[group]}>
          {list.map((t) => {
            const Icon = toolIcon(t.icon);
            const disabled = t.requiresWrite && !caps?.write;
            return (
              <button
                key={t.id}
                type="button"
                className={`tool-btn${toolId === t.id ? ' active' : ''}`}
                aria-pressed={toolId === t.id}
                aria-label={t.title}
                title={disabled ? `${t.title} — ${hint ?? 'нет права записи'}` : `${t.title}${t.hotkey ? ` (${t.hotkey})` : ''}`}
                disabled={disabled}
                onClick={() => setTool(t.id)}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------
//  Контекстная панель свойств (сверху)
// ---------------------------------------------------------------------

/** Общее значение поля у набора объектов; undefined — значения различаются. */
function commonValue(values: unknown[]): unknown {
  if (!values.length) return undefined;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : undefined;
}

export function PropertiesBar({ model, commands, theme }: { model: BoardModel; commands: BoardCommands; theme: CanvasTheme }) {
  const selection = useBoard((s) => s.selection);
  const toolId = useBoard((s) => s.toolId);
  const toolOptions = useBoard((s) => s.toolOptions);
  const setToolOptions = useBoard((s) => s.setToolOptions);
  const caps = useBoard((s) => s.caps);
  const pageId = useBoard((s) => s.pageId);
  // Перерисовка при изменении выделенных объектов.
  useSyncExternalStore(
    useCallback((cb) => (pageId ? model.subscribePage(pageId, cb) : () => undefined), [model, pageId]),
    () => (pageId ? model.pageVersion(pageId) : 0),
  );

  const tool = registry.getTool(toolId);
  const leaves = model.leaves(selection);
  const entries = leaves.map((id) => model.get(id)!).filter(Boolean);

  // Поля, общие для всех выделенных типов.
  const fields: InspectorField[] = useMemo(() => {
    if (!entries.length) return [];
    const lists = entries.map((e) => e.module?.inspector ?? []);
    return lists[0]!.filter((f) => lists.every((l) => l.some((x) => x.key === f.key && x.kind === f.kind)));
  }, [entries]);

  const canEdit = leaves.length > 0 && leaves.every((id) => model.canModify(id, 'props'));
  const anyLocked = leaves.some((id) => model.getObject(id)?.locked);
  const hasGroup = selection.some((id) => model.getObject(id)?.type === 'core.group');

  if (selection.length === 0 && tool?.options?.length) {
    return (
      <div className="board-props" aria-label="Параметры инструмента">
        <span className="board-props__title">{tool.title}</span>
        {tool.options.map((f) => (
          <InspectorFieldView
            key={f.key}
            field={f}
            theme={theme}
            value={(toolOptions as unknown as Record<string, unknown>)[f.key]}
            onChange={(v) => setToolOptions({ [f.key]: v })}
          />
        ))}
      </div>
    );
  }
  if (selection.length === 0) {
    return <div className="board-props board-props--empty muted small">Выберите инструмент или объект</div>;
  }

  return (
    <div className="board-props" aria-label="Свойства выделения">
      <span className="board-props__title">
        {selection.length === 1 ? (entries[0]?.module?.title ?? 'Объект') : `Выбрано: ${selection.length}`}
        {anyLocked && <Lock size={14} aria-label="заблокировано" />}
      </span>
      {fields.map((f) => (
        <InspectorFieldView
          key={f.key}
          field={f}
          theme={theme}
          disabled={!canEdit}
          value={commonValue(entries.map((e) => (e.obj.props as Record<string, unknown>)[f.key]))}
          onChange={(v) => model.updateObjects(leaves.map((id) => ({ id, patch: { props: { [f.key]: v } } })))}
        />
      ))}
      <div className="spacer" />
      <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
        <Button size="small" variant="ghost" iconOnly icon={<Copy size={16} />} title="Дублировать (Ctrl+D)" aria-label="Дублировать" disabled={!caps?.write} onClick={() => commands.duplicate()} />
        <Button size="small" variant="ghost" iconOnly icon={<ArrowUpToLine size={16} />} title="На передний план (Ctrl+Shift+])" aria-label="На передний план" disabled={!canEdit} onClick={() => commands.reorder('front')} />
        <Button size="small" variant="ghost" iconOnly icon={<ArrowDownToLine size={16} />} title="На задний план (Ctrl+Shift+[)" aria-label="На задний план" disabled={!canEdit} onClick={() => commands.reorder('back')} />
        {selection.length > 1 && (
          <Button size="small" variant="ghost" iconOnly icon={<GroupIcon size={16} />} title="Сгруппировать (Ctrl+G)" aria-label="Сгруппировать" disabled={!canEdit} onClick={() => commands.group()} />
        )}
        {hasGroup && (
          <Button size="small" variant="ghost" iconOnly icon={<Ungroup size={16} />} title="Разгруппировать (Ctrl+Shift+G)" aria-label="Разгруппировать" disabled={!canEdit} onClick={() => commands.ungroup()} />
        )}
        {caps?.moderate && (
          <Button
            size="small"
            variant="ghost"
            iconOnly
            icon={anyLocked ? <Unlock size={16} /> : <Lock size={16} />}
            title={anyLocked ? 'Снять блокировку (Ctrl+L)' : 'Заблокировать: ученики не смогут сдвинуть или стереть (Ctrl+L)'}
            aria-label={anyLocked ? 'Снять блокировку' : 'Заблокировать'}
            onClick={() => commands.toggleLock()}
          />
        )}
        <Button
          size="small"
          variant="ghost"
          iconOnly
          icon={<Trash2 size={16} />}
          title="Удалить (Delete)"
          aria-label="Удалить"
          disabled={!leaves.some((id) => model.canDelete(id))}
          onClick={() => commands.deleteSelection()}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
//  Вкладки страниц (снизу)
// ---------------------------------------------------------------------

export function PageTabs({ model }: { model: BoardModel }) {
  useSyncExternalStore(useCallback((cb) => model.subscribePages(cb), [model]), () => model.pagesStamp);
  const pageId = useBoard((s) => s.pageId);
  const setPage = useBoard((s) => s.setPage);
  const caps = useBoard((s) => s.caps);
  const pages = model.pages();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [bgFor, setBgFor] = useState<PageRecord | null>(null);
  const [deleting, setDeleting] = useState<PageRecord | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const canPages = !!caps?.managePages;

  const startRename = (p: PageRecord) => {
    if (!canPages) return;
    setRenaming(p.id);
    setTitle(p.title);
  };
  const commitRename = () => {
    if (renaming) model.renamePage(renaming, title);
    setRenaming(null);
  };

  return (
    <div className="page-tabs" role="tablist" aria-label="Страницы доски">
      {pages.map((p, i) => (
        <div
          key={p.id}
          className={`page-tab${p.id === pageId ? ' active' : ''}${dragId && dragId !== p.id ? ' drop-target' : ''}`}
          draggable={canPages && renaming !== p.id}
          onDragStart={(e) => {
            setDragId(p.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== p.id) model.movePage(dragId, p.id);
            setDragId(null);
          }}
        >
          {renaming === p.id ? (
            <input
              className="input input--small"
              value={title}
              autoFocus
              maxLength={100}
              aria-label="Название страницы"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              role="tab"
              aria-selected={p.id === pageId}
              className="page-tab__btn"
              title={canPages ? 'Двойной щелчок — переименовать, перетащите для изменения порядка' : p.title}
              onClick={() => setPage(p.id)}
              onDoubleClick={() => startRename(p)}
            >
              {p.title || `Страница ${i + 1}`}
            </button>
          )}
          {p.id === pageId && (canPages || !!caps?.moderate) && (
            <ActionMenu
              label="Действия со страницей"
              items={[
                { label: 'Переименовать', hidden: !canPages, onSelect: () => startRename(p) },
                { label: 'Сдвинуть влево', icon: <ChevronLeft size={16} />, hidden: !canPages || i === 0, onSelect: () => model.movePage(p.id, pages[i - 1]!.id) },
                {
                  label: 'Сдвинуть вправо',
                  icon: <ChevronRight size={16} />,
                  hidden: !canPages || i === pages.length - 1,
                  onSelect: () => model.movePage(p.id, pages[i + 2]?.id ?? null),
                },
                { label: 'Фон страницы', icon: <Settings2 size={16} />, hidden: !caps?.moderate, onSelect: () => setBgFor(p) },
                { label: 'Удалить страницу', icon: <Trash2 size={16} />, danger: true, hidden: !canPages || pages.length <= 1, onSelect: () => setDeleting(p) },
              ]}
            />
          )}
        </div>
      ))}
      {canPages && (
        <Button
          size="small"
          variant="ghost"
          iconOnly
          icon={<Plus size={16} />}
          aria-label="Добавить страницу"
          title="Добавить страницу"
          onClick={() => {
            const id = model.addPage(undefined, pageId ?? undefined);
            if (id) setPage(id);
          }}
        />
      )}
      <BackgroundDialog model={model} page={bgFor} onClose={() => setBgFor(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Удалить страницу?"
        message={<>Страница «{deleting?.title}» и все объекты на ней будут удалены. Отменить можно через Ctrl+Z.</>}
        confirmLabel="Удалить"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting && !model.deletePage(deleting.id)) toast.error('На странице есть объекты, которые вы не можете удалить');
          setDeleting(null);
        }}
      />
    </div>
  );
}

function BackgroundDialog({ model, page, onClose }: { model: BoardModel; page: PageRecord | null; onClose: () => void }) {
  const [kind, setKind] = useState(page?.background.kind ?? 'grid');
  const [step, setStep] = useState(String(page?.background.step ?? 20));
  const [chalk, setChalk] = useState(page?.background.surface === 'chalk');
  const [locked, setLocked] = useState(page?.backgroundLocked ?? false);
  useEffect(() => {
    if (!page) return;
    setKind(page.background.kind);
    setStep(String(page.background.step));
    setChalk(page.background.surface === 'chalk');
    setLocked(page.backgroundLocked);
  }, [page]);
  const stepNum = Number(step);
  const stepOk = Number.isFinite(stepNum) && stepNum >= 4 && stepNum <= 400;
  return (
    <Dialog
      open={!!page}
      onClose={onClose}
      title="Фон страницы"
      onSubmit={() => {
        if (!page || !stepOk) return;
        model.transact(() => {
          model.setBackground(page.id, { kind, step: stepNum, surface: chalk ? 'chalk' : 'auto' });
          if (locked !== page.backgroundLocked) model.setBackgroundLocked(page.id, locked);
        });
        onClose();
      }}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!stepOk}>
            Применить
          </Button>
        </>
      }
    >
      <SelectField label="Сетка" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        {BACKGROUND_KINDS.map((k) => (
          <option key={k} value={k}>
            {BACKGROUND_LABELS[k]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Шаг сетки"
        type="number"
        min={4}
        max={400}
        value={step}
        errors={stepOk ? undefined : ['От 4 до 400']}
        hint="20 — клетка тетради (5 мм) при масштабе 100 %"
        onChange={(e) => setStep(e.target.value)}
      />
      <Checkbox label="Меловая доска (тёмно-зелёный фон)" checked={chalk} onChange={(e) => setChalk(e.target.checked)} />
      <Checkbox
        label="Заблокировать фон: ученики не смогут менять подложку и объекты фонового слоя"
        checked={locked}
        onChange={(e) => setLocked(e.target.checked)}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------
//  Масштаб
// ---------------------------------------------------------------------

export function ZoomControls({ commands }: { commands: BoardCommands }) {
  const zoom = useBoard((s) => (s.pageId ? s.cameras[s.pageId]?.zoom : undefined) ?? currentCamera().zoom);
  return (
    <div className="zoom-controls" role="group" aria-label="Масштаб">
      <Button size="small" variant="ghost" iconOnly icon={<ZoomOut size={16} />} aria-label="Уменьшить (Ctrl+−)" title="Уменьшить (Ctrl+−)" onClick={() => commands.zoomStep(-1)} />
      <button type="button" className="zoom-controls__value" title="Масштаб 100 % (Ctrl+0)" onClick={() => commands.zoomTo(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <Button size="small" variant="ghost" iconOnly icon={<ZoomIn size={16} />} aria-label="Увеличить (Ctrl+=)" title="Увеличить (Ctrl+=)" onClick={() => commands.zoomStep(1)} />
      <Button size="small" variant="ghost" iconOnly icon={<Maximize size={16} />} aria-label="Показать всё (Shift+1)" title="Показать всё (Shift+1)" onClick={() => commands.fit(false)} />
    </div>
  );
}

