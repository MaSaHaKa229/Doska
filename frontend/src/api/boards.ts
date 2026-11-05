import type {
  BoardAccessView,
  BoardDetails,
  BoardMode,
  BoardSummary,
  DirectoryUser,
  FolderView,
  Paginated,
} from '@doska/shared';
import { http } from './http';

export interface BoardsFilter {
  search?: string;
  folderId?: string;
  scope?: 'own' | 'shared' | 'all';
  sort?: 'lastActivityAt' | 'title' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TeacherClass {
  id: string;
  name: string;
  academicYear: string | null;
  studentCount: number;
}

export const boardsApi = {
  list: (f: BoardsFilter, signal?: AbortSignal) => http.get<Paginated<BoardSummary>>('/api/boards', { query: { ...f }, signal }),
  get: (id: string) => http.get<{ board: BoardDetails }>(`/api/boards/${id}`),
  create: (body: { title: string; description?: string; folderId?: string | null; mode?: BoardMode; classIds?: string[]; studentIds?: string[] }) =>
    http.post<{ board: BoardDetails }>('/api/boards', body),
  update: (
    id: string,
    body: { title?: string; description?: string | null; folderId?: string | null; sharedWithTeachers?: boolean; mode?: BoardMode },
  ) =>
    http.patch<{ board: BoardDetails }>(`/api/boards/${id}`, body),
  setAccess: (id: string, body: { classIds: string[]; members: { userId: string; role: 'CO_TEACHER' | 'STUDENT' | 'VIEWER' }[] }) =>
    http.put<{ access: BoardAccessView }>(`/api/boards/${id}/access`, body),
  delete: (id: string) => http.delete<void>(`/api/boards/${id}`),
  myClasses: () => http.get<{ classes: TeacherClass[] }>('/api/boards/my-classes'),
  /** Поиск учеников и учителей для выдачи доступа (только учитель). */
  directory: (q: { role: 'STUDENT' | 'TEACHER'; search?: string; classId?: string; limit?: number }, signal?: AbortSignal) =>
    http.get<{ users: DirectoryUser[] }>('/api/directory/users', { query: { ...q }, signal }),

  folders: () => http.get<{ folders: FolderView[] }>('/api/folders'),
  createFolder: (name: string, parentId: string | null) => http.post<{ folder: FolderView }>('/api/folders', { name, parentId }),
  updateFolder: (id: string, body: { name?: string; parentId?: string | null }) =>
    http.patch<{ folder: FolderView }>(`/api/folders/${id}`, body),
  deleteFolder: (id: string) => http.delete<void>(`/api/folders/${id}`),
};
