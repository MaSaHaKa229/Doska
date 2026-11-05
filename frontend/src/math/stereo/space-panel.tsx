import { useState } from 'react';
import { Button } from '../../ui/Button';
import { PALETTE } from '../../objects/colors';
import type { Body } from './solids';
import { ITEM_TITLES, MAX_POINTS, elemOf, measureOf, nextId, nextPointName, pointPositions, refText, removeWithDependents, type Item, type ItemKind, type Space, type SpacePoint } from './space';

export type Mode = 'rotate' | 'point' | ItemKind;

export const MODES: { mode: Mode; title: string; need: number }[] = [
  { mode: 'rotate', title: 'Вращать', need: 0 },
  { mode: 'point', title: 'Точка', need: 1 },
  { mode: 'segment', title: 'Отрезок', need: 2 },
  { mode: 'line', title: 'Прямая', need: 2 },
  { mode: 'plane', title: 'Плоскость', need: 3 },
  { mode: 'section', title: 'Сечение', need: 3 },
  { mode: 'dist', title: 'Расстояние', need: 2 },
  { mode: 'angle', title: 'Угол', need: 2 },
];

/** Подсказка режима: что выбрать следующим. */
export function modeHint(mode: Mode, picked: string[]): string {
  const n = picked.length;
  const chosen = n ? ` Выбрано: ${picked.join(', ')}.` : '';
  switch (mode) {
    case 'rotate':
      return 'Протяните, чтобы повернуть сцену; колесо или щипок — масштаб.';
    case 'point':
      return 'Щёлкните по вершине, ребру или видимой грани — появится точка. Доля ребра округляется до сотых, её можно поправить в списке.';
    case 'segment':
    case 'line':
      return `Щёлкните по двум точкам (вершины и точки на рёбрах тоже подходят).${chosen}`;
    case 'plane':
    case 'section':
      return `Щёлкните по трём точкам, не лежащим на одной прямой.${mode === 'section' ? ' Сечение строится для тела первой точки.' : ''}${chosen}`;
    case 'dist':
      return `Выберите два объекта: точки, отрезки, прямые, плоскости или сечения.${chosen}`;
    case 'angle':
      return `Выберите две прямые или плоскости (отрезок, прямую, плоскость, сечение).${chosen}`;
  }
}

/** Цвета новых построений. */
export const ITEM_COLORS: Record<ItemKind, string> = { segment: 'ink', line: 'ink', plane: 'accent-3', section: 'accent-1', dist: 'accent-5', angle: 'accent-5' };

function itemLabel(s: Space, it: Item): string {
  const names = new Map(s.points.map((p) => [p.id, p.name || '?']));
  const n = (k: string) => names.get(k) ?? elemOf(s, k)?.name ?? '?';
  if (it.k === 'segment' || it.k === 'line') return `${ITEM_TITLES[it.k]} ${n(it.a)}${n(it.b)}`;
  if (it.k === 'plane' || it.k === 'section') return `${ITEM_TITLES[it.k]} (${n(it.a)}${n(it.b)}${n(it.c)})`;
  const m = measureOf(s, it);
  return m ? m.text : `${ITEM_TITLES[it.k]}: не определено`;
}

/** Вкладка «Построения»: режимы выбора, точки и построения сцены. */
export function SpacePanel({ space, set, mode, setMode }: { space: Space; set(next: Pick<Space, 'points' | 'items'>): void; mode: Mode; setMode(m: Mode): void }) {
  const [xyz, setXyz] = useState('0; 0; 0');
  const pos = pointPositions(space);
  const parsed = xyz.split(';').map((v) => Number(v.trim().replace(',', '.')));
  const okXyz = parsed.length === 3 && parsed.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e4) && xyz.split(';').every((v) => v.trim());
  const setPoint = (id: string, patch: Partial<SpacePoint>) => set({ points: space.points.map((p) => (p.id === id ? { ...p, ...patch } : p)), items: space.items });
  const remove = (id: string) => set(removeWithDependents(space, [id]));

  return (
    <>
      <div className="stereo-modes" role="radiogroup" aria-label="Режим">
        {MODES.map((m) => (
          <Button key={m.mode} size="small" variant={mode === m.mode ? 'primary' : undefined} role="radio" aria-checked={mode === m.mode} onClick={() => setMode(m.mode)}>
            {m.title}
          </Button>
        ))}
      </div>

      <div className="stereo-list" aria-label="Точки">
        <div className="small muted">Точки ({space.points.length})</div>
        {space.points.map((p) => (
          <div key={p.id} className="stereo-list__row">
            <input className="input stereo-list__name" aria-label={`Имя точки ${p.name}`} maxLength={8} value={p.name} onChange={(e) => setPoint(p.id, { name: e.target.value })} />
            <span className="small" style={{ flex: 1 }}>
              {refText(p, space.bodies as Body[])}
              {!pos.get(p.id) && <span style={{ color: 'var(--danger)' }}> — нет опоры</span>}
            </span>
            {p.at.k === 'edge' && (
              <label className="row small" style={{ gap: 4 }} title="Доля ребра от первой вершины">
                t
                <input
                  className="input stereo-list__t"
                  type="number"
                  aria-label={`Доля ребра для ${p.name}`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={p.at.t}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    if (p.at.k === 'edge' && Number.isFinite(t) && t >= 0 && t <= 1) setPoint(p.id, { at: { ...p.at, t } });
                  }}
                />
              </label>
            )}
            <Button size="small" variant="ghost" aria-label={`Удалить точку ${p.name}`} onClick={() => remove(p.id)}>
              ✕
            </Button>
          </div>
        ))}
        <div className="stereo-list__row">
          <input className="input mono" style={{ flex: 1 }} aria-label="Координаты новой точки" aria-invalid={!okXyz} value={xyz} onChange={(e) => setXyz(e.target.value)} placeholder="x; y; z" />
          <Button
            size="small"
            disabled={!okXyz || space.points.length >= MAX_POINTS}
            onClick={() =>
              set({
                points: [...space.points, { id: nextId('p', space.points), name: nextPointName(space), at: { k: 'coord', p: parsed as [number, number, number] }, color: 'ink' }],
                items: space.items,
              })
            }
          >
            Точка по координатам
          </Button>
        </div>
      </div>

      <div className="stereo-list" aria-label="Построения">
        <div className="small muted">Построения ({space.items.length})</div>
        {space.items.map((it) => (
          <div key={it.id} className="stereo-list__row">
            <span className="small" style={{ flex: 1 }} data-testid="stereo-item">
              {itemLabel(space, it)}
            </span>
            <select
              className="select select--small"
              aria-label={`Цвет: ${itemLabel(space, it)}`}
              value={it.color}
              onChange={(e) => set({ points: space.points, items: space.items.map((x) => (x.id === it.id ? { ...x, color: e.target.value } : x)) })}
            >
              {PALETTE.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button size="small" variant="ghost" aria-label={`Удалить: ${itemLabel(space, it)}`} onClick={() => remove(it.id)}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      <p className="small muted">Координаты — в единицах сцены, ось z вверх; тело по умолчанию стоит основанием в (0; 0; 0). Расстояния и углы подписываются на чертеже; длины вида 2√2 — точно.</p>
    </>
  );
}
