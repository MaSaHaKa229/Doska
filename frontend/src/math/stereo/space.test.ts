import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeCapabilities, DEFAULT_BOARD_SETTINGS } from '@doska/shared';
import { BoardModel } from '../../collab/model';
import { registry } from '../../plugins/registry';
import { drawScene, newBody, projection, sceneCenter, type Body, type V3, type View } from './solids';
import {
  angle,
  distance,
  elemOf,
  faceFrame,
  faceUV,
  measureOf,
  nextPointName,
  pickAt,
  pointPositions,
  refPosition,
  removeBody,
  removeWithDependents,
  sectionOf,
  sectionPolygon,
  spaceLayer,
  surd,
  type Item,
  type PointRef,
  type Space,
  type SpacePoint,
} from './space';
import { SCENE_TYPE, sceneWith, type SceneProps } from './objects';

const deg = (a: number) => (a * Math.PI) / 180;
const VIEW: View = { yaw: deg(-65), pitch: deg(22), scale: 30 };
const close = (a: V3 | null, b: V3) => {
  expect(a).not.toBeNull();
  a!.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
};

/** Единичный куб ABCDA₁B₁C₁D₁: A(−½; −½; 0) … C₁(½; ½; 1). */
const cube: Body = { ...newBody('cube', 'c'), a: 1 };
const V = (i: number): PointRef => ({ k: 'vertex', body: 'c', i });
const A = 0,
  B = 1,
  C = 2,
  D = 3,
  A1 = 4,
  B1 = 5,
  C1 = 6,
  D1 = 7;
const pt = (id: string, at: PointRef, name = id): SpacePoint => ({ id, name, at, color: 'accent-1' });
const space = (points: SpacePoint[], items: Item[] = [], bodies: Body[] = [cube]): Space => ({ bodies, points, items });

describe('точки построений', () => {
  it('вершина, точка ребра по отношению, точка грани, по координатам', () => {
    close(refPosition(V(C1), [cube]), [0.5, 0.5, 1]);
    close(refPosition({ k: 'edge', body: 'c', i: A, j: B, t: 0.25 }, [cube]), [-0.25, -0.5, 0]);
    close(refPosition({ k: 'coord', p: [1, 2, 3] }, [cube]), [1, 2, 3]);
    expect(refPosition(V(0), [])).toBeNull();
  });

  it('аффинные координаты грани: точка возвращается в то же место и едет вместе с телом', () => {
    const fr = faceFrame(cube, 1)!; // верхняя грань
    const p: V3 = [0.1, 0.2, 1];
    const { u, v } = faceUV(fr, p);
    close(refPosition({ k: 'face', body: 'c', f: 1, u, v }, [cube]), p);
    // Куб вдвое больше — точка остаётся «в той же доле» грани.
    const big = { ...cube, a: 2 };
    close(refPosition({ k: 'face', body: 'c', f: 1, u, v }, [big]), [0.2, 0.4, 2]);
  });

  it('центры тел вращения и вершина конуса', () => {
    const cone = { ...newBody('cone', 'k'), r: 1, h: 3 };
    close(refPosition({ k: 'vertex', body: 'k', i: 0 }, [cone]), [0, 0, 3]);
    close(refPosition({ k: 'vertex', body: 'k', i: 1 }, [cone]), [0, 0, 0]);
  });

  it('имя новой точки не совпадает с вершинами и точками', () => {
    expect(nextPointName(space([]))).toBe('K');
    expect(nextPointName(space([pt('p1', V(0), 'K'), pt('p2', V(1), 'L')]))).toBe('M');
  });
});

describe('сечения', () => {
  it('куб плоскостью через середины трёх рёбер — правильный шестиугольник', () => {
    const s = space(
      [pt('p1', { k: 'edge', body: 'c', i: A, j: B, t: 0.5 }), pt('p2', { k: 'edge', body: 'c', i: B, j: C, t: 0.5 }), pt('p3', { k: 'edge', body: 'c', i: C, j: C1, t: 0.5 })],
      [{ id: 'i1', k: 'section', body: 'c', a: 'p1', b: 'p2', c: 'p3', color: 'accent-1', opacity: 0.3 }],
    );
    const poly = sectionOf(s, s.items[0] as Extract<Item, { k: 'section' }>)!;
    expect(poly).toHaveLength(6);
    const sides = poly.map((p, i) => Math.hypot(...p.map((v, k) => v - poly[(i + 1) % 6]![k]!)));
    for (const l of sides) expect(l).toBeCloseTo(Math.SQRT2 / 2, 9);
  });

  it('горизонтальная плоскость через середины боковых рёбер — квадрат; мимо тела — нет сечения', () => {
    expect(sectionPolygon(cube, { p: [0, 0, 0.5], n: [0, 0, 1] })).toHaveLength(4);
    expect(sectionPolygon(cube, { p: [0, 0, 5], n: [0, 0, 1] })).toBeNull();
  });

  it('шар плоскостью через центр — большой круг, цилиндр — круг основания', () => {
    const sph = { ...newBody('sphere', 's'), r: 2, pos: [0, 0, 0] as V3 };
    const circle = sectionPolygon(sph, { p: [0, 0, 0], n: [1, 0, 0] })!;
    for (const p of circle) expect(Math.hypot(...p)).toBeCloseTo(2, 9);
    const cyl = { ...newBody('cylinder', 'y'), r: 1, h: 2 };
    const ring = sectionPolygon(cyl, { p: [0, 0, 1], n: [0, 0, 1] })!;
    expect(ring.length).toBeGreaterThanOrEqual(72);
    for (const p of ring) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
  });

  it('вершина на плоскости сечения не дублируется', () => {
    // Плоскость A B₁ D₁ — треугольное сечение.
    const s = space([pt('a', V(A)), pt('b', V(B1)), pt('d', V(D1))], [{ id: 'i1', k: 'section', body: 'c', a: 'a', b: 'b', c: 'd', color: 'accent-1', opacity: 0.3 }]);
    expect(sectionOf(s, s.items[0] as Extract<Item, { k: 'section' }>)).toHaveLength(3);
  });
});

describe('расстояния и углы в единичном кубе', () => {
  const s = space(
    [A, B, C, D, A1, B1, C1, D1].map((i) => pt(`v${i}`, V(i), ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'][i])),
    [
      { id: 'AB1', k: 'segment', a: 'v0', b: 'v5', color: 'ink' },
      { id: 'BC1', k: 'segment', a: 'v1', b: 'v6', color: 'ink' },
      { id: 'B1D', k: 'line', a: 'v5', b: 'v3', color: 'ink' },
      { id: 'ABC', k: 'plane', a: 'v0', b: 'v1', c: 'v2', color: 'ink', opacity: 0.2 },
      { id: 'ABC1', k: 'section', body: 'c', a: 'v0', b: 'v1', c: 'v6', color: 'ink', opacity: 0.2 },
      { id: 'AB1D1', k: 'section', body: 'c', a: 'v0', b: 'v5', c: 'v7', color: 'ink', opacity: 0.2 },
      { id: 'A1B1C1', k: 'plane', a: 'v4', b: 'v5', c: 'v6', color: 'ink', opacity: 0.2 },
    ],
  );
  const e = (id: string) => elemOf(s, id)!;

  it('скрещивающиеся диагонали граней AB₁ и BC₁: расстояние √3/3, угол 60°', () => {
    const d = distance(e('AB1'), e('BC1'))!;
    expect(d.value).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(d.text).toBe('ρ(AB₁, BC₁) = √3/3 ≈ 0,58');
    expect(angle(e('AB1'), e('BC1'))!.text).toBe('∠(AB₁, BC₁) = 60°');
  });

  it('точка до плоскости: ρ(A₁, (AB₁D₁)) = √3/3; до прямой: ρ(C, AB₁) = √6/2', () => {
    expect(distance(e('v4'), e('AB1D1'))!.value).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(distance(e('v2'), e('AB1'))!.text).toBe('ρ(C, AB₁) = √6/2 ≈ 1,22');
    expect(distance(e('v0'), e('v6'))!.text).toBe('ρ(A, C₁) = √3 ≈ 1,73');
  });

  it('угол диагонали с основанием ≈ 35,3°, двугранный угол ABC₁ и ABC — 45°', () => {
    expect(angle(e('B1D'), e('ABC'))!.text).toBe('∠(B₁D, (ABC)) ≈ 35,3°');
    expect(angle(e('ABC1'), e('ABC'))!.text).toBe('∠((ABC₁), (ABC)) = 45°');
  });

  it('параллельные плоскости — расстояние 1; угол с точкой не определён', () => {
    expect(distance(e('ABC'), e('A1B1C1'))!.text).toBe('ρ((ABC), (A₁B₁C₁)) = 1');
    expect(angle(e('v0'), e('ABC'))).toBeNull();
  });

  it('измерения через построения сцены', () => {
    const m = measureOf({ ...s, items: [...s.items, { id: 'm', k: 'dist', x: 'AB1', y: 'BC1', color: 'accent-1' }] }, { id: 'm', k: 'dist', x: 'AB1', y: 'BC1', color: 'accent-1' })!;
    expect(m.value).toBeCloseTo(0.57735, 5);
  });

  it('«школьная» запись длин', () => {
    expect(surd(2 * Math.SQRT2)).toBe('2√2 ≈ 2,83');
    expect(surd(3)).toBe('3');
    expect(surd(Math.sqrt(3) / 2)).toBe('√3/2 ≈ 0,87');
    expect(surd(Math.PI)).toBe('≈ 3,14');
  });
});

describe('правка', () => {
  it('удаление точки удаляет построения на ней и измерения этих построений', () => {
    const s = space(
      [pt('p1', V(0)), pt('p2', V(1)), pt('p3', V(2))],
      [
        { id: 'i1', k: 'segment', a: 'p1', b: 'p2', color: 'ink' },
        { id: 'i2', k: 'segment', a: 'p2', b: 'p3', color: 'ink' },
        { id: 'i3', k: 'angle', x: 'i1', y: 'i2', color: 'ink' },
      ],
    );
    const r = removeWithDependents(s, ['p1']);
    expect(r.points.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(r.items.map((i) => i.id)).toEqual(['i2']);
  });

  it('удаление тела уносит его точки, сечения и всё, что на них', () => {
    const s = space([pt('p1', V(0)), pt('p2', { k: 'coord', p: [5, 5, 5] }), pt('p3', V(2))], [{ id: 'i1', k: 'section', body: 'c', a: 'p1', b: 'p2', c: 'p3', color: 'ink', opacity: 0.2 }]);
    const r = removeBody(s, 'c');
    expect(r.bodies).toHaveLength(0);
    expect(r.points.map((p) => p.id)).toEqual(['p2']);
    expect(r.items).toHaveLength(0);
  });
});

describe('слой чертежа и выбор щелчком', () => {
  // Единичный куб крупно: 120 px на единицу.
  const BIG: View = { ...VIEW, scale: 120 };
  const s = space(
    [pt('p1', { k: 'edge', body: 'c', i: A, j: B, t: 0.5 }, 'K'), pt('p2', { k: 'edge', body: 'c', i: B, j: C, t: 0.5 }, 'L'), pt('p3', { k: 'edge', body: 'c', i: C, j: C1, t: 0.5 }, 'M')],
    [
      { id: 'i1', k: 'section', body: 'c', a: 'p1', b: 'p2', c: 'p3', color: 'accent-1', opacity: 0.3 },
      { id: 'i2', k: 'dist', x: 'p1', y: 'p3', color: 'accent-2' },
    ],
  );

  it('сечение — заливка и контур, точки с подписями, значение расстояния', () => {
    const layer = spaceLayer(s);
    expect(layer.fills).toHaveLength(1);
    expect(layer.points.map((p) => p.name)).toEqual(['K', 'L', 'M']);
    expect(layer.values[0]!.text).toMatch(/^ρ\(K, M\)/);
    const d = drawScene([cube], VIEW, 'dashed', 12, layer);
    expect(d.labels.filter((l) => l.value)).toHaveLength(1);
    expect(d.lines.some((l) => l.accent)).toBe(true);
    // Часть контура сечения на задних гранях — пунктиром.
    expect(d.lines.filter((l) => l.color === 'accent-1' && l.hidden).length).toBeGreaterThan(0);
    expect(d.lines.filter((l) => l.color === 'accent-1' && !l.hidden).length).toBeGreaterThan(0);
  });

  it('щелчок: по точке построения, по вершине, по ребру (доля до сотых), по видимой грани', () => {
    const proj = projection(BIG, sceneCenter([cube]));
    const at = (p: V3) => proj.project(p);
    const pos = pointPositions(s);
    const k = at(pos.get('p1')!);
    expect(pickAt(s, BIG, k.x + 2, k.y, { items: false })).toEqual({ kind: 'point', id: 'p1' });
    const c1 = at([0.5, 0.5, 1]);
    expect(pickAt(s, BIG, c1.x, c1.y, { items: false })).toMatchObject({ kind: 'ref', ref: { k: 'vertex', body: 'c', i: C1 } });
    // Ребро AA₁ на трети высоты.
    const e = at([-0.5, -0.5, 1 / 3]);
    const pe = pickAt(space([]), BIG, e.x + 1, e.y, { items: false });
    expect(pe).toMatchObject({ kind: 'ref', ref: { k: 'edge', body: 'c', i: A, j: A1, t: 0.33 } });
    // Центр верхней грани.
    const f = at([0.1, -0.1, 1]);
    const pf = pickAt(space([]), BIG, f.x, f.y, { items: false });
    expect(pf?.kind).toBe('ref');
    const p = (pf as { p: V3 }).p;
    close(p, [0.1, -0.1, 1]);
    close(refPosition((pf as { ref: PointRef }).ref, [cube]), [0.1, -0.1, 1]);
  });

  it('щелчок по сечению выбирает его, когда нужны построения', () => {
    const proj = projection(BIG, sceneCenter([cube]));
    const poly = sectionOf(s, s.items[0] as Extract<Item, { k: 'section' }>)!;
    const c = proj.project(poly.reduce((acc, q) => [acc[0] + q[0] / poly.length, acc[1] + q[1] / poly.length, acc[2] + q[2] / poly.length] as V3, [0, 0, 0] as V3));
    expect(pickAt(s, BIG, c.x, c.y, { items: true })).toEqual({ kind: 'item', id: 'i1' });
  });
});

describe('схема версии 2', () => {
  const T = '11111111-1111-4111-8111-111111111111';
  const caps = () =>
    computeCapabilities({
      user: { id: T, role: 'TEACHER' },
      board: { kind: 'LESSON', mode: 'COLLABORATIVE', ownerId: T, settings: DEFAULT_BOARD_SETTINGS, sharedWithTeachers: false },
      memberRole: null,
      studentViaClass: false,
      teachesOwner: false,
      hasChalk: false,
    });

  it('сцена версии 1 читается с пустыми построениями, при правке записывается версия 2', () => {
    const model = new BoardModel(new Y.Doc(), { userId: T, registry, getCaps: caps, ownerId: T });
    model.addPage('Страница 1');
    const pageId = model.pages()[0]!.id;
    const { points: _p, items: _i, ...v1 } = sceneWith('cube');
    const id = model.createObject(SCENE_TYPE, { pageId, x: 0, y: 0, props: v1 })!;
    const ymap = model.doc.getMap('objects').get(id) as Y.Map<unknown>;
    model.doc.transact(() => ymap.set('v', 1));
    const o = model.getObject(id)!;
    expect(model.get(id)!.broken).toBe(false);
    expect((o.props as SceneProps).points).toEqual([]);
    model.updateObjects([{ id, patch: { props: { frame: true } } }]);
    expect(ymap.get('v')).toBe(2);
    expect((ymap.get('props') as SceneProps).items).toEqual([]);
  });
});
