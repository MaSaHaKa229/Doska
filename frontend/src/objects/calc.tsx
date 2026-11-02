import type { ReactNode } from 'react';
import { z } from 'zod';
import type { BoardObject, ObjectModule } from '@doska/shared';
import { MAX_LATEX } from '../text/schema';
import { DEFAULT_FORMULA_SIZE, formulaModule, formulaPropsSchema } from './formula';

export const CALC_TYPE = 'core.calc';

/**
 * Результат калькулятора: формула «запись = результат» и сама запись —
 * двойной щелчок открывает калькулятор с ней, чтобы пересчитать.
 * Рисуется так же, как формула.
 */
export const calcPropsSchema = formulaPropsSchema.extend({
  /** Запись в калькуляторе («72 км/ч в м/с»). */
  expr: z.string().max(500),
  latex: z.string().max(MAX_LATEX),
});
export type CalcProps = z.infer<typeof calcPropsSchema>;

const base = formulaModule as unknown as ObjectModule<CalcProps, ReactNode>;

export const calcModule: ObjectModule<CalcProps, ReactNode> = {
  ...base,
  type: CALC_TYPE,
  title: 'Вычисление',
  propsSchema: calcPropsSchema,
  createProps: () => ({ expr: '', latex: '', size: DEFAULT_FORMULA_SIZE, color: 'ink' }),
  serialize: (o) => o,
  deserialize: (raw) => raw as unknown as BoardObject<CalcProps>,
  editor: 'calc',
};
