import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND, BACKGROUND_KINDS, type Background } from '@doska/shared';
import { drawBackground, effectiveStep, MIN_GRID_PX, type Ctx2D } from './background';
import { fitRect, panBy, screenToWorld, viewportRect, wheelIntent, worldToScreen, zoomAt } from './camera';

function recorder() {
  let segments = 0;
  const ctx: Ctx2D = {
    beginPath() {},
    moveTo() {
      segments++;
    },
    lineTo() {},
    arc() {},
    rect() {},
    stroke() {},
    fill() {},
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    set lineWidth(_v: number) {},
  };
  return { ctx, count: () => segments };
}

describe('камера', () => {
  const size = { width: 800, height: 600 };
  it('мир ↔ экран', () => {
    const cam = { cx: 100, cy: 50, zoom: 2 };
    const s = worldToScreen(cam, size, { x: 110, y: 60 });
    expect(s).toEqual({ x: 420, y: 320 });
    expect(screenToWorld(cam, size, s)).toEqual({ x: 110, y: 60 });
    expect(viewportRect(cam, size)).toEqual({ x: -100, y: -100, width: 400, height: 300 });
  });
  it('масштаб вокруг курсора сохраняет точку под ним', () => {
    const cam = { cx: 0, cy: 0, zoom: 1 };
    const cursor = { x: 600, y: 100 };
    const before = screenToWorld(cam, size, cursor);
    const next = zoomAt(cam, size, cursor, 3);
    const after = screenToWorld(next, size, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(cam, size, cursor, 1e9).zoom).toBe(50);
  });
  it('панорамирование и «показать всё»', () => {
    expect(panBy({ cx: 0, cy: 0, zoom: 2 }, 100, -50)).toEqual({ cx: -50, cy: 25, zoom: 2 });
    const f = fitRect({ x: 0, y: 0, width: 1000, height: 100 }, size, 0, 10);
    expect(f).toEqual({ cx: 500, cy: 50, zoom: 0.8 });
  });
  it('колесо мыши — масштаб, трекпад — перемещение, щипок — масштаб', () => {
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe('zoom');
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe('zoom');
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 4.5, deltaY: 12.3 })).toBe('pan');
    expect(wheelIntent({ ctrlKey: true, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 1.2 })).toBe('zoom');
  });
});

describe('фон', () => {
  it('шаг укрупняется при отдалении', () => {
    expect(effectiveStep(20, 1)).toBe(20);
    expect(effectiveStep(20, 0.1) * 0.1).toBeGreaterThanOrEqual(MIN_GRID_PX);
    expect(effectiveStep(20, 0.1)).toBe(100);
  });
  it('количество линий ограничено при любом масштабе', () => {
    for (const kind of BACKGROUND_KINDS) {
      for (const zoom of [0.02, 0.3, 1, 8]) {
        const r = recorder();
        const bg: Background = { ...DEFAULT_BACKGROUND, kind };
        const view = { x: -400 / zoom, y: -300 / zoom, width: 800 / zoom, height: 600 / zoom };
        drawBackground(r.ctx, bg, view, zoom, { minor: '#000', major: '#000' });
        // Для точек — по одной «линии» на точку; ограничение мягче.
        expect(r.count()).toBeLessThan(kind === 'dots' ? 8000 : 2000);
      }
    }
  });
});
