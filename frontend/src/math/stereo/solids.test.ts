import { describe, expect, it } from 'vitest';
import { basePolygon, bodySchema, drawScene, fitScale, isConvex, labelsOf, newBody, polyhedron, polyTriangles, silhouetteAngles, viewDir, type Body, type View } from './solids';

const deg = (a: number) => (a * Math.PI) / 180;
const VIEW: View = { yaw: deg(-65), pitch: deg(22), scale: 30 };

/** Длина ломаной [x0, y0, …]. */
const len = (pts: number[]) => {
  let s = 0;
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return s;
};
const hiddenLen = (bodies: Body[], view = VIEW) => drawScene(bodies, view).lines.filter((l) => l.hidden).reduce((s, l) => s + len(l.pts), 0);
const visibleLen = (bodies: Body[], view = VIEW) => drawScene(bodies, view).lines.filter((l) => !l.hidden).reduce((s, l) => s + len(l.pts), 0);

describe('многогранники', () => {
  it('куб: 8 вершин ABCDA₁B₁C₁D₁, 6 граней, 12 рёбер', () => {
    const ph = polyhedron(newBody('cube', 'b1'));
    expect(ph.verts).toHaveLength(8);
    expect(ph.faces).toHaveLength(6);
    expect(ph.edges).toHaveLength(12);
    expect(ph.names).toEqual(['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁']);
  });

  it('пирамида: вершина S, рёбра основания и боковые', () => {
    const ph = polyhedron(newBody('pyramid', 'b1'));
    expect(ph.names.at(-1)).toBe('S');
    expect(ph.edges).toHaveLength(8);
    expect(ph.verts.at(-1)![2]).toBe(4);
  });

  it('усечённая пирамида: верхнее основание подобно нижнему с коэффициентом k', () => {
    const b = { ...newBody('frustum', 'b1'), k: 0.5 };
    const ph = polyhedron(b);
    const bot = Math.hypot(ph.verts[1]![0] - ph.verts[0]![0], ph.verts[1]![1] - ph.verts[0]![1]);
    const top = Math.hypot(ph.verts[5]![0] - ph.verts[4]![0], ph.verts[5]![1] - ph.verts[4]![1]);
    expect(top / bot).toBeCloseTo(0.5);
  });

  it('правильная треугольная призма: ребро AB — ближнее и горизонтальное', () => {
    const [A, B, C] = basePolygon(newBody('prism', 'b1'));
    expect(A![1]).toBeCloseTo(B![1]);
    expect(C![1]).toBeGreaterThan(A![1]);
  });

  it('своё основание: по часовой стрелке разворачивается, проверка выпуклости', () => {
    const b = { ...newBody('prism', 'b1'), base: [[0, 0], [0, 2], [3, 0]] as [number, number][] };
    const pts = basePolygon(b);
    expect(pts).toEqual([[3, 0], [0, 2], [0, 0]]);
    expect(isConvex([[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true);
    expect(isConvex([[0, 0], [2, 0], [1, 0.5], [2, 2], [0, 2]])).toBe(false);
    expect(isConvex([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false);
  });

  it('сетка для 3D: 12 треугольников куба, нормали наружу', () => {
    const tri = polyTriangles(newBody('cube', 'b1'));
    expect(tri.length).toBe(12 * 9);
    // Нижняя грань (z = 0): нормаль вниз.
    const t0 = tri.slice(0, 9);
    const n = (t0[3]! - t0[0]!) * (t0[7]! - t0[1]!) - (t0[4]! - t0[1]!) * (t0[6]! - t0[0]!);
    expect(n).toBeLessThan(0);
  });

  it('свои подписи заменяют подписи по умолчанию по позиции', () => {
    expect(labelsOf({ ...newBody('cube', 'b'), labels: 'K, ,M' }, ['A', 'B', 'C', 'D'])).toEqual(['K', 'B', 'M', 'D']);
  });
});

describe('видимость', () => {
  it('куб спереди-справа-сверху: невидимы ровно три ребра у вершины D', () => {
    const cube = newBody('cube', 'b1');
    const d = drawScene([cube], VIEW);
    const hidden = d.lines.filter((l) => l.hidden);
    // Соседние куски одного вида склеиваются в ломаную: считаем звенья.
    const links = (ls: typeof hidden) => ls.reduce((s, l) => s + l.pts.length / 2 - 1, 0);
    expect(links(hidden)).toBe(3);
    expect(d.labels.filter((l) => l.hidden).map((l) => l.text)).toEqual(['D']);
    // Каждая невидимая ломаная проходит через проекцию D.
    const D = d.labels.find((l) => l.text === 'D')!;
    for (const l of hidden) {
      const pts = Array.from({ length: l.pts.length / 2 }, (_, i) => [l.pts[2 * i]!, l.pts[2 * i + 1]!]);
      expect(Math.min(...pts.map(([x, y]) => Math.hypot(x! - D.x, y! - D.y)))).toBeLessThan(13);
    }
    expect(d.lines.filter((l) => !l.hidden).reduce((s, l) => s + l.pts.length / 2 - 1, 0)).toBe(9);
  });

  it('куб сверху справа-сзади: закрыта только нижняя вершина A', () => {
    const top = drawScene([newBody('cube', 'b1')], { yaw: deg(20), pitch: deg(80), scale: 30 });
    expect(top.labels.filter((l) => l.hidden).map((l) => l.text)).toEqual(['A']);
  });

  it('режимы невидимых линий: пунктир, скрыть, сплошные', () => {
    const cube = [newBody('cube', 'b1')];
    expect(drawScene(cube, VIEW, 'hide').lines.some((l) => l.hidden)).toBe(false);
    expect(drawScene(cube, VIEW, 'solid').lines.some((l) => l.hidden)).toBe(false);
    expect(len(drawScene(cube, VIEW, 'solid').lines.flatMap((l) => l.pts))).toBeGreaterThan(0);
    expect(drawScene(cube, VIEW, 'hide').lines.reduce((s, l) => s + len(l.pts), 0)).toBeLessThan(drawScene(cube, VIEW, 'solid').lines.reduce((s, l) => s + len(l.pts), 0));
  });

  it('цилиндр: две образующие-очертания; задняя половина нижнего основания — пунктир', () => {
    const cyl = newBody('cylinder', 'b1');
    expect(silhouetteAngles(cyl, viewDir(VIEW.yaw, VIEW.pitch))).toHaveLength(2);
    const d = drawScene([{ ...cyl, axis: false }], VIEW);
    const h = d.lines.filter((l) => l.hidden).reduce((s, l) => s + len(l.pts), 0);
    // Половина окружности нижнего основания в проекции (эллипс с полуосями r·s и r·s·sin pitch).
    const r = 2 * 30;
    const b = r * Math.sin(VIEW.pitch);
    const halfEllipse = (Math.PI * (3 * (r + b) - Math.sqrt((3 * r + b) * (r + 3 * b)))) / 2;
    expect(h).toBeGreaterThan(halfEllipse * 0.9);
    expect(h).toBeLessThan(halfEllipse * 1.1);
  });

  it('конус: вершина S; очертаний нет, если смотреть почти по оси сверху', () => {
    const cone = newBody('cone', 'b1');
    expect(silhouetteAngles(cone, viewDir(0, deg(80)))).toHaveLength(0);
    expect(silhouetteAngles(cone, viewDir(0, deg(20)))).toHaveLength(2);
    expect(drawScene([cone], VIEW).labels.map((l) => l.text)).toEqual(['S', 'O']);
  });

  it('ось цилиндра внутри тела — пунктир', () => {
    const d = drawScene([newBody('cylinder', 'b1')], VIEW);
    const axisHidden = d.lines.filter((l) => l.hidden && l.pts.length === 4);
    expect(axisHidden.length).toBeGreaterThanOrEqual(1);
  });

  it('шар: очертание видно целиком, у экватора задняя половина — пунктир', () => {
    const d = drawScene([{ ...newBody('sphere', 'b1'), axis: false }], VIEW);
    const r = 2.5 * 30;
    const vis = d.lines.filter((l) => !l.hidden).reduce((s, l) => s + len(l.pts), 0);
    const hid = d.lines.filter((l) => l.hidden).reduce((s, l) => s + len(l.pts), 0);
    expect(vis).toBeGreaterThan(2 * Math.PI * r * 0.98);
    expect(hid).toBeGreaterThan(0);
    expect(d.fills).toHaveLength(1);
  });

  it('тело за другим телом: его рёбра закрыты', () => {
    const front = { ...newBody('cube', 'b1'), a: 6 };
    // Маленький куб прямо за большим относительно зрителя.
    const d = viewDir(VIEW.yaw, VIEW.pitch);
    const back = { ...newBody('cube', 'b2'), a: 1, pos: [-d[0] * 8, -d[1] * 8, 2.5] as [number, number, number] };
    const alone = hiddenLen([back]);
    const together = hiddenLen([front, back]) - hiddenLen([front]);
    expect(together).toBeGreaterThan(alone * 3);
  });

  it('заливка: видимые грани куба — три', () => {
    expect(drawScene([newBody('cube', 'b1')], VIEW).fills).toHaveLength(3);
    expect(drawScene([{ ...newBody('cube', 'b1'), opacity: 0 }], VIEW).fills).toHaveLength(0);
  });
});

describe('масштаб и схема', () => {
  it('fitScale вписывает чертёж в рамку', () => {
    const bodies = [newBody('pyramid', 'b1')];
    const s = fitScale(bodies, VIEW, 400, 300);
    const d = drawScene(bodies, { ...VIEW, scale: s });
    expect(d.bounds.width).toBeLessThanOrEqual(400 - 2 * 36 + 1e-6);
    expect(d.bounds.height).toBeLessThanOrEqual(300 - 2 * 36 + 1e-6);
    expect(Math.max(d.bounds.width / (400 - 72), d.bounds.height / (300 - 72))).toBeGreaterThan(0.75);
  });

  it('тела по умолчанию проходят схему', () => {
    for (const k of ['cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'tcone', 'sphere'] as const) expect(bodySchema.safeParse(newBody(k, 'b1')).success).toBe(true);
  });
});
