import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '@doska/shared';
import { registry } from '../plugins/registry';

describe('встроенные шаблоны', () => {
  it('ключи уникальны, разделы — существующие плагины', () => {
    const keys = BUILTIN_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of BUILTIN_TEMPLATES) expect(registry.listPlugins().some((p) => p.id === t.section), t.section).toBe(true);
  });

  it('объекты: тип есть, свойства проходят схему модуля, версия и зависимости верны', () => {
    for (const t of BUILTIN_TEMPLATES) {
      t.objects.forEach((o, i) => {
        const m = registry.getObjectModule(o.type);
        expect(m, `${t.key}: ${o.type}`).toBeTruthy();
        const parsed = m!.propsSchema.safeParse(o.props);
        expect(parsed.success, `${t.key}: ${o.type} — ${parsed.success ? '' : JSON.stringify(parsed.error.issues[0])}`).toBe(true);
        expect(o.v ?? 1, `${t.key}: версия ${o.type}`).toBe(m!.version);
        for (const d of o.deps ?? []) expect(d >= 0 && d < i, `${t.key}: зависимость ${d}`).toBe(true);
      });
    }
  });
});

describe('разделы библиотеки', () => {
  it('каждый плагин математики и физики есть в TEMPLATE_SECTIONS с тем же названием', async () => {
    const { TEMPLATE_SECTIONS } = await import('@doska/shared');
    for (const p of registry.listPlugins().filter((x) => x.id.startsWith('math.') || x.id.startsWith('physics.'))) {
      expect(TEMPLATE_SECTIONS.find((s) => s.id === p.id)?.title, p.id).toBe(p.title);
    }
  });
});
