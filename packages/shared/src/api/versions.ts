import { z } from 'zod';

/**
 * История версий доски (/api/boards/:id/versions): снимки документа —
 * автоматические, ручные с подписью, перед восстановлением и перед
 * очисткой. Восстановление — семантическая правка поверх текущего
 * документа (docs/SYNC_PROTOCOL.md, раздел 12). Нужно право restoreVersions.
 */

export const VERSION_REASONS = ['AUTO', 'MANUAL', 'BEFORE_RESTORE', 'BEFORE_CLEAR'] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];
export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  AUTO: 'Автосохранение',
  MANUAL: 'Сохранено вручную',
  BEFORE_RESTORE: 'Перед восстановлением',
  BEFORE_CLEAR: 'Перед очисткой',
};

export const createVersionSchema = z.object({
  label: z.string({ required_error: 'Подпишите версию' }).trim().min(1, 'Подпишите версию').max(200, 'Не длиннее 200 символов'),
});
export type CreateVersionRequest = z.infer<typeof createVersionSchema>;

export interface BoardVersionSummary {
  id: string;
  reason: VersionReason;
  label: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  objectCount: number;
  sizeBytes: number;
}
