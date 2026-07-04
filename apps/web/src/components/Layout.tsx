import type { RecurringExpense } from '@myfinance/shared';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCached } from '../cache';
import { AddTransactionModal } from './AddTransactionModal';
import {
  IcoDebt,
  IcoDoc,
  IcoGrid,
  IcoList,
  IcoLogout,
  IcoMenu,
  IcoMeter,
  IcoPlus,
  IcoRepeat,
  IcoSearch,
  IcoSettings,
  IcoTag,
  IcoTarget,
  LogoMark,
} from './icons';

const NAV_ITEMS = [
  { to: '/', label: 'Resumen', icon: IcoGrid },
  { to: '/transacciones', label: 'Movimientos', icon: IcoList },
  { to: '/recurrentes', label: 'Gastos fijos', icon: IcoRepeat, badge: true },
  { to: '/presupuestos', label: 'Presupuestos', icon: IcoMeter },
  { to: '/deudas', label: 'Deudas', icon: IcoDebt },
  { to: '/metas', label: 'Metas', icon: IcoTarget },
  { to: '/categorias', label: 'Categorías', icon: IcoTag },
  { to: '/reportes', label: 'Reportes', icon: IcoDoc },
];

const BOTTOM_ITEMS = [
  { to: '/', label: 'Resumen', icon: IcoGrid },
  { to: '/transacciones', label: 'Movim.', icon: IcoList },
  { to: '/presupuestos', label: 'Presup.', icon: IcoMeter },
  { to: '/recurrentes', label: 'Fijos', icon: IcoRepeat },
  { to: '/reportes', label: 'Reportes', icon: IcoDoc },
];

const TITLES: Record<string, [string, string]> = {
  '/': ['Panel', 'Resumen'],
  '/transacciones': ['Registro', 'Movimientos'],
  '/recurrentes': ['Automático', 'Gastos fijos'],
  '/presupuestos': ['Control', 'Presupuestos'],
  '/deudas': ['Balance', 'Deudas'],
  '/metas': ['Ahorro', 'Metas'],
  '/categorias': ['Organización', 'Categorías'],
  '/reportes': ['Exportar', 'Reportes'],
  '/preferencias': ['Cuenta', 'Preferencias'],
};

function dueSoonCount(items: RecurringExpense[] | null): number {
  if (!items) return 0;
  const now = Date.now();
  return items.filter((r) => {
    if (!r.active) return false;
    const daysLeft = Math.round((new Date(r.nextDueDate).getTime() - now) / 86_400_000);
    return daysLeft <= 3;
  }).length;
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'mf-nav-link active' : 'mf-nav-link';
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: recurring } = useCached<RecurringExpense[]>('recurring', () => api.listRecurring());
  const badgeCount = useMemo(() => dueSoonCount(recurring), [recurring]);

  const [crumb, pageTitle] = TITLES[location.pathname] ?? ['', ''];
  const initials = (user?.name ?? '?').slice(0, 1).toUpperCase();

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    navigate(`/transacciones?q=${encodeURIComponent(search.trim())}`);
  }

  function navList(onNavigate?: () => void) {
    return (
      <nav className="mf-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass} onClick={onNavigate}>
            <span className="mf-nav-icon">
              <item.icon />
            </span>
            <span className="mf-nav-label">{item.label}</span>
            {item.badge && badgeCount > 0 && <span className="mf-nav-badge">{badgeCount}</span>}
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <div className="mf-app">
      <aside className="mf-side">
        <div className="mf-brand">
          <span className="mf-brand-mark">
            <LogoMark />
          </span>
          <span className="mf-brand-name">MyFinance</span>
        </div>
        {navList()}
        <div className="mf-side-footer">
          <NavLink to="/preferencias" className={navLinkClass}>
            <span className="mf-nav-icon">
              <IcoSettings />
            </span>
            <span className="mf-nav-label">Preferencias</span>
          </NavLink>
          <div className="mf-user">
            <div className="mf-avatar">{initials}</div>
            <div className="mf-user-info">
              <div className="mf-user-name">{user?.name}</div>
              <div className="mf-user-email">{user?.email}</div>
            </div>
            <button className="mf-icon-btn" title="Salir" aria-label="Cerrar sesión" onClick={logout}>
              <IcoLogout />
            </button>
          </div>
        </div>
      </aside>

      <div className="mf-main-col">
        <header className="mf-topbar">
          <button type="button" className="mf-menu-btn" aria-label="Menú" onClick={() => setMobileNavOpen(true)}>
            <IcoMenu />
          </button>
          <div className="mf-topbar-titles">
            <div className="mf-crumb">{crumb}</div>
            <h1>{pageTitle}</h1>
          </div>
          <form className="mf-topsearch" onSubmit={onSearchSubmit}>
            <IcoSearch />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar movimientos…"
              aria-label="Buscar movimientos"
            />
          </form>
          <button type="button" className="mf-add-btn" onClick={() => setTxModalOpen(true)}>
            <IcoPlus />
            <span className="mf-add-label">Registrar</span>
          </button>
        </header>

        <main className="mf-content">{children}</main>

        <nav className="mf-bottomnav">
          {BOTTOM_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
              <item.icon size={21} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {mobileNavOpen && (
        <div className="mf-drawer-backdrop" onClick={() => setMobileNavOpen(false)}>
          <div className="mf-drawer" onClick={(e) => e.stopPropagation()}>
            {navList(() => setMobileNavOpen(false))}
            <NavLink to="/preferencias" className={navLinkClass} onClick={() => setMobileNavOpen(false)}>
              <span className="mf-nav-icon">
                <IcoSettings />
              </span>
              <span className="mf-nav-label">Preferencias</span>
            </NavLink>
          </div>
        </div>
      )}

      <AddTransactionModal open={txModalOpen} onClose={() => setTxModalOpen(false)} />
    </div>
  );
}
