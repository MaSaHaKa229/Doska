import { useEffect, useRef } from 'react';
import type { Presence } from '../../collab/presence';
import { laserAlpha, type LaserPointer } from '../../collab/laser';
import { currentCamera, useBoard } from '../../store/board';
import { worldToScreen, type Size } from '../../canvas/camera';

const LASER_COLOR = '255, 45, 45';

/**
 * След лазерных указок (своей и других участников) поверх холста. Рисуется
 * на отдельном <canvas>, анимация идёт только пока есть неугасшие следы.
 */
export function LaserLayer({ presence, laser, sizeRef }: { presence: Presence; laser: LaserPointer; sizeRef: React.MutableRefObject<Size> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    // Когда пришла последняя точка следа участника — по нашим часам.
    const received = new Map<number, { lastT: number; at: number }>();

    const draw = () => {
      raf = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const size = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(size.width * dpr) || canvas.height !== Math.round(size.height * dpr)) {
        canvas.width = Math.round(size.width * dpr);
        canvas.height = Math.round(size.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      const now = performance.now();
      const pageId = useBoard.getState().pageId;
      const cam = currentCamera();

      const trails: { points: number[]; sinceLast: number }[] = [];
      if (laser.trail.pageId === pageId && laser.trail.points.length) {
        trails.push({ points: laser.trail.points, sinceLast: laser.trail.idleFor(now) });
      }
      const seen = new Set<number>();
      for (const p of presence.peers()) {
        const pts = p.laser?.points;
        if (!p.laser || p.laser.pageId !== pageId || !pts?.length) continue;
        seen.add(p.clientId);
        const lastT = pts[pts.length - 1]!;
        let rec = received.get(p.clientId);
        if (!rec || rec.lastT !== lastT) received.set(p.clientId, (rec = { lastT, at: now }));
        trails.push({ points: pts, sinceLast: now - rec.at });
      }
      for (const id of received.keys()) if (!seen.has(id)) received.delete(id);

      let active = false;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const { points, sinceLast } of trails) {
        const lastT = points[points.length - 1]!;
        let prev: { x: number; y: number } | null = null;
        for (let i = 0; i < points.length; i += 3) {
          const a = laserAlpha(points[i + 2]!, lastT, sinceLast);
          const s = worldToScreen(cam, size, { x: points[i]!, y: points[i + 1]! });
          if (a > 0) {
            active = true;
            if (prev) {
              ctx.strokeStyle = `rgba(${LASER_COLOR}, ${a})`;
              ctx.lineWidth = 4;
              ctx.shadowColor = `rgba(${LASER_COLOR}, ${a})`;
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(s.x, s.y);
              ctx.stroke();
            }
          }
          prev = s;
        }
        // «Точка» указки на конце следа.
        const headAlpha = laserAlpha(lastT, lastT, sinceLast);
        if (headAlpha > 0 && prev) {
          ctx.fillStyle = `rgba(${LASER_COLOR}, ${headAlpha})`;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(prev.x, prev.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
      if (active) raf = requestAnimationFrame(draw);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const unsubs = [presence.subscribe(kick), laser.subscribe(kick), useBoard.subscribe(kick)];
    kick();
    return () => {
      unsubs.forEach((u) => u());
      if (raf) cancelAnimationFrame(raf);
    };
  }, [presence, laser, sizeRef]);

  return <canvas ref={canvasRef} className="laser-layer" aria-hidden style={{ width: '100%', height: '100%' }} />;
}
