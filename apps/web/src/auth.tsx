import type { User } from '@myfinance/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.login({ email, password });
    setToken(res.token);
    setUser(res.user);
  }

  async function register(name: string, email: string, password: string) {
    const res = await api.register({ name, email, password });
    setToken(res.token);
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
