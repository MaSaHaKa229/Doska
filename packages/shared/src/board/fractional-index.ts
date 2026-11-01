/**
 * Дробные индексы (fractional indexing) для порядка слоёв (z-order) объектов
 * и порядка страниц.
 *
 * Зачем: в CRDT нельзя хранить порядок как «номер в массиве» — при
 * одновременных перестановках у разных пользователей номера конфликтуют.
 * Вместо этого у каждого объекта есть строковый ключ `z`, и порядок
 * определяется лексикографическим сравнением ключей. Чтобы поставить объект
 * между A и B, генерируется новый ключ строго между ключами A и B; остальные
 * объекты не меняются (одна запись в Yjs вместо перенумерации).
 *
 * Формат ключа (алгоритм Д. Гринспена): «целая часть» + «дробная часть».
 *  - Первый символ целой части кодирует её длину: 'a'..'z' → 2..27 символов
 *    (положительные), 'Z'..'A' → 2..27 символов (отрицательные).
 *  - Цифры — base62 в порядке ASCII: 0-9, A-Z, a-z, поэтому обычное сравнение
 *    строк JS (`<`, не localeCompare!) совпадает с числовым порядком.
 *  - Дробная часть не может оканчиваться на '0' (иначе между "a1" и "a10"
 *    не нашлось бы ключа).
 * Первый ключ — "a0". Вставка в конец/начало увеличивает/уменьшает целую
 * часть (ключи растут логарифмически), вставка в середину удлиняет дробную.
 *
 * Если два клиента одновременно вставили объект в одно и то же место, ключи
 * совпадут; поэтому окончательная сортировка — по паре (z, id), см. compareOrder.
 */

export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = BASE_62_DIGITS[0] as string;
const LAST = BASE_62_DIGITS[BASE_62_DIGITS.length - 1] as string;
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

function digitIndex(ch: string | undefined): number {
  if (ch === undefined) return -1;
  return BASE_62_DIGITS.indexOf(ch);
}

/** Середина между дробными частями a < b (b = null означает «бесконечность»). */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`fractional-index: ${a} >= ${b}`);
  }
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO)) {
    throw new Error('fractional-index: дробная часть оканчивается нулём');
  }
  if (b !== null) {
    // Общий префикс (недостающие цифры a считаются нулями).
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a.length > 0 ? digitIndex(a[0]) : 0;
  const digitB = b !== null ? digitIndex(b[0]) : BASE_62_DIGITS.length;
  if (digitB - digitA > 1) {
    return BASE_62_DIGITS[Math.round(0.5 * (digitA + digitB))] as string;
  }
  // Соседние цифры: берём цифру a и уходим на разряд глубже.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return BASE_62_DIGITS[digitA] + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`fractional-index: неверный первый символ ключа «${head}»`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0] ?? '');
  if (len > key.length) throw new Error(`fractional-index: неверный ключ «${key}»`);
  return key.slice(0, len);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0] ?? '')) {
    throw new Error(`fractional-index: неверная целая часть «${int}»`);
  }
}

export function isValidOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`fractional-index: неверный ключ «${key}»`);
  const i = integerPart(key);
  const f = key.slice(i.length);
  for (const ch of key.slice(1)) {
    if (digitIndex(ch) < 0) throw new Error(`fractional-index: недопустимый символ в «${key}»`);
  }
  if (f.slice(-1) === ZERO) throw new Error(`fractional-index: неверный ключ «${key}»`);
}

function incrementInteger(x: string): string | null {
  validateInteger(x);
  const head = x[0] as string;
  const digs = x.slice(1).split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digitIndex(digs[i]) + 1;
    if (d === BASE_62_DIGITS.length) {
      digs[i] = ZERO;
    } else {
      digs[i] = BASE_62_DIGITS[d] as string;
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') return 'a' + ZERO;
    if (head === 'z') return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > 'a') digs.push(ZERO);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

function decrementInteger(x: string): string | null {
  validateInteger(x);
  const head = x[0] as string;
  const digs = x.slice(1).split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digitIndex(digs[i]) - 1;
    if (d === -1) {
      digs[i] = LAST;
    } else {
      digs[i] = BASE_62_DIGITS[d] as string;
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + LAST;
    if (head === 'A') return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < 'Z') digs.push(LAST);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

/**
 * Ключ строго между a и b. a = null — «до самого первого», b = null —
 * «после самого последнего». Требуется a < b.
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) {
    throw new Error(`fractional-index: ${a} >= ${b}`);
  }
  if (a === null) {
    if (b === null) return 'a' + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('fractional-index: исчерпан диапазон ключей снизу');
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('fractional-index: исчерпан диапазон ключей сверху');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** n упорядоченных ключей между a и b (равномерно, чтобы ключи были короткими). */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c);
      result.push(c);
    }
    return result.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b);
  return [...generateNKeysBetween(a, c, mid), c, ...generateNKeysBetween(c, b, n - mid - 1)];
}

/** Итоговый порядок отрисовки: по ключу z, при равенстве — по id. */
export function compareOrder(a: { z: string; id: string }, b: { z: string; id: string }): number {
  if (a.z < b.z) return -1;
  if (a.z > b.z) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
