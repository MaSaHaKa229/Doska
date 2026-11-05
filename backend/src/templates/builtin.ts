import * as Y from 'yjs';
import type { PrismaClient } from '@prisma/client';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_BACKGROUND,
  DOC_ROOTS,
  DOC_SCHEMA_VERSION,
  createObjectBase,
  generateKeyBetween,
  generateNKeysBetween,
  newEntityId,
  type BuiltinTemplate,
  type JsonValue,
  type PageRecord,
} from '@doska/shared';

/** Высота текстового блока условия: строки по ~62 знака при ширине 560. */
const taskHeight = (text: string) => Math.ceil(text.length / 62) * 24 + 19;

/**
 * Документ встроенного шаблона: одна страница, условие задачи текстовым
 * блоком вверху и объекты раздела. Зависимости (номера) → id объектов.
 */
export function buildTemplateDoc(t: BuiltinTemplate, ownerId: string, now = Date.now()): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap(DOC_ROOTS.meta);
    meta.set('schemaVersion', DOC_SCHEMA_VERSION);
    meta.set('createdAt', now);
    const page: PageRecord = {
      id: newEntityId(),
      title: 'Страница 1',
      order: generateKeyBetween(null, null),
      background: { ...DEFAULT_BACKGROUND },
      backgroundLocked: false,
      createdBy: ownerId,
      createdAt: now,
    };
    doc.getMap(DOC_ROOTS.pages).set(page.id, new Y.Map(Object.entries(page)));
    const objects = doc.getMap(DOC_ROOTS.objects);
    const zs = generateNKeysBetween(null, null, t.objects.length + 1);
    const ids = t.objects.map(() => newEntityId());
    const put = (id: string, type: string, v: number, x: number, y: number, z: string, props: Record<string, JsonValue>, deps: string[]) => {
      const base = createObjectBase({ id, type, pageId: page.id, z, userId: ownerId, now, v, x, y });
      objects.set(id, new Y.Map(Object.entries({ ...base, deps, props })));
    };
    put(newEntityId(), 'core.text', 1, 40, 20, zs[0]!, {
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: t.title }] }, { type: 'paragraph', content: [{ type: 'text', text: t.task }] }] },
      w: 560,
      h: taskHeight(t.task) + 24,
      fill: 'none',
    }, []);
    t.objects.forEach((o, i) => put(ids[i]!, o.type, o.v ?? 1, o.x, o.y, zs[i + 1]!, o.props, (o.deps ?? []).map((d) => ids[d]!)));
  });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/**
 * Встроенные шаблоны: создаются один раз по ключу (при запуске сервера и в
 * сиде). Владелец доски — первый администратор: администратор только
 * просматривает доски, поэтому встроенные шаблоны никто не изменит.
 * Без администратора (до первого сида) — ничего не делает.
 */
export async function ensureBuiltinTemplates(prisma: PrismaClient): Promise<number> {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!admin) return 0;
  const have = new Set((await prisma.template.findMany({ where: { builtinKey: { not: null } }, select: { builtinKey: true } })).map((t) => t.builtinKey));
  let created = 0;
  for (const t of BUILTIN_TEMPLATES) {
    if (have.has(t.key)) continue;
    const state = buildTemplateDoc(t, admin.id);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const sv = Y.encodeStateVector(doc);
    const objectCount = doc.getMap(DOC_ROOTS.objects).size;
    doc.destroy();
    await prisma.board.create({
      data: {
        kind: 'TEMPLATE',
        title: t.title,
        description: t.description,
        ownerId: admin.id,
        objectCount,
        document: { create: { state: Buffer.from(state), stateVector: Buffer.from(sv), sizeBytes: state.byteLength } },
        template: { create: { builtinKey: t.key, title: t.title, description: t.description, section: t.section, level: t.level, tags: t.tags, visibility: 'BUILTIN', authorId: null } },
      },
    });
    created++;
  }
  return created;
}
