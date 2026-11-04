import type { ReactNode } from 'react';
import type { BoardObject, ToolModule } from '@doska/shared';
import { toLocal } from '../../objects/util';
import { toast } from '../../store/toast';
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
];
