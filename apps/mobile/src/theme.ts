export const colors = {
  page: '#f9f9f7',
  surface: '#fcfcfb',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  border: 'rgba(11,11,11,0.10)',
  gridline: '#e1e0d9',
  accent: '#2a78d6',
  income: '#2a78d6',
  expense: '#eb6834',
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  deltaGood: '#006300',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
};

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
