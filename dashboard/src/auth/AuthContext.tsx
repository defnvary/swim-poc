// 04 §2 — { user, login, logout }; access token in a module variable (memory only,
// never localStorage). Bootstrap: try /auth/me, fall back to one refresh attempt.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, apiAuth, setLogoutHandler } from '../api/client';
import type { User } from '../api/types';

let accessToken: string | null = null;
export const getAccessToken = (): string | null => accessToken;
export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};

type Phase = 'loading' | 'anonymous' | 'ready';

interface AuthValue {
  user: User | null;
  phase: Phase;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPhase('anonymous');
  }, []);

  useEffect(() => {
    setLogoutHandler(clear);
    void (async () => {
      try {
        const { user: u } = await api<{ user: User }>('/api/auth/me');
        setUser(u);
        setPhase('ready');
      } catch {
        setPhase('anonymous');
      }
    })();
    return () => setLogoutHandler(null);
  }, [clear]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiAuth.login({ username, password });
    setAccessToken(res.accessToken);
    setUser(res.user as User);
    setPhase('ready');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiAuth.logout();
    } catch {
      /* session already gone — clearing locally is what matters */
    }
    clear();
  }, [clear]);

  const refreshUser = useCallback(async () => {
    const { user: u } = await api<{ user: User }>('/api/auth/me');
    setUser(u);
  }, []);

  const value = useMemo(() => ({ user, phase, login, logout, refreshUser }), [user, phase, login, logout, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
