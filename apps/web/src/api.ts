import { ApiClient } from '@myfinance/shared';

const TOKEN_KEY = 'myfinance.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const api = new ApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken,
  onUnauthorized: () => {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  },
});

export function formatMoney(value: number): string {
  return value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC' });
}
