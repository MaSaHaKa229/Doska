import type { Paginated, TemplateLevel, TemplateScope, TemplateSummary } from '@doska/shared';
import { http } from './http';

export interface TemplateInput {
  title: string;
  description?: string | null;
  section: string;
  level: TemplateLevel;
  tags: string[];
  visibility: 'PRIVATE' | 'TEACHERS' | 'SELECTED';
  shareUserIds: string[];
}

export const templatesApi = {
  list: (q: { scope?: TemplateScope; section?: string; level?: TemplateLevel; search?: string; page?: number; pageSize?: number }, signal?: AbortSignal) =>
    http.get<Paginated<TemplateSummary>>('/api/templates', { query: { ...q }, signal }),
  get: (id: string) => http.get<{ template: TemplateSummary }>(`/api/templates/${id}`),
  create: (body: TemplateInput & { boardId: string }) => http.post<{ template: TemplateSummary }>('/api/templates', body),
  update: (id: string, body: Partial<TemplateInput>) => http.patch<{ template: TemplateSummary }>(`/api/templates/${id}`, body),
  delete: (id: string) => http.delete<void>(`/api/templates/${id}`),
  use: (id: string, body: { title?: string; folderId?: string | null } = {}) => http.post<{ boardId: string }>(`/api/templates/${id}/use`, body),
};
