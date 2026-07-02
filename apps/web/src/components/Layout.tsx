import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/transacciones', label: 'Transacciones', icon: '💸' },
  { to: '/recurrentes', label: 'Gastos fijos', icon: '🔁' },
  { to: '/presupuestos', label: 'Presupuestos', icon: '🎯' },
  { to: '/categorias', label: 'Categorías', icon: '🏷️' },
  { to: '/reportes', label: 'Reportes', icon: '📄' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">💰 MyFinance</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.icon} <span className="label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="muted" style={{ padding: '0 12px 8px' }}>
          {user?.name}
        </div>
        <button className="secondary" onClick={logout}>
          Salir
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
