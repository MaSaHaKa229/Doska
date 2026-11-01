import type { AssignmentDetails, AssignmentSummary, StudentAssignment } from '@doska/shared';
import { http, refreshSession } from './http';

export const assignmentsApi = {
  list: () => http.get<{ assignments: AssignmentSummary[] }>('/api/assignments'),
  mine: () => http.get<{ assignments: StudentAssignment[] }>('/api/assignments/mine'),
  get: (id: string) => http.get<{ assignment: AssignmentDetails }>(`/api/assignments/${id}`),
  create: (body: { title: string; instructions?: string; templateBoardId: string; classId: string | null; studentIds: string[]; dueAt?: string | null }) =>
    http.post<{ assignment: AssignmentDetails }>('/api/assignments', body),
  update: (id: string, body: { title?: string; instructions?: string | null; dueAt?: string | null; closed?: boolean }) =>
    http.patch<{ assignment: AssignmentDetails }>(`/api/assignments/${id}`, body),
  delete: (id: string) => http.delete<void>(`/api/assignments/${id}`),
  addStudents: (id: string, body: { studentIds?: string[]; fromClass?: boolean }) =>
    http.post<{ assignment: AssignmentDetails }>(`/api/assignments/${id}/students`, { studentIds: [], fromClass: false, ...body }),
  submit: (workId: string) => http.post<void>(`/api/works/${workId}/submit`, {}),
  unsubmit: (workId: string) => http.post<void>(`/api/works/${workId}/unsubmit`, {}),
  review: (workId: string, grade: string | null) => http.post<void>(`/api/works/${workId}/review`, { grade }),
  returnWork: (workId: string) => http.post<void>(`/api/works/${workId}/return`, {}),
};

/**
 * Документ доски целиком (Yjs) для миниатюры. Ответ двоичный, поэтому
 * запрос идёт напрямую через fetch; при истёкшем токене сессия
 * обновляется один раз.
 */
export async function fetchBoardSnapshot(boardId: string, signal?: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`/api/boards/${boardId}/snapshot`, { credentials: 'same-origin', signal });
    if (res.status === 401 && attempt === 0 && (await refreshSession())) continue;
    if (!res.ok) throw new Error(`Снимок доски недоступен (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('Снимок доски недоступен');
}
