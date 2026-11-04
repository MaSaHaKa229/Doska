/**
 * Цепи постоянного тока (этап 7.3b): расчёт методом узловых потенциалов.
 *
 * Элемент соединяет два узла сетки a и b (координаты в клетках). Провода и
 * замкнутые ключи сливают узлы. Резистор, лампа, реостат — проводимость
 * 1/R; амперметр — очень малое сопротивление; вольтметр и разомкнутый ключ
 * в расчёт не входят (идеальные). Источник ЭДС (плюс — у b) с внутренним
 * сопротивлением r — эквивалентом «ток E/r и проводимость 1/r» (идеальный
 * источник — r = 10⁻⁴ Ом). Каждый узел соединён с «землёй» проводимостью
 * 10⁻⁹ См — изолированные части не делают систему вырожденной.
 */

export const PART_KINDS = ['wire', 'battery', 'resistor', 'rheostat', 'lamp', 'switch', 'ammeter', 'voltmeter'] as const;
export type PartKind = (typeof PART_KINDS)[number];

export interface Part {
  id: string;
  kind: PartKind;
  a: [number, number];
  b: [number, number];
  /** ЭДС источника, В; сопротивление резистора, лампы, реостата, Ом. */
  v: number;
  /** Внутреннее сопротивление источника, Ом. */
  r: number;
  /** Ключ замкнут. */
  closed: boolean;
  /** Номинальная мощность лампы, Вт (яркость — P/Pном). */
  pnom: number;
}

const R_AMMETER = 1e-4;
const R_IDEAL = 1e-4;
const G_LEAK = 1e-9;

export interface PartResult {
  /** Ток от a к b (у источника — внутри него, от «−» к «+»), А. */
  I: number;
  /** Напряжение Va − Vb (у источника и вольтметра — Vb − Va), В. */
  U: number;
  /** Мощность на элементе, Вт. */
  P: number;
}

export interface Solution {
  results: Map<string, PartResult>;
  /** Потенциал узла «i,j». */
  potential(key: string): number;
  /** Короткое замыкание источника (ток больше 1000 А при идеальном источнике). */
  short: string | null;
  /** Одна батарея: ток через неё и общее сопротивление внешней цепи. */
  summary: { I: number; Rext: number } | null;
}

export const nodeKey = (p: [number, number]) => `${p[0]},${p[1]}`;

/** Заряжено ли элементом поле напряжения (вольтметр, разомкнутый ключ — нет). */
const conducts = (p: Part) => p.kind !== 'voltmeter' && !(p.kind === 'switch' && !p.closed);
const merges = (p: Part) => p.kind === 'wire' || (p.kind === 'switch' && p.closed);

export function solve(parts: readonly Part[]): Solution {
  // Узлы и слияние проводами.
  const keys = new Map<string, number>();
  const idx = (k: string) => {
    if (!keys.has(k)) keys.set(k, keys.size);
    return keys.get(k)!;
  };
  for (const p of parts) {
    idx(nodeKey(p.a));
    idx(nodeKey(p.b));
  }
  const parent = Array.from({ length: keys.size }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const p of parts) if (merges(p)) parent[find(idx(nodeKey(p.a)))] = find(idx(nodeKey(p.b)));
  const roots = [...new Set([...keys.values()].map(find))];
  const n = roots.length;
  const at = new Map(roots.map((r, i) => [r, i]));
  const node = (q: [number, number]) => at.get(find(idx(nodeKey(q))))!;

  // Система G·V = J.
  const G = Array.from({ length: n }, () => new Float64Array(n));
  const J = new Float64Array(n);
  const put = (i: number, j: number, v: number) => {
    G[i]![j] = G[i]![j]! + v;
  };
  for (let i = 0; i < n; i++) put(i, i, G_LEAK);
  const stamp = (a: number, b: number, g: number) => {
    put(a, a, g);
    put(b, b, g);
    put(a, b, -g);
    put(b, a, -g);
  };
  const resistance = (p: Part) => (p.kind === 'ammeter' ? R_AMMETER : p.kind === 'battery' ? Math.max(p.r, R_IDEAL) : Math.max(p.v, 1e-3));
  for (const p of parts) {
    if (merges(p) || !conducts(p)) continue;
    const a = node(p.a);
    const b = node(p.b);
    if (a === b) continue;
    const g = 1 / resistance(p);
    stamp(a, b, g);
    if (p.kind === 'battery') {
      // Ток источника E/r втекает в узел «+» (b).
      J[b] = J[b]! + p.v * g;
      J[a] = J[a]! - p.v * g;
    }
  }
  const V = gauss(G, J);
  const results = new Map<string, PartResult>();
  let short: string | null = null;
  for (const p of parts) {
    const va = V[node(p.a)]!;
    const vb = V[node(p.b)]!;
    if (p.kind === 'battery') {
      const r = Math.max(p.r, R_IDEAL);
      const same = node(p.a) === node(p.b);
      const I = same ? p.v / r : (p.v - (vb - va)) / r;
      if (Math.abs(I) > 1000 && p.r < 1e-3) short = 'Короткое замыкание источника: ток неограниченно большой';
      results.set(p.id, { I, U: same ? 0 : vb - va, P: (same ? 0 : vb - va) * I });
    } else if (p.kind === 'voltmeter') results.set(p.id, { I: 0, U: vb - va, P: 0 });
    else if (!conducts(p) || merges(p)) results.set(p.id, { I: 0, U: va - vb, P: 0 });
    else {
      const R = resistance(p);
      const I = (va - vb) / R;
      results.set(p.id, { I, U: va - vb, P: I * I * R });
    }
  }
  const batteries = parts.filter((p) => p.kind === 'battery');
  let summary: Solution['summary'] = null;
  if (batteries.length === 1) {
    const b = batteries[0]!;
    const I = results.get(b.id)!.I;
    summary = { I, Rext: Math.abs(I) > 1e-9 ? results.get(b.id)!.U / I : Infinity };
  }
  return { results, potential: (k) => (keys.has(k) ? V[at.get(find(keys.get(k)!))!]! : 0), short, summary };
}

/** Метод Гаусса с выбором главного элемента по столбцу. */
export function gauss(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((row, i) => {
    const r = new Float64Array(n + 1);
    r.set(row);
    r[n] = b[i]!;
    return r;
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    if (Math.abs(piv) < 1e-300) continue;
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / piv;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = Math.abs(M[r]![r]!) < 1e-300 ? 0 : s / M[r]![r]!;
  }
  return x;
}
