import { ApiError, type User } from '@myfinance/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getCachedUser, getToken, setCachedUser, setToken } from './api';
import { invalidate } from './cache';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Render optimista: si hay usuario cacheado se muestra la app de inmediato
  // y /auth/me revalida en segundo plano (solo un 401 desloguea).
  const [user, setUser] = useState<User | null>(() => (getToken() ? getCachedUser() : null));
  const [loading, setLoading] = useState(() => Boolean(getToken()) && !getCachedUser());

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((me) => {
        setUser(me);
        setCachedUser(me);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          setCachedUser(null);
          // El cache persiste en sessionStorage: limpiarlo para que otro usuario
          // que entre en esta pestaña no vea datos de la sesión expirada.
          invalidate();
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.login({ email, password });
    // Descartar cualquier dato cacheado de una sesión anterior en esta pestaña.
    invalidate();
    setToken(res.token);
    setCachedUser(res.user);
    setUser(res.user);
  }

  async function register(name: string, email: string, password: string) {
    const res = await api.register({ name, email, password });
    invalidate();
    setToken(res.token);
    setCachedUser(res.user);
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setCachedUser(null);
    invalidate();
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
