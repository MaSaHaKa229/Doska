/**
 * Чтение CSV-файла с автоопределением кодировки. Excel в русской локали
 * часто сохраняет CSV в Windows-1251; если файл не является корректным
 * UTF-8, он перечитывается как Windows-1251.
 */
export async function readTextFile(file: Blob): Promise<{ text: string; encoding: 'utf-8' | 'windows-1251' }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return decodeText(buf);
}

export function decodeText(buf: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1251' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(buf), encoding: 'windows-1251' };
  }
}

/** Скачать текст как файл. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
