import type { ChangePasswordRequest, LoginRequest, LoginResponse, Me, UserPreferences } from '@doska/shared';
import { http } from './http';

export const authApi = {
  me: () => http.get<{ user: Me }>('/api/auth/me'),
  login: (body: LoginRequest) => http.post<LoginResponse>('/api/auth/login', body),
  logout: () => http.post<void>('/api/auth/logout'),
  logoutAll: () => http.post<void>('/api/auth/logout-all'),
  changePassword: (body: ChangePasswordRequest) => http.post<LoginResponse>('/api/auth/change-password', body),
  updatePreferences: (patch: Partial<UserPreferences>) =>
    http.patch<{ preferences: UserPreferences }>('/api/auth/me/preferences', patch),
};
