/**
 * Транслитерация русских ФИО для генерации логинов.
 * Используется упрощённая схема, близкая к паспортной (ИКАО Doc 9303 / приказ МВД):
 * понятная школьникам и без диакритики.
 */
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
  // украинские/белорусские буквы, встречающиеся в фамилиях
  і: 'i', ї: 'i', є: 'ie', ґ: 'g', ў: 'u',
};

export function transliterate(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    if (ch in MAP) out += MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\s\-_.]/.test(ch)) out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Базовый логин из ФИО: «Иванов Пётр Сергеевич» → «ivanov.ps»,
 * «Анна-Мария Смит» (фамилия первой не обязательно) — берётся первое слово
 * как фамилия, инициалы — из остальных. Результат удовлетворяет LOGIN_RE
 * (уникальность обеспечивает сервер, добавляя номер: ivanov.ps2).
 */
export function suggestLoginBase(fullName: string): string {
  const parts = transliterate(fullName).split(' ').filter(Boolean);
  if (parts.length === 0) return 'user';
  const [surname, ...rest] = parts as [string, ...string[]];
  const initials = rest.map((p) => p[0]).join('');
  let base = (initials ? `${surname}.${initials}` : surname).replace(/[^a-z0-9.]/g, '');
  if (!/^[a-z0-9]/.test(base)) base = 'u' + base;
  if (base.length < 3) base = base.padEnd(3, '0');
  return base.slice(0, 56);
}

/** Первый свободный логин: base, base2, base3, … */
export function pickFreeLogin(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
