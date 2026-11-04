import type { ReactNode } from 'react';
import { Line } from 'react-konva';
import type { BoardObject, Point, ToolModule, ToolPointerEvent } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { toast } from '../../store/toast';
import { CELL_PX } from './field';
import type { PartKind } from './circuit';
import { CIRCUIT_TYPE, MAX_PARTS, PART_TITLES, circuitBox, circuitModule, newPart, nextPartId, type CircuitProps } from './circuits';
import { CAPACITOR_TYPE, MAX_CHARGES, PLUGIN_ID, SYSTEM_TYPE, capacitorModule, nextChargeId, systemModule, type CapacitorProps, type SystemProps } from './objects';

const section = PLUGIN_ID;

/** Заряд щелчком: в систему под курсором (в пределах её рамки) или в новую систему. */
function chargeTool(sign: 1 | -1): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${sign > 0 ? 'positive' : 'negative'}`,
    title: sign > 0 ? 'Заряд +' : 'Заряд −',
    icon: sign > 0 ? 'CirclePlus' : 'CircleMinus',
    group: 'physics',
    section,
    keywords: ['заряд', sign > 0 ? 'положительный заряд' : 'отрицательный заряд', 'точечный заряд', 'закон кулона', 'электростатика', 'силовые линии', 'напряжённость'],
    requiresWrite: true,
    cursor: 'copy',
    options: [{ kind: 'number', key: 'chargeQ', label: '|q|, нКл', min: 0.001, max: 1e6, step: 1 }],
    onPointerDown(e, ctx) {
      const v = Math.abs(Number(ctx.getToolOptions<{ chargeQ?: number }>().chargeQ) || 5);
      const host = (ctx.listObjects(SYSTEM_TYPE) as BoardObject<SystemProps>[]).find((o) => {
        const q = toLocal(o, e.world);
        return q.x >= 0 && q.y >= 0 && q.x <= o.props.w && q.y <= o.props.h;
      });
      if (host) {
        if (host.props.charges.length >= MAX_CHARGES) {
          toast.info(`В системе не больше ${MAX_CHARGES} зарядов`);
          return;
        }
        const at = toLocal(host, e.world);
        ctx.updateObject<SystemProps>(host.id, { props: { charges: [...host.props.charges, { id: nextChargeId(host.props.charges), x: at.x, y: at.y, q: sign * v }] } });
        ctx.setSelection([host.id]);
        return;
      }
      const props: SystemProps = { ...systemModule.createProps(), charges: [{ id: 'q1', x: 300, y: 200, q: sign * v }] };
      const id = ctx.createObject<SystemProps>(SYSTEM_TYPE, { x: e.world.x - 300, y: e.world.y - 200, props });
      if (id) ctx.setSelection([id]);
    },
  };
}

// =====================================================================
//  Цепи: элемент протяжкой по узлам сетки
// =====================================================================

/** Узел сетки (мировые координаты), ближайший к точке. */
const snapNode = (p: Point): Point => ({ x: Math.round(p.x / CELL_PX) * CELL_PX, y: Math.round(p.y / CELL_PX) * CELL_PX });

interface Wiring {
  a: Point;
  b: Point;
}

/** Конец элемента — по горизонтали или вертикали от начала (по большему смещению). */
function endOf(a: Point, e: ToolPointerEvent): Point {
  const q = snapNode(e.world);
  return Math.abs(q.x - a.x) >= Math.abs(q.y - a.y) ? { x: q.x, y: a.y } : { x: a.x, y: q.y };
}

const PART_ICONS: Record<PartKind, string> = { wire: 'Spline', battery: 'BatteryFull', resistor: 'RectangleHorizontal', rheostat: 'SlidersHorizontal', lamp: 'Lightbulb', switch: 'ToggleLeft', ammeter: 'Gauge', voltmeter: 'Activity' };
const PART_KEYWORDS: Record<PartKind, string[]> = {
  wire: ['провод', 'соединение'],
  battery: ['источник тока', 'батарея', 'эдс', 'гальванический элемент', 'внутреннее сопротивление'],
  resistor: ['резистор', 'сопротивление', 'закон ома'],
  rheostat: ['реостат', 'переменное сопротивление'],
  lamp: ['лампа', 'лампочка', 'мощность тока'],
  switch: ['ключ', 'выключатель'],
  ammeter: ['амперметр', 'сила тока'],
  voltmeter: ['вольтметр', 'напряжение'],
};

function partTool(kind: PartKind): ToolModule<ReactNode> {
  return {
    id: `${PLUGIN_ID}.${kind}`,
    title: PART_TITLES[kind],
    icon: PART_ICONS[kind],
    group: 'physics',
    section: `${PLUGIN_ID}.circuits`,
    keywords: [...PART_KEYWORDS[kind], 'электрическая цепь', 'схема', 'постоянный ток'],
    requiresWrite: true,
    cursor: 'crosshair',
    onPointerDown(e, ctx) {
      const a = snapNode(e.world);
      ctx.setPreview({ a, b: a } satisfies Wiring);
    },
    onPointerMove(e, ctx) {
      const w = ctx.getPreview<Wiring>();
      if (w) ctx.setPreview({ ...w, b: endOf(w.a, e) } satisfies Wiring);
    },
    onPointerUp(e, ctx) {
      const w = ctx.getPreview<Wiring>();
      ctx.setPreview(null);
      if (!w) return;
      let b = endOf(w.a, e);
      // Щелчок без протяжки — элемент длиной 3 клетки вправо.
      if (b.x === w.a.x && b.y === w.a.y) b = { x: w.a.x + 3 * CELL_PX, y: w.a.y };
      // Схема, в чьей области начат элемент, — иначе новая (начало координат — в узле сетки).
      const host = (ctx.listObjects(CIRCUIT_TYPE) as BoardObject<CircuitProps>[]).find((o) => {
        const bx = circuitBox(o.props);
        const q = toLocal(o, w.a);
        return q.x >= bx.x && q.y >= bx.y && q.x <= bx.x + bx.width && q.y <= bx.y + bx.height;
      });
      const origin = host ? { x: host.x, y: host.y } : w.a;
      const cellOf = (p: Point): [number, number] => [Math.round((p.x - origin.x) / CELL_PX), Math.round((p.y - origin.y) / CELL_PX)];
      if (host) {
        if (host.props.parts.length >= MAX_PARTS) {
          toast.info(`В схеме не больше ${MAX_PARTS} элементов`);
          return;
        }
        ctx.updateObject<CircuitProps>(host.id, { props: { parts: [...host.props.parts, newPart(kind, nextPartId(host.props.parts), cellOf(w.a), cellOf(b))] } });
        ctx.setSelection([host.id]);
        return;
      }
      const props: CircuitProps = { ...circuitModule.createProps(), parts: [newPart(kind, 'e1', [0, 0], cellOf(b))] };
      const id = ctx.createObject<CircuitProps>(CIRCUIT_TYPE, { x: origin.x, y: origin.y, props });
      if (id) ctx.setSelection([id]);
    },
    onKeyDown(key, _m, ctx) {
      if (key !== 'Escape' || !ctx.getPreview<Wiring>()) return false;
      ctx.setPreview(null);
      return true;
    },
    renderOverlay(ctx) {
      const w = ctx.getPreview<Wiring>();
      if (!w) return null;
      return <Line points={[w.a.x, w.a.y, w.b.x, w.b.y]} stroke="#2a7de1" strokeWidth={2} dash={[6, 4]} strokeScaleEnabled={false} listening={false} />;
    },
  };
}

export const electricityTools: ToolModule<ReactNode>[] = [
  chargeTool(1),
  chargeTool(-1),
  {
    id: `${PLUGIN_ID}.capacitor`,
    title: 'Плоский конденсатор',
    icon: 'Columns2',
    group: 'physics',
    section,
    keywords: ['конденсатор', 'плоский конденсатор', 'ёмкость', 'электроёмкость', 'энергия конденсатора', 'однородное поле'],
    requiresWrite: true,
    cursor: 'copy',
    onPointerDown(e, ctx) {
      const id = ctx.createObject<CapacitorProps>(CAPACITOR_TYPE, { x: e.world.x, y: e.world.y, props: capacitorModule.createProps() });
      ctx.activateTool('core.select');
      if (id) ctx.setSelection([id]);
    },
  },
  ...(['wire', 'battery', 'resistor', 'rheostat', 'lamp', 'switch', 'ammeter', 'voltmeter'] as const).map(partTool),
];
