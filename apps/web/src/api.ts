import { ApiClient, type User } from '@myfinance/shared';
import { invalidate } from './cache';

const TOKEN_KEY = 'myfinance.token';
const USER_KEY = 'myfinance.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Último usuario autenticado, para renderizar sin esperar a /auth/me. */
export function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user: User | null): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export const api = new ApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken,
  onUnauthorized: () => {
    setToken(null);
    setCachedUser(null);
    invalidate();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  },
});

export function formatMoney(value: number): string {
  return value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC' });
}
