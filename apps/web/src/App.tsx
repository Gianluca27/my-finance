import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { prefetch } from './cache';
import { Layout } from './components/Layout';

// Cada página se carga bajo demanda: el bundle inicial no arrastra Recharts
// (solo lo usa el Dashboard) ni el resto de las vistas.
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const DebtsPage = lazy(() => import('./pages/DebtsPage').then((m) => ({ default: m.DebtsPage })));
const GoalsPage = lazy(() => import('./pages/GoalsPage').then((m) => ({ default: m.GoalsPage })));
const InvestmentsPage = lazy(() => import('./pages/InvestmentsPage').then((m) => ({ default: m.InvestmentsPage })));
const RecurringPage = lazy(() => import('./pages/RecurringPage').then((m) => ({ default: m.RecurringPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SuggestionsPage = lazy(() => import('./pages/SuggestionsPage').then((m) => ({ default: m.SuggestionsPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })));

export default function App() {
  const { user, loading } = useAuth();

  // Apenas hay usuario: bajar el chunk del Dashboard (ruta inicial) y disparar
  // sus datos en paralelo, en vez de esperar chunk -> montaje -> fetch en serie.
  useEffect(() => {
    if (!user) return;
    import('./pages/DashboardPage');
    prefetch('dashboard', () => api.dashboard());
    prefetch('budgets', () => api.listBudgets());
  }, [user]);

  if (loading) {
    return <div className="auth-wrap muted">Cargando…</div>;
  }

  if (!user) {
    return (
      <Suspense fallback={<div className="auth-wrap muted">Cargando…</div>}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/registro" element={<AuthPage mode="register" />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cuentas" element={<AccountsPage />} />
          <Route path="/transacciones" element={<TransactionsPage />} />
          <Route path="/recurrentes" element={<RecurringPage />} />
          <Route path="/sugerencias" element={<SuggestionsPage />} />
          <Route path="/presupuestos" element={<BudgetsPage />} />
          <Route path="/deudas" element={<DebtsPage />} />
          <Route path="/metas" element={<GoalsPage />} />
          <Route path="/inversiones" element={<InvestmentsPage />} />
          <Route path="/categorias" element={<CategoriesPage />} />
          <Route path="/reportes" element={<ReportsPage />} />
          <Route path="/preferencias" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
