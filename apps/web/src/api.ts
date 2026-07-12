import { ApiClient, type User } from '@myfinance/shared';
import { clear } from './cache';

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
    clear();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  },
});

/**
 * Formatea un monto en la moneda indicada (default ARS, la moneda base
 * histórica). Con ARS rinde "$ 1.234" y con USD "US$ 1.234" (locale es-AR).
 * El modelo de monedas es free-string: un código no ISO cae a "1.234 XXX".
 */
export function formatMoney(value: number, currency: string = 'ARS'): string {
  try {
    return value.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return `${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC' });
}
