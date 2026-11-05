import { create } from 'zustand';
import type { Credential } from '@doska/shared';

/**
 * Временные пароли, полученные от сервера при создании/импорте/сбросе.
 * Хранятся ТОЛЬКО в памяти вкладки (не в localStorage): после закрытия или
 * перезагрузки страницы они исчезают — сервер хранит лишь хеши.
 */
interface CredentialsState {
  title: string;
  items: Credential[];
  createdAt: number | null;
  set(title: string, items: Credential[]): void;
  clear(): void;
}

export const useCredentials = create<CredentialsState>((set) => ({
  title: '',
  items: [],
  createdAt: null,
  set: (title, items) => set({ title, items, createdAt: Date.now() }),
  clear: () => set({ title: '', items: [], createdAt: null }),
}));
