/**
 * Точные рациональные числа (BigInt): линейная алгебра на доске считается
 * без ошибок округления и показывает обыкновенные дроби, как в тетради.
 */

const babs = (a: bigint) => (a < 0n ? -a : a);
function gcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('Деление на ноль');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }

  static readonly ZERO = new Q(0n);
  static readonly ONE = new Q(1n);
  static of(v: number | bigint): Q {
    if (typeof v === 'bigint') return new Q(v);
    if (Number.isInteger(v)) return new Q(BigInt(v));
    return parseQ(String(v)) ?? Q.ZERO;
  }

  add(o: Q): Q {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Q): Q {
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Q): Q {
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o: Q): Q {
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg(): Q {
    return new Q(-this.n, this.d);
  }
  isZero(): boolean {
    return this.n === 0n;
  }
  eq(o: Q): boolean {
    return this.n === o.n && this.d === o.d;
  }
  sign(): number {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
  /** «−2/3», «5». */
  toString(): string {
    const s = this.d === 1n ? babs(this.n).toString() : `${babs(this.n)}/${this.d}`;
    return this.n < 0n ? `−${s}` : s;
  }
}

/** Разбор ячейки: «3», «−2/3», «1,5», «0.25», «-7». null — не число. */
export function parseQ(src: string): Q | null {
  const s = src.trim().replace(/[−–]/g, '-').replace(',', '.');
  if (!s) return null;
  let m = /^([+-]?)(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) return m[3] === '0' ? null : new Q(BigInt(m[2]!) * (m[1] === '-' ? -1n : 1n), BigInt(m[3]!));
  m = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  const n = BigInt((m[2] || '0') + frac) * (m[1] === '-' ? -1n : 1n);
  return new Q(n, 10n ** BigInt(frac.length));
}
