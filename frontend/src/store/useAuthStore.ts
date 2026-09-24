import { create } from 'zustand';
import type { User } from '../types/auth';
import { login as apiLogin, register as apiRegister, logout as apiLogout, fetchMe } from '../api/authApi';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (account: string, password: string) => Promise<User>;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<User>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // 监听 auth-expired 事件（client.ts 在 401 时派发）
  window.addEventListener('auth-expired', () => {
    set({ user: null });
  });

  return {
    user: null,
    loading: true,

    login: async (account, password) => {
      const user = await apiLogin(account, password);
      set({ user });
      return user;
    },

    register: async (email, username, password, displayName) => {
      const user = await apiRegister(email, username, password, displayName);
      set({ user });
      return user;
    },

    logout: async () => {
      try {
        await apiLogout();
      } finally {
        set({ user: null });
      }
    },

    loadMe: async () => {
      set({ loading: true });
      try {
        const user = await fetchMe();
        set({ user, loading: false });
      } catch {
        set({ user: null, loading: false });
      }
    },
  };
});
