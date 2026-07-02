import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { DashboardPage } from './pages/DashboardPage';
import { RecurringPage } from './pages/RecurringPage';
import { ReportsPage } from './pages/ReportsPage';
import { TransactionsPage } from './pages/TransactionsPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-wrap muted">Cargando…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/registro" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/transacciones" element={<TransactionsPage />} />
        <Route path="/recurrentes" element={<RecurringPage />} />
        <Route path="/presupuestos" element={<BudgetsPage />} />
        <Route path="/categorias" element={<CategoriesPage />} />
        <Route path="/reportes" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
