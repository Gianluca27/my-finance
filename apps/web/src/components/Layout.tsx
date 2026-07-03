import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';

const NAV_ITEMS = [
  { to: '/', label: 'Resumen' },
  { to: '/transacciones', label: 'Movimientos' },
  { to: '/recurrentes', label: 'Gastos fijos' },
  { to: '/presupuestos', label: 'Presupuestos' },
  { to: '/deudas', label: 'Deudas' },
  { to: '/categorias', label: 'Categorías' },
  { to: '/reportes', label: 'Reportes' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-inner">
          <NavLink to="/" className="brand">
            MyFinance<span className="brand-dot">.</span>
          </NavLink>
          <nav className="tabs">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="masthead-user">
            <span className="user-name">{user?.name}</span>
            <button className="ghost" onClick={logout}>
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
