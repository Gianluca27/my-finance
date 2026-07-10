import React from 'react';
import {
  IcoDebt,
  IcoDoc,
  IcoGrid,
  IcoList,
  IcoMeter,
  IcoRepeat,
  IcoSettings,
  IcoSpark,
  IcoTag,
  IcoTarget,
  IcoWallet,
  type IconProps,
} from './components/icons';

export interface NavItem {
  route: string;
  label: string;
  icon: (p: IconProps) => React.ReactElement;
}

/**
 * Fuente única de las páginas navegables desde la sidebar.
 * `route` debe coincidir con el `name` del Stack.Screen en App.tsx.
 * `PRIMARY` = las 4 que antes vivían en la navbar inferior.
 * `SECONDARY` = las 6 que antes vivían en la página "Más".
 */
export const PRIMARY_ITEMS: NavItem[] = [
  { route: 'Resumen', label: 'Resumen', icon: IcoGrid },
  { route: 'Movimientos', label: 'Movimientos', icon: IcoList },
  { route: 'Presupuestos', label: 'Presupuestos', icon: IcoMeter },
  { route: 'Fijos', label: 'Gastos Fijos', icon: IcoRepeat },
];

export const SECONDARY_ITEMS: NavItem[] = [
  { route: 'Sugerencias', label: 'Sugerencias', icon: IcoSpark },
  { route: 'Cuentas', label: 'Cuentas', icon: IcoWallet },
  { route: 'Deudas', label: 'Deudas', icon: IcoDebt },
  { route: 'Metas', label: 'Metas', icon: IcoTarget },
  { route: 'Categorias', label: 'Categorías', icon: IcoTag },
  { route: 'Reportes', label: 'Reportes', icon: IcoDoc },
];

/** Preferencias va en el footer de la sidebar, junto a Cerrar sesión. */
export const SETTINGS_ITEM: NavItem = { route: 'Preferencias', label: 'Preferencias', icon: IcoSettings };

/** Todas las páginas en orden, para armar el Stack.Navigator. */
export const ALL_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS, SETTINGS_ITEM];
