import { create } from 'zustand';
import type { LoginRequest, Me, UserPreferences } from '@doska/shared';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import { applyTheme } from './theme';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  user: Me | null;
  /** Сообщение для страницы входа (например, «сессия истекла»). */
  notice: string | null;
  init(): Promise<void>;
  login(input: LoginRequest): Promise<Me>;
  logout(allDevices?: boolean): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  updatePreferences(patch: Partial<UserPreferences>): Promise<void>;
  sessionLost(): void;
  markPasswordChangeRequired(): void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  notice: null,

  async init() {
    try {
      const { user } = await authApi.me();
      applyTheme(user.preferences.theme);
      set({ status: 'authenticated', user });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        set({ status: 'anonymous', user: null });
      } else {
        // Сервер недоступен: показываем вход с сообщением, пользователь сможет повторить.
        set({ status: 'anonymous', user: null, notice: err instanceof ApiError ? err.message : null });
      }
    }
  },

  async login(input) {
    const { user } = await authApi.login(input);
    applyTheme(user.preferences.theme);
    set({ status: 'authenticated', user, notice: null });
    return user;
  },

  async logout(allDevices = false) {
    try {
      if (allDevices) await authApi.logoutAll();
      else await authApi.logout();
    } finally {
      set({ status: 'anonymous', user: null, notice: null });
    }
  },

  async changePassword(currentPassword, newPassword) {
    const { user } = await authApi.changePassword({ currentPassword, newPassword });
    set({ user });
  },

  async updatePreferences(patch) {
    const current = get().user;
    if (!current) return;
    // Оптимистично: тема меняется сразу.
    set({ user: { ...current, preferences: { ...current.preferences, ...patch } } });
    if (patch.theme) applyTheme(patch.theme);
    const { preferences } = await authApi.updatePreferences(patch);
    const latest = get().user;
    if (latest) set({ user: { ...latest, preferences } });
  },

  sessionLost() {
    if (get().status === 'authenticated') {
      set({ status: 'anonymous', user: null, notice: 'Сессия завершена. Войдите снова' });
    }
  },

  markPasswordChangeRequired() {
    const u = get().user;
    if (u && !u.mustChangePassword) set({ user: { ...u, mustChangePassword: true } });
  },
}));
