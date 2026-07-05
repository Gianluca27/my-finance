/**
 * Paleta única dark-only, portada 1:1 desde los tokens de la app web
 * (apps/web/src/styles.css). La web no tiene modo claro, así que el móvil
 * tampoco: un solo objeto de colores. Rampa neutra en hex exactos del diseño
 * (banca privada, azulado profundo) + oro cálido como acento secundario editorial.
 */
export const darkColors = {
  page: '#10141a', // --bg
  page2: '#141922', // --bg-2
  surface: '#1a2029', // --surface
  surface2: '#232c37', // --surface-2 (campos, segmentos)
  textPrimary: '#eef1ee', // --text
  textSecondary: '#cdd4cf', // --text-2
  textMuted: '#7a8480', // --text-3
  border: '#262f3b', // --border
  border2: '#333c47', // --border-2
  gridline: '#262f3b', // --border
  accent: '#63e4a1', // --accent (verde menta)
  income: '#63e4a1', // --pos
  expense: '#f47b74', // --neg
  good: '#63e4a1', // --pos
  warning: '#f2b95a', // --warn
  critical: '#f47b74', // --neg
  deltaGood: '#63e4a1', // --pos
  overlay: 'rgba(0,0,0,0.6)',
  chipActiveBg: 'rgba(99,228,161,0.13)', // --accent-weak
  neutralDot: '#7a8480',
  onAccent: '#012111', // --accent-ink (tinta oscura sobre el verde)
  gold: '#b6a684', // --gold (tagline, rótulos serif)
  goldStrong: '#d3b06a', // --gold-strong
};

export type ThemeColors = typeof darkColors;

/**
 * Familias de fuente cargadas en App.tsx (Schibsted Grotesk + IBM Plex Mono +
 * Newsreader). Newsreader es la serif editorial para cifras de display (roman)
 * y rótulos de sección (itálica), igual que --serif / --hero-font en web.
 */
export const fonts = {
  regular: 'SchibstedGrotesk_400Regular',
  medium: 'SchibstedGrotesk_500Medium',
  semibold: 'SchibstedGrotesk_600SemiBold',
  bold: 'SchibstedGrotesk_700Bold',
  monoRegular: 'IBMPlexMono_400Regular',
  mono: 'IBMPlexMono_500Medium',
  serif: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
  serifSemibold: 'Newsreader_600SemiBold',
  serifItalic: 'Newsreader_400Regular_Italic',
  serifMediumItalic: 'Newsreader_500Medium_Italic',
};

/** Radios de borde, iguales a --r / --r-sm de web. */
export const radius = {
  sm: 10,
  md: 18,
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

/** Fecha corta tipo "03 jul" (UTC). */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Monto compacto: "$ 1,2M" / "$ 34k" / "$ 500". */
export function formatMoneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}$ ${(abs / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) return `${sign}$ ${Math.round(abs / 1000)}k`;
  return `${sign}$ ${Math.round(abs)}`;
}

/** Nombre del mes a partir de "YYYY-MM" (UTC), ej. "julio de 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Etiqueta corta de mes desde "YYYY-MM", ej. "jul". */
export function shortMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('es-AR', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Días calendario hasta una fecha ISO (negativo si ya pasó). Compara solo la parte de fecha. */
export function daysUntil(iso: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(iso);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** Progreso del mes actual: día actual y cantidad de días del mes. */
export function monthProgress(): { day: number; days: number } {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { day: now.getDate(), days };
}

/** Mes actual en formato "YYYY-MM". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Fecha de hoy en formato "YYYY-MM-DD". */
export function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** Paleta de colores para cuentas, categorías y metas (igual que web). */
export const COLOR_PALETTE = [
  '#2a78d6',
  '#0ca30c',
  '#eb6834',
  '#9333ea',
  '#e11d48',
  '#0891b2',
  '#ca8a04',
  '#475569',
];
