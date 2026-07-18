import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthenticatedUser, Role } from './types';

interface AuthState {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setUser: (u: AuthenticatedUser | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setSession: (u: AuthenticatedUser, accessToken: string, refreshToken: string) => void;
  clear: () => void;
  hasRole: (...roles: Role[]) => boolean;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setUser: (u) => set({ user: u }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setSession: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
      hasRole: (...roles) => {
        const r = get().user?.role;
        return !!r && roles.includes(r);
      },
      isAuthenticated: () => !!get().accessToken && !!get().user,
    }),
    {
      name: 'msh-auth',
      storage: createJSONStorage(() => localStorage),
      // Persist only non-sensitive-ish fields. Access token persisted so a page
      // reload doesn't force a re-login; the 401 interceptor will refresh as needed.
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    },
  ),
);
