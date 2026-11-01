import type { ReactNode } from 'react';
import { z } from 'zod';
import type { ObjectModule } from '@doska/shared';

/**
 * Группа: объект без геометрии. Дети ссылаются на неё полем groupId;
 * выделение, перемещение и трансформация группы применяются к детям.
 */
export const GROUP_TYPE = 'core.group';

export const groupModule: ObjectModule<{ name?: string }, ReactNode> = {
  type: GROUP_TYPE,
  title: 'Группа',
  version: 1,
  propsSchema: z.object({ name: z.string().max(100).optional() }),
  createProps: () => ({}),
  serialize: (o) => o as never,
  deserialize: (raw) => raw as never,
  getLocalBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  hitTest: () => false,
  getHandles: () => [],
  render: () => null,
  transform: { rotatable: true, resize: 'free' },
};
