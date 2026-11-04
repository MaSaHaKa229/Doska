import { createElement, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { BoardObject, EditorContext, PluginEditorProps } from '@doska/shared';
import type { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { useBoard } from '../../store/board';
import { toast } from '../../store/toast';
import { EDIT_OBJECT_EVENT, type EditObjectDetail } from '../../tools/formula-tools';

/** Редактор плагина по имени (BoardPlugin.editors). */
function pluginEditor(name: string): ComponentType<PluginEditorProps> | null {
  for (const p of registry.listPlugins()) {
    const ed = p.editors?.[name];
    if (ed) return ed as unknown as ComponentType<PluginEditorProps>;
  }
  return null;
}

/**
 * API записи на странице для редакторов плагинов и кнопок действий панели
 * свойств (ObjectModule.runAction): как у инструмента, без указателя.
 */
export function makeEditorContext(model: BoardModel, pageId: string): EditorContext {
  const st = () => useBoard.getState();
  return {
    get userId() {
      return model.userId;
    },
    pageId,
    get canWrite() {
      return !!st().caps?.write;
    },
    resolve: model.resolve,
    createObject: (type, init) => model.createObject(type, { ...init, pageId }) ?? '',
    updateObject: (id, patch) => void model.updateObjects([{ id, patch }]),
    deleteObjects: (ids) => void model.deleteObjects(ids),
    transact: (fn, opts) => model.transact(fn, opts),
    canModify: (id) => model.canModify(id, 'props'),
    listObjects: (type) =>
      model
        .pageObjects(pageId)
        .map((id) => model.getObject(id))
        .filter((o): o is BoardObject => !!o && (!type || o.type === type)),
    setSelection: (ids) => st().setSelection(ids),
    getToolOptions: <T,>() => st().toolOptions as T,
  };
}

/** Редактор открывается и без права изменения — для просмотра (BoardPlugin.viewers). */
const isViewer = (name: string) => registry.listPlugins().some((p) => p.viewers?.includes(name));

/**
 * Открывает редакторы объектов плагинов (двойной щелчок по объекту или
 * запрос инструмента) и даёт им API записи на текущей странице.
 */
export function PluginEditorsHost({ model }: { model: BoardModel }) {
  const [req, setReq] = useState<(EditObjectDetail & { readOnly: boolean }) | null>(null);
  const pageId = useBoard((s) => s.pageId);
  const caps = useBoard((s) => s.caps);

  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<EditObjectDetail>).detail;
      if (!pluginEditor(d.editor)) return;
      const readOnly = !!d.id && !model.canModify(d.id, 'props');
      if (readOnly && !isViewer(d.editor)) {
        toast.info('Этот объект нельзя изменить');
        return;
      }
      setReq({ ...d, readOnly });
    };
    window.addEventListener(EDIT_OBJECT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_OBJECT_EVENT, onEdit);
  }, [model]);

  const ctx = useMemo<EditorContext | null>(() => {
    if (!pageId) return null;
    return makeEditorContext(model, pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pageId, caps]);

  const Editor = req ? pluginEditor(req.editor) : null;
  if (!req || !Editor || !ctx) return null;
  return createElement(Editor, {
    key: `${req.editor}:${req.id ?? 'new'}`,
    objectId: req.id,
    at: req.at,
    ctx,
    close: () => setReq(null),
    readOnly: req.readOnly,
    subscribeObject: (id: string, l: () => void) => model.subscribeObject(id, l),
  }) as ReactNode;
}
