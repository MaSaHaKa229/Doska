import type { FolderView } from '@doska/shared';

export interface FolderNode extends FolderView {
  depth: number;
}

/** Плоский список папок в порядке обхода дерева (для отрисовки с отступами и select). */
export function flattenFolders(folders: FolderView[]): FolderNode[] {
  const byParent = new Map<string | null, FolderView[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const out: FolderNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ ...f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** id папки и всех вложенных (нельзя переместить папку в собственного потомка). */
export function descendantsOf(folders: FolderView[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        grew = true;
      }
    }
  }
  return result;
}
