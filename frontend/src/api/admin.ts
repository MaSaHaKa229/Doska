import type {
  AdminStats,
  AdminUser,
  AuditEntryView,
  ClassDetails,
  ClassSummary,
  Credential,
  CreateUserResponse,
  ImportUsersResponse,
  Paginated,
  UserRole,
} from '@doska/shared';
import { http } from './http';

export interface UsersFilter {
  search?: string;
  role?: UserRole | '';
  classId?: string;
  noClass?: boolean;
  status?: 'active' | 'blocked' | 'pending' | 'all';
  sort?: 'fullName' | 'login' | 'createdAt' | 'lastLoginAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface UserInput {
  fullName: string;
  login?: string;
  role: UserRole;
  classIds: string[];
  color?: string;
}

export interface ImportInput {
  csv: string;
  defaultRole: 'STUDENT' | 'TEACHER';
  classId?: string;
  createMissingClasses: boolean;
  academicYear?: string;
  dryRun: boolean;
}

export interface AuditFilter {
  actions?: string[];
  actorId?: string;
  targetId?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const base = '/api/admin';

export const adminApi = {
  stats: () => http.get<AdminStats>(`${base}/stats`),

  listUsers: (f: UsersFilter, signal?: AbortSignal) =>
    http.get<Paginated<AdminUser>>(`${base}/users`, { query: { ...f, noClass: f.noClass || undefined }, signal }),
  getUser: (id: string) => http.get<{ user: AdminUser }>(`${base}/users/${id}`),
  suggestLogin: (fullName: string, signal?: AbortSignal) =>
    http.get<{ login: string }>(`${base}/users/suggest-login`, { query: { fullName }, signal }),
  createUser: (body: UserInput) => http.post<CreateUserResponse>(`${base}/users`, body),
  updateUser: (id: string, body: Partial<UserInput>) => http.patch<{ user: AdminUser }>(`${base}/users/${id}`, body),
  blockUser: (id: string, reason?: string) => http.post<{ user: AdminUser }>(`${base}/users/${id}/block`, { reason }),
  unblockUser: (id: string) => http.post<{ user: AdminUser }>(`${base}/users/${id}/unblock`),
  resetPassword: (id: string) => http.post<{ credential: Credential }>(`${base}/users/${id}/reset-password`),
  deleteUser: (id: string, confirmLogin: string) => http.delete<void>(`${base}/users/${id}`, { confirmLogin }),
  importUsers: (body: ImportInput) => http.post<ImportUsersResponse>(`${base}/users/import`, body),

  listClasses: (q: { search?: string; academicYear?: string; includeArchived?: boolean; page?: number; pageSize?: number }) =>
    http.get<Paginated<ClassSummary>>(`${base}/classes`, { query: { ...q, includeArchived: q.includeArchived || undefined } }),
  /** Все действующие классы (для выпадающих списков). */
  async allClasses(includeArchived = false): Promise<ClassSummary[]> {
    const out: ClassSummary[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await adminApi.listClasses({ page, pageSize: 100, includeArchived });
      out.push(...res.items);
      if (out.length >= res.total || res.items.length === 0) break;
    }
    return out;
  },
  getClass: (id: string) => http.get<{ class: ClassDetails }>(`${base}/classes/${id}`),
  createClass: (body: { name: string; description?: string; academicYear?: string }) =>
    http.post<{ class: ClassDetails }>(`${base}/classes`, body),
  updateClass: (
    id: string,
    body: { name?: string; description?: string | null; academicYear?: string | null; archived?: boolean },
  ) => http.patch<{ class: ClassDetails }>(`${base}/classes/${id}`, body),
  deleteClass: (id: string, confirmName: string) => http.delete<void>(`${base}/classes/${id}`, { confirmName }),
  addMembers: (id: string, userIds: string[]) => http.post<{ class: ClassDetails }>(`${base}/classes/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => http.delete<{ class: ClassDetails }>(`${base}/classes/${id}/members/${userId}`),
  resetClassPasswords: (id: string, onlyPending: boolean) =>
    http.post<{ credentials: Credential[] }>(`${base}/classes/${id}/reset-passwords`, { onlyPending }),

  listAudit: (f: AuditFilter, signal?: AbortSignal) => http.get<Paginated<AuditEntryView>>(`${base}/audit`, { query: { ...f }, signal }),
};
