import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * Estado global de la sidebar desplegable. El botón hamburguesa del header la
 * abre; el overlay <Sidebar/> la consume. Vive por fuera de las pantallas, así
 * que se comparte vía contexto en lugar de props.
 */
type SidebarContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo<SidebarContextValue>(
    () => ({ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }),
    [isOpen],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar debe usarse dentro de <SidebarProvider>');
  return ctx;
}
