/**
 * Дискретная математика (этап 6.5e): графы и алгоритмы на них,
 * комбинаторика, логика высказываний, системы счисления. Чистые функции.
 */

// =====================================================================
//  Графы
// =====================================================================

export interface Edge {
  a: number;
  b: number;
  w: number;
}

const LABEL = '[A-Za-zА-Яа-яЁё]\\d*';

/**
 * Рёбра текстом: «AB, BC 3; C-D:2, D E = 4». Вес — необязательное число
 * после пары (по умолчанию 1). names — имена вершин по номерам.
 */
export function parseEdges(src: string, names: string[]): Edge[] | { error: string } {
  const out: Edge[] = [];
  const index = (n: string) => names.findIndex((v) => v.toLowerCase() === n.toLowerCase());
  // Запятая перед цифрой — десятичная («1,5»), иначе — разделитель.
  const items = src.split(/[;\n]+|,(?!\d)/).map((s) => s.trim()).filter(Boolean);
  const re = new RegExp(`^(${LABEL})\\s*[-–—]?\\s*(${LABEL})\\s*(?:[:=]?\\s*(\\d+(?:[.,]\\d+)?))?$`);
  for (const it of items) {
    const m = re.exec(it.replace(/\s*[-–—]>\s*/, '-'));
    if (!m) return { error: `не понял «${it}»: пишите, например, AB 3 или A-B` };
    const a = index(m[1]!);
    const b = index(m[2]!);
    if (a < 0) return { error: `нет вершины ${m[1]}` };
    if (b < 0) return { error: `нет вершины ${m[2]}` };
    if (a === b) return { error: `петля ${m[1]}${m[2]} не поддерживается` };
    out.push({ a, b, w: m[3] ? Number(m[3].replace(',', '.')) : 1 });
  }
  return out;
}

/** Списки смежности; для неориентированного графа ребро — в обе стороны. Соседи — по возрастанию номера. */
export function adjacency(n: number, edges: Edge[], directed: boolean): { to: number; w: number; e: number }[][] {
  const adj: { to: number; w: number; e: number }[][] = Array.from({ length: n }, () => []);
  edges.forEach((ed, e) => {
    adj[ed.a]!.push({ to: ed.b, w: ed.w, e });
    if (!directed) adj[ed.b]!.push({ to: ed.a, w: ed.w, e });
  });
  for (const l of adj) l.sort((x, y) => x.to - y.to || x.e - y.e);
  return adj;
}

/** Степени вершин (для ориентированного — полустепени исхода + захода). */
export function degrees(n: number, edges: Edge[]): number[] {
  const d = Array.from({ length: n }, () => 0);
  for (const e of edges) {
    d[e.a]!++;
    d[e.b]!++;
  }
  return d;
}

/** Число компонент связности (рёбра без учёта направления). */
export function components(n: number, edges: Edge[]): number {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (p[x] === x ? x : (p[x] = find(p[x]!)));
  for (const e of edges) p[find(e.a)] = find(e.b);
  return new Set(p.map((_, i) => find(i))).size;
}

/** Шаг анимации обхода: посещённая вершина и ребро, по которому пришли (−1 — старт). */
export interface Visit {
  v: number;
  via: number;
}

export function bfs(n: number, edges: Edge[], directed: boolean, start: number): Visit[] {
  const adj = adjacency(n, edges, directed);
  const seen = new Set([start]);
  const out: Visit[] = [{ v: start, via: -1 }];
  const q = [start];
  while (q.length) {
    const u = q.shift()!;
    for (const { to, e } of adj[u]!)
      if (!seen.has(to)) {
        seen.add(to);
        out.push({ v: to, via: e });
        q.push(to);
      }
  }
  return out;
}

export function dfs(n: number, edges: Edge[], directed: boolean, start: number): Visit[] {
  const adj = adjacency(n, edges, directed);
  const seen = new Set<number>();
  const out: Visit[] = [];
  const go = (u: number, via: number) => {
    seen.add(u);
    out.push({ v: u, via });
    for (const { to, e } of adj[u]!) if (!seen.has(to)) go(to, e);
  };
  go(start, -1);
  return out;
}

/** Дейкстра: расстояния, предшествующее ребро и порядок окончательной пометки вершин. */
export function dijkstra(n: number, edges: Edge[], directed: boolean, start: number): { dist: number[]; prevEdge: number[]; order: Visit[] } {
  const adj = adjacency(n, edges, directed);
  const dist = Array.from({ length: n }, () => Infinity);
  const prevEdge = Array.from({ length: n }, () => -1);
  const done = new Set<number>();
  const order: Visit[] = [];
  dist[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done.has(i) && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done.add(u);
    order.push({ v: u, via: prevEdge[u]! });
    for (const { to, w, e } of adj[u]!)
      if (dist[u]! + w < dist[to]!) {
        dist[to] = dist[u]! + w;
        prevEdge[to] = e;
      }
  }
  return { dist, prevEdge, order };
}

/** Путь (номера рёбер) от старта к цели по предшествующим рёбрам. */
export function pathEdges(edges: Edge[], prevEdge: number[], target: number, directed: boolean): number[] {
  const out: number[] = [];
  let v = target;
  for (let guard = 0; prevEdge[v]! >= 0 && guard < edges.length + 1; guard++) {
    const e = prevEdge[v]!;
    out.unshift(e);
    const ed = edges[e]!;
    v = directed || ed.b === v ? ed.a : ed.b;
  }
  return out;
}

/** Минимальное остовное дерево (Краскал): рёбра в порядке добавления. */
export function kruskal(n: number, edges: Edge[]): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (p[x] === x ? x : (p[x] = find(p[x]!)));
  const order = edges.map((_, i) => i).sort((x, y) => edges[x]!.w - edges[y]!.w || x - y);
  const out: number[] = [];
  for (const i of order) {
    const a = find(edges[i]!.a);
    const b = find(edges[i]!.b);
    if (a !== b) {
      p[a] = b;
      out.push(i);
    }
  }
  return out;
}

/**
 * Эйлеров путь или цикл в неориентированном графе (Хирхольцер): рёбра по
 * порядку прохода; null — нет (нечётных вершин больше двух или граф с рёбрами несвязен).
 */
export function euler(n: number, edges: Edge[]): { edges: number[]; start: number; cycle: boolean } | { reason: string } {
  if (!edges.length) return { reason: 'нет рёбер' };
  const deg = degrees(n, edges);
  const odd = deg.map((d, i) => (d % 2 ? i : -1)).filter((i) => i >= 0);
  if (odd.length > 2) return { reason: `нечётных вершин ${odd.length} (больше двух) — эйлерова пути нет` };
  const used = new Set<number>();
  const withEdges = deg.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);
  if (components(n, edges) - (n - withEdges.length) > 1) return { reason: 'рёбра не связны — эйлерова пути нет' };
  const adj = adjacency(n, edges, false);
  const start = odd.length ? odd[0]! : withEdges[0]!;
  const stack: { v: number; e: number }[] = [{ v: start, e: -1 }];
  const path: number[] = [];
  const ptr = Array.from({ length: n }, () => 0);
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const list = adj[top.v]!;
    while (ptr[top.v]! < list.length && used.has(list[ptr[top.v]!]!.e)) ptr[top.v]!++;
    if (ptr[top.v]! === list.length) {
      stack.pop();
      if (top.e >= 0) path.push(top.e);
    } else {
      const nx = list[ptr[top.v]!]!;
      used.add(nx.e);
      stack.push({ v: nx.to, e: nx.e });
    }
  }
  return { edges: path.reverse(), start, cycle: odd.length === 0 };
}

// =====================================================================
//  Комбинаторика
// =====================================================================

export const factorial = (n: number) => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

/** Число размещений Aₙᵏ = n!/(n − k)!. */
export const arrangements = (n: number, k: number) => {
  if (k > n || k < 0) return 0;
  let r = 1;
  for (let i = n - k + 1; i <= n; i++) r *= i;
  return r;
};

export const combinations = (n: number, k: number) => (k > n || k < 0 ? 0 : arrangements(n, k) / factorial(k));

/** Перечисление вариантов (не больше limit): упорядоченные — размещения, иначе сочетания. */
export function enumerate(items: string[], k: number, ordered: boolean, limit: number): string[][] {
  const out: string[][] = [];
  const cur: string[] = [];
  const used = new Set<number>();
  const go = (from: number) => {
    if (out.length >= limit) return;
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = ordered ? 0 : from; i < items.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      cur.push(items[i]!);
      go(i + 1);
      cur.pop();
      used.delete(i);
    }
  };
  go(0);
  return out;
}

/** Строки треугольника Паскаля 0…n. */
export const pascal = (n: number) => Array.from({ length: n + 1 }, (_, r) => Array.from({ length: r + 1 }, (_, k) => combinations(r, k)));

// =====================================================================
//  Логика высказываний
// =====================================================================

type LNode = { t: 'var'; name: string } | { t: 'const'; v: boolean } | { t: 'not'; a: LNode } | { t: 'bin'; op: 'and' | 'or' | 'imp' | 'eq' | 'xor'; a: LNode; b: LNode };

/** Школьные обозначения → лексемы. */
function tokens(src: string): string[] | { error: string } {
  const s = src
    .replace(/<->|<=>|⇔|≡/g, ' ↔ ')
    .replace(/->|=>|⇒/g, ' → ')
    // Слова — только отдельно стоящие (\b в JavaScript не работает с кириллицей).
    .replace(/(^|[\s()])(and|и)(?=[\s()]|$)/gi, '$1 ∧ ')
    .replace(/(^|[\s()])(or|или)(?=[\s()]|$)/gi, '$1 ∨ ')
    .replace(/(^|[\s()])(not|не)(?=[\s()]|$)/gi, '$1 ¬ ')
    .replace(/(^|[\s()])xor(?=[\s()]|$)/gi, '$1 ⊕ ')
    .replace(/&&?|·|\*/g, ' ∧ ')
    .replace(/\|\|?|\+/g, ' ∨ ')
    .replace(/!|~/g, ' ¬ ')
    .replace(/⊕/g, ' ⊕ ');
  const out: string[] = [];
  const re = /\s*([A-Za-z]\w*|[01]|[∧∨¬→↔⊕()])/y;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i]!)) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return { error: `непонятный знак «${s[i]}»` };
    out.push(m[1]!);
    i = re.lastIndex;
  }
  return out;
}

/** Разбор формулы. Приоритет: ¬, ∧, ∨ и ⊕, →, ↔ (→ — правоассоциативна). */
export function parseLogic(src: string): { node: LNode; vars: string[] } | { error: string } {
  const tk = tokens(src);
  if ('error' in tk) return tk;
  if (!tk.length) return { error: 'пустая формула' };
  let pos = 0;
  const vars = new Set<string>();
  const peek = () => tk[pos];
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const primary = (): LNode => {
    const t = tk[pos++];
    if (t === undefined) return fail('формула оборвалась');
    if (t === '¬') return { t: 'not', a: primary() };
    if (t === '(') {
      const n = eq();
      if (tk[pos++] !== ')') fail('не закрыта скобка');
      return n;
    }
    if (t === '0' || t === '1') return { t: 'const', v: t === '1' };
    if (/^[A-Za-z]\w*$/.test(t)) {
      const name = t.toUpperCase();
      vars.add(name);
      return { t: 'var', name };
    }
    return fail(`лишний знак «${t}»`);
  };
  const and = (): LNode => {
    let a = primary();
    while (peek() === '∧') {
      pos++;
      a = { t: 'bin', op: 'and', a, b: primary() };
    }
    return a;
  };
  const or = (): LNode => {
    let a = and();
    while (peek() === '∨' || peek() === '⊕') {
      const op = tk[pos++] === '∨' ? 'or' : 'xor';
      a = { t: 'bin', op, a, b: and() };
    }
    return a;
  };
  const imp = (): LNode => {
    const a = or();
    if (peek() === '→') {
      pos++;
      return { t: 'bin', op: 'imp', a, b: imp() };
    }
    return a;
  };
  const eq = (): LNode => {
    let a = imp();
    while (peek() === '↔') {
      pos++;
      a = { t: 'bin', op: 'eq', a, b: imp() };
    }
    return a;
  };
  try {
    const node = eq();
    if (pos < tk.length) fail(`лишнее «${tk[pos]}»`);
    const list = [...vars].sort();
    if (list.length > 5) return { error: 'не больше 5 переменных' };
    return { node, vars: list };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function evalLogic(n: LNode, env: Record<string, boolean>): boolean {
  switch (n.t) {
    case 'var':
      return env[n.name] ?? false;
    case 'const':
      return n.v;
    case 'not':
      return !evalLogic(n.a, env);
    case 'bin': {
      const a = evalLogic(n.a, env);
      const b = evalLogic(n.b, env);
      return n.op === 'and' ? a && b : n.op === 'or' ? a || b : n.op === 'imp' ? !a || b : n.op === 'eq' ? a === b : a !== b;
    }
  }
}

export interface TruthTable {
  vars: string[];
  rows: { values: boolean[]; result: boolean }[];
  /** Совершенные нормальные формы; «0» / «1» — для тождественно ложной / истинной. */
  sdnf: string;
  sknf: string;
  kind: 'тождественно истинна' | 'тождественно ложна' | 'выполнима';
}

export function truthTable(src: string): TruthTable | { error: string } {
  const p = parseLogic(src);
  if ('error' in p) return p;
  const rows = Array.from({ length: 2 ** p.vars.length }, (_, r) => {
    const values = p.vars.map((_, i) => ((r >> (p.vars.length - 1 - i)) & 1) === 1);
    return { values, result: evalLogic(p.node, Object.fromEntries(p.vars.map((v, i) => [v, values[i]!]))) };
  });
  const lit = (v: string, val: boolean, pos: boolean) => (val === pos ? v : `¬${v}`);
  const trues = rows.filter((r) => r.result);
  const falses = rows.filter((r) => !r.result);
  const sdnf = !trues.length ? '0' : trues.map((r) => (p.vars.length > 1 ? `(${p.vars.map((v, i) => lit(v, r.values[i]!, true)).join(' ∧ ')})` : lit(p.vars[0] ?? '1', r.values[0] ?? true, true))).join(' ∨ ');
  const sknf = !falses.length ? '1' : falses.map((r) => (p.vars.length > 1 ? `(${p.vars.map((v, i) => lit(v, r.values[i]!, false)).join(' ∨ ')})` : lit(p.vars[0] ?? '0', r.values[0] ?? false, false))).join(' ∧ ');
  return { vars: p.vars, rows, sdnf: p.vars.length ? sdnf : String(Number(rows[0]!.result)), sknf: p.vars.length ? sknf : String(Number(rows[0]!.result)), kind: !falses.length ? 'тождественно истинна' : !trues.length ? 'тождественно ложна' : 'выполнима' };
}

// =====================================================================
//  Системы счисления
// =====================================================================

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Цифры числа в системе base → десятичное значение (целая и дробная часть). */
export function parseBase(src: string, base: number): { value: number; digits: string } | { error: string } {
  const s = src.trim().toUpperCase().replace(',', '.');
  if (!/^[0-9A-Z]+(\.[0-9A-Z]+)?$/.test(s)) return { error: 'пишите цифры без знака, дробную часть — через запятую' };
  let value = 0;
  const [int, frac = ''] = s.split('.');
  for (const ch of int!) {
    const d = DIGITS.indexOf(ch);
    if (d >= base) return { error: `цифры «${ch}» нет в системе с основанием ${base}` };
    value = value * base + d;
  }
  let k = base;
  for (const ch of frac) {
    const d = DIGITS.indexOf(ch);
    if (d >= base) return { error: `цифры «${ch}» нет в системе с основанием ${base}` };
    value += d / k;
    k *= base;
  }
  return { value, digits: s };
}

/** Развёрнутая запись: 1011₂ = 1·2³ + 0·2² + 1·2¹ + 1·2⁰. */
export function expanded(digits: string, base: number): string {
  const [int, frac = ''] = digits.split('.');
  const sup = (n: number) => String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)] ?? '⁻').join('');
  const terms = [...int!].map((ch, i) => `${DIGITS.indexOf(ch)}·${base}${sup(int!.length - 1 - i)}`);
  [...frac].forEach((ch, i) => terms.push(`${DIGITS.indexOf(ch)}·${base}⁻${sup(i + 1)}`));
  return terms.join(' + ');
}

/** Перевод целой части делением «столбиком»: строки (делимое, частное, остаток) и результат. */
export function divideSteps(n: number, base: number): { steps: { q: number; d: number; r: number }[]; digits: string } {
  const steps: { q: number; d: number; r: number }[] = [];
  let x = Math.floor(n);
  if (x === 0) return { steps: [{ q: 0, d: 0, r: 0 }], digits: '0' };
  while (x > 0) {
    steps.push({ q: x, d: Math.floor(x / base), r: x % base });
    x = Math.floor(x / base);
  }
  return { steps, digits: steps.map((s) => DIGITS[s.r]).reverse().join('') };
}

/** Дробная часть — умножением на основание (до places цифр). */
export function fracSteps(f: number, base: number, places = 6): { steps: { x: number; digit: number }[]; digits: string } {
  const steps: { x: number; digit: number }[] = [];
  let x = f;
  for (let i = 0; i < places && x > 1e-12; i++) {
    const y = x * base;
    const d = Math.floor(y + 1e-12);
    steps.push({ x, digit: d });
    x = y - d;
  }
  return { steps, digits: steps.map((s) => DIGITS[s.digit]).join('') };
}
