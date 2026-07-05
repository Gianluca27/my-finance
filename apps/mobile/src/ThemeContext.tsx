import React, { createContext, useContext } from 'react';
import { darkColors, type ThemeColors } from './theme';

/**
 * Tema único dark-only (paridad con la web, que no tiene modo claro).
 * Se conserva el hook useTheme() con la misma forma para no tocar pantallas.
 */
type ThemeContextValue = {
  colors: ThemeColors;
  scheme: 'dark';
};

const VALUE: ThemeContextValue = { colors: darkColors, scheme: 'dark' };

const ThemeContext = createContext<ThemeContextValue>(VALUE);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
