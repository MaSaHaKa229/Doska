import type { PrismaClient } from '@prisma/client';
import type { FolderView } from '@doska/shared';
import { Errors } from '../common/errors.js';

const MAX_DEPTH = 5;

/** Папки досок учителя (дерево глубиной до 5 уровней). */
export class FoldersService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(ownerId: string): Promise<FolderView[]> {
    const folders = await this.prisma.folder.findMany({
      where: { ownerId },
      include: { _count: { select: { boards: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
    });
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      boardCount: f._count.boards,
      createdAt: f.createdAt.toISOString(),
    }));
  }

  private async owned(ownerId: string, id: string) {
    const f = await this.prisma.folder.findFirst({ where: { id, ownerId } });
    if (!f) throw Errors.notFound('Папка не найдена');
    return f;
  }

  /** Имя уникально среди соседних папок (NULL parentId не покрывается уникальным индексом). */
  private async assertNameFree(ownerId: string, parentId: string | null, name: string, exceptId?: string) {
    const dup = await this.prisma.folder.findFirst({
      where: { ownerId, parentId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw Errors.conflict(`Папка «${name}» здесь уже есть`);
  }

  /** Глубина папки (1 — в корне) и проверка, что parent не лежит внутри folderId (нет циклов). */
  private async depthOf(ownerId: string, parentId: string | null, movingId?: string): Promise<number> {
    let depth = 1;
    let current = parentId;
    while (current) {
      if (current === movingId) throw Errors.validation({ parentId: ['Нельзя переместить папку внутрь самой себя'] });
      const f = await this.owned(ownerId, current);
      current = f.parentId;
      depth++;
      if (depth > 50) break;
    }
    return depth;
  }

  private async subtreeHeight(id: string): Promise<number> {
    const children = await this.prisma.folder.findMany({ where: { parentId: id }, select: { id: true } });
    if (!children.length) return 1;
    const heights = await Promise.all(children.map((c) => this.subtreeHeight(c.id)));
    return 1 + Math.max(...heights);
  }

  async create(ownerId: string, name: string, parentId: string | null): Promise<FolderView> {
    if (parentId) await this.owned(ownerId, parentId);
    if ((await this.depthOf(ownerId, parentId)) > MAX_DEPTH) {
      throw Errors.validation({ parentId: [`Не больше ${MAX_DEPTH} уровней вложенности`] });
    }
    await this.assertNameFree(ownerId, parentId, name);
    const f = await this.prisma.folder.create({ data: { ownerId, name, parentId } });
    return { id: f.id, name: f.name, parentId: f.parentId, boardCount: 0, createdAt: f.createdAt.toISOString() };
  }

  async update(ownerId: string, id: string, input: { name?: string; parentId?: string | null }): Promise<FolderView> {
    const f = await this.owned(ownerId, id);
    const name = input.name ?? f.name;
    const parentId = input.parentId === undefined ? f.parentId : input.parentId;
    if (parentId !== f.parentId) {
      const depth = await this.depthOf(ownerId, parentId, id);
      if (depth - 1 + (await this.subtreeHeight(id)) > MAX_DEPTH) {
        throw Errors.validation({ parentId: [`Не больше ${MAX_DEPTH} уровней вложенности`] });
      }
    }
    if (name !== f.name || parentId !== f.parentId) await this.assertNameFree(ownerId, parentId, name, id);
    await this.prisma.folder.update({ where: { id }, data: { name, parentId } });
    return (await this.list(ownerId)).find((x) => x.id === id)!;
  }

  /** Удаление папки: вложенные папки удаляются, доски из них переходят в корень. */
  async delete(ownerId: string, id: string): Promise<void> {
    await this.owned(ownerId, id);
    await this.prisma.folder.delete({ where: { id } });
  }
}
