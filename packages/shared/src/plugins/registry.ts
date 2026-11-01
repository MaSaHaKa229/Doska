import type {
  BoardPlugin,
  CommandDescriptor,
  ObjectModule,
  ReferenceEntry,
  TemplateDescriptor,
  ToolModule,
} from './types.js';
import { OBJECT_TYPE_RE } from '../board/object.js';

/**
 * Реестр плагинов. Ядро получает модули объектов и инструменты только
 * отсюда. Регистрация проверяет пространства имён, чтобы разделы не
 * конфликтовали: тип объекта и id инструмента обязаны начинаться с id плагина.
 */

export const PLUGIN_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){0,3}$/;

export interface RegistryWarning {
  kind: 'hotkey-conflict';
  message: string;
}

export interface SearchResult {
  kind: 'tool' | 'command' | 'template' | 'reference';
  id: string;
  title: string;
  section?: string;
  score: number;
}

/** Нормализация для поиска: регистр, ё→е, лишние пробелы, латиница/кириллица как есть. */
export function normalizeSearchText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function isInNamespace(name: string, pluginId: string): boolean {
  return name.startsWith(pluginId + '.');
}

/**
 * Оценка совпадения запроса с названием и ключевыми словами (0 — не подходит):
 * точное совпадение названия 100, начало названия 80, начало слова названия 70,
 * начало ключевого слова 60, подстрока названия 40, подстрока ключевого слова 30.
 * Все слова запроса должны найтись (берётся минимальная оценка по словам).
 */
export function searchScore(query: string, title: string, keywords: readonly string[]): number {
  const q = normalizeSearchText(query);
  if (!q) return 0;
  const words = q.split(' ');
  const t = normalizeSearchText(title);
  const kws = keywords.map(normalizeSearchText);
  let total = Infinity;
  for (const w of words) {
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(w)) s = 80;
    else if (t.split(/[\s\-—–«»(),]+/).some((tw) => tw.startsWith(w))) s = 70;
    else if (kws.some((k) => k.startsWith(w) || k.split(' ').some((kw) => kw.startsWith(w)))) s = 60;
    else if (t.includes(w)) s = 40;
    else if (kws.some((k) => k.includes(w))) s = 30;
    total = Math.min(total, s);
  }
  return total === Infinity ? 0 : total;
}

export class PluginRegistry<R = unknown> {
  private readonly plugins = new Map<string, BoardPlugin<R>>();
  private readonly objects = new Map<string, ObjectModule<any, R>>();
  private readonly tools = new Map<string, ToolModule<R>>();
  private readonly commands = new Map<string, CommandDescriptor>();
  private readonly templates = new Map<string, TemplateDescriptor>();
  private readonly references = new Map<string, ReferenceEntry>();
  private readonly hotkeys = new Map<string, string>();
  readonly warnings: RegistryWarning[] = [];

  register(plugin: BoardPlugin<R>): void {
    if (!PLUGIN_ID_RE.test(plugin.id)) {
      throw new Error(`Плагин: недопустимый id «${plugin.id}»`);
    }
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Плагин «${plugin.id}» уже зарегистрирован`);
    }
    for (const dep of plugin.dependsOn ?? []) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Плагин «${plugin.id}» требует «${dep}», который не зарегистрирован`);
      }
    }

    // Сначала проверяем всё, потом добавляем — регистрация атомарна.
    for (const m of plugin.objects ?? []) {
      if (!OBJECT_TYPE_RE.test(m.type) || !isInNamespace(m.type, plugin.id)) {
        throw new Error(`Плагин «${plugin.id}»: тип объекта «${m.type}» вне пространства имён плагина`);
      }
      if (this.objects.has(m.type)) throw new Error(`Тип объекта «${m.type}» уже зарегистрирован`);
      if (!Number.isInteger(m.version) || m.version < 1) {
        throw new Error(`Тип объекта «${m.type}»: версия должна быть целым числом ≥ 1`);
      }
    }
    for (const t of plugin.tools ?? []) {
      if (!isInNamespace(t.id, plugin.id)) {
        throw new Error(`Плагин «${plugin.id}»: инструмент «${t.id}» вне пространства имён плагина`);
      }
      if (this.tools.has(t.id)) throw new Error(`Инструмент «${t.id}» уже зарегистрирован`);
    }
    for (const c of plugin.commands ?? []) {
      if (this.commands.has(c.id)) throw new Error(`Команда «${c.id}» уже зарегистрирована`);
    }
    for (const t of plugin.templates ?? []) {
      if (this.templates.has(t.key)) throw new Error(`Шаблон «${t.key}» уже зарегистрирован`);
    }

    this.plugins.set(plugin.id, plugin);
    for (const m of plugin.objects ?? []) this.objects.set(m.type, m);
    for (const t of plugin.tools ?? []) {
      this.tools.set(t.id, t);
      if (t.hotkey) {
        const key = t.hotkey.toLowerCase();
        const existing = this.hotkeys.get(key);
        if (existing) {
          // Конфликт не фатален: первый зарегистрированный сохраняет клавишу.
          this.warnings.push({
            kind: 'hotkey-conflict',
            message: `Клавиша ${t.hotkey} уже назначена «${existing}»; у «${t.id}» она отключена`,
          });
        } else {
          this.hotkeys.set(key, t.id);
        }
      }
    }
    for (const c of plugin.commands ?? []) this.commands.set(c.id, c);
    for (const t of plugin.templates ?? []) this.templates.set(t.key, t);
    for (const r of plugin.references ?? []) this.references.set(r.id, r);
  }

  getObjectModule(type: string): ObjectModule<any, R> | undefined {
    return this.objects.get(type);
  }

  getTool(id: string): ToolModule<R> | undefined {
    return this.tools.get(id);
  }

  getCommand(id: string): CommandDescriptor | undefined {
    return this.commands.get(id);
  }

  getToolByHotkey(hotkey: string): ToolModule<R> | undefined {
    const id = this.hotkeys.get(hotkey.toLowerCase());
    return id ? this.tools.get(id) : undefined;
  }

  listPlugins(): BoardPlugin<R>[] {
    return [...this.plugins.values()];
  }

  listTools(): ToolModule<R>[] {
    return [...this.tools.values()];
  }

  listTemplates(): TemplateDescriptor[] {
    return [...this.templates.values()];
  }

  listReferences(): ReferenceEntry[] {
    return [...this.references.values()];
  }

  /**
   * Поиск для палитры Ctrl+K. Ранжирование:
   *  точное совпадение названия 100, начало названия 80,
   *  начало слова названия 70, начало ключевого слова 60,
   *  подстрока названия 40, подстрока ключевого слова 30.
   * Все слова запроса должны найтись (берётся минимальная оценка по словам).
   */
  search(query: string, limit = 20): SearchResult[] {
    const q = normalizeSearchText(query);
    if (!q) return [];
    const results: SearchResult[] = [];

    const scoreOf = (title: string, keywords: string[]) => searchScore(q, title, keywords);

    for (const t of this.tools.values()) {
      const score = scoreOf(t.title, t.keywords);
      if (score > 0) results.push({ kind: 'tool', id: t.id, title: t.title, section: t.section, score: score + 5 });
    }
    for (const c of this.commands.values()) {
      const score = scoreOf(c.title, c.keywords);
      if (score > 0) results.push({ kind: 'command', id: c.id, title: c.title, section: c.section, score });
    }
    for (const t of this.templates.values()) {
      const score = scoreOf(t.title, t.tags);
      if (score > 0) results.push({ kind: 'template', id: t.key, title: t.title, section: t.section, score: score - 5 });
    }
    for (const r of this.references.values()) {
      const score = scoreOf(r.title, r.keywords);
      if (score > 0) results.push({ kind: 'reference', id: r.id, title: r.title, section: r.section, score: score - 10 });
    }

    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'));
    return results.slice(0, limit);
  }
}
