/**
 * Разбор и формирование CSV для импорта пользователей и выгрузки
 * временных паролей. Поддерживается то, что реально выдаёт Excel/LibreOffice/
 * Google Таблицы: разделители «;», «,» или табуляция (определяются
 * автоматически), кавычки с удвоением, переводы строк внутри кавычек,
 * BOM, CRLF.
 */

export type CsvDelimiter = ';' | ',' | '\t';

export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts: [CsvDelimiter, number][] = [
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ';';
}

export interface CsvRow {
  /** Номер строки файла (с 1), на которой начинается запись. */
  line: number;
  cells: string[];
}

/** Разбор CSV в массив строк (пустые строки пропускаются). */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  return parseCsvRows(text, delimiter).map((r) => r.cells);
}

/**
 * Разбор CSV с номерами строк исходного файла — чтобы сообщения об ошибках
 * импорта указывали на строку, которую пользователь видит в редакторе,
 * даже если в файле есть пустые строки или переносы внутри кавычек.
 */
export function parseCsvRows(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): CsvRow[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let line = 1;
  let rowStart = 1;
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === '\n') line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push({ line: rowStart, cells: row.map((f) => f.trim()) });
      row = [];
      if (ch === '\r' && src[i + 1] === '\n') i++;
      i++;
      line++;
      rowStart = line;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push({ line: rowStart, cells: row.map((f) => f.trim()) });
  return rows;
}

function escapeField(value: string, delimiter: string): string {
  // Защита от CSV-инъекций формул в Excel: значения, начинающиеся с = + - @,
  // экранируются апострофом.
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (v.includes('"') || v.includes(delimiter) || /[\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** CSV с BOM (корректно открывается в Excel с кириллицей), разделитель «;». */
export function toCsv(rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ';'): string {
  return '\uFEFF' + rows.map((r) => r.map((f) => escapeField(f, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

export interface Credential {
  fullName: string;
  login: string;
  tempPassword: string;
  className?: string | null;
}

/** Таблица логинов и временных паролей для печати/выгрузки. */
export function credentialsToCsv(items: readonly Credential[]): string {
  return toCsv([
    ['ФИО', 'Класс', 'Логин', 'Временный пароль'],
    ...items.map((c) => [c.fullName, c.className ?? '', c.login, c.tempPassword]),
  ]);
}
