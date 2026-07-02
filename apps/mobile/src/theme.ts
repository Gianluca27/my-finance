export const lightColors = {
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
  overlay: 'rgba(0,0,0,0.4)',
  chipActiveBg: 'rgba(42,120,214,0.10)',
  neutralDot: '#9ca3af',
  onAccent: '#fff',
};

export const darkColors: typeof lightColors = {
  page: '#111110',
  surface: '#1a1a18',
  textPrimary: '#f2f1ed',
  textSecondary: '#c9c7c0',
  textMuted: '#8f8d86',
  border: 'rgba(255,255,255,0.12)',
  gridline: '#2c2b27',
  accent: '#4b95e8',
  income: '#4b95e8',
  expense: '#ff8a5c',
  good: '#3ddb3d',
  warning: '#ffc94d',
  critical: '#ff6b6b',
  deltaGood: '#4ce24c',
  overlay: 'rgba(0,0,0,0.6)',
  chipActiveBg: 'rgba(75,149,232,0.18)',
  neutralDot: '#6b7280',
  onAccent: '#fff',
};

export type ThemeColors = typeof lightColors;

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
