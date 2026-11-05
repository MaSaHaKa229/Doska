import type { BoardVersionSummary } from '@doska/shared';
import { http } from './http';

export const versionsApi = {
  list: (boardId: string) => http.get<{ versions: BoardVersionSummary[] }>(`/api/boards/${boardId}/versions`),
  create: (boardId: string, label: string) => http.post<{ version: BoardVersionSummary }>(`/api/boards/${boardId}/versions`, { label }),
  restore: (boardId: string, versionId: string) => http.post<{ restored: { pages: number; objects: number } }>(`/api/boards/${boardId}/versions/${versionId}/restore`, {}),
};
