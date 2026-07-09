import type { BudgetStatus, Category } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

export function BudgetsPage() {
  const [error, setError] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const { data: budgets, error: loadError, refresh } = useCached<BudgetStatus[]>('budgets', () =>
    api.listBudgets(),
  );
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = (categoriesData ?? []).filter((c) => c.type === 'EXPENSE');

  const totalBudgeted = (budgets ?? []).reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = (budgets ?? []).reduce((sum, b) => sum + b.spent, 0);
  const monthLabel = new Date().toLocaleDateString('es-AR', { month: 'long' });

  // Días que quedan en el mes (incluyendo hoy) para repartir lo que resta del presupuesto.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.upsertBudget({
        categoryId,
        amount: Number(amount),
        alertThreshold: Number(threshold),
      });
      setCategoryId('');
      setAmount('');
      setFormOpen(false);
      invalidate('budgets');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este presupuesto?')) return;
    try {
      await api.deleteBudget(id);
      invalidate('budgets');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-3" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="mf-label">Presupuestado</div>
          <div className="mf-hero-balance" style={{ fontSize: 26 }}>
            {formatMoney(totalBudgeted)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Gastado en {monthLabel}</div>
          <div className="mf-hero-balance" style={{ fontSize: 26, color: 'var(--neg)' }}>
            {formatMoney(totalSpent)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Restante</div>
          <div className="mf-hero-balance" style={{ fontSize: 26, color: 'var(--pos)' }}>
            {formatMoney(totalBudgeted - totalSpent)}
          </div>
        </div>
      </div>

      {!budgets ? (
        <p className="muted">Cargando…</p>
      ) : budgets.length === 0 ? (
        <p className="muted">Todavía no definiste presupuestos.</p>
      ) : (
        <div className="mf-grid-2">
          {budgets.map((budget) => {
            const over = budget.percentUsed >= 100;
            const near = !over && budget.percentUsed >= budget.alertThreshold;
            const status = over ? 'Superado' : near ? 'Cerca del límite' : 'En camino';
            const color = budget.category.color;
            const remainingBudget = Math.max(0, budget.amount - budget.spent);
            const perDay = remainingBudget / daysLeft;
            return (
              <div className="card mf-budget-card" key={budget.id}>
                <div className="mf-budget-head">
                  <div className="mf-budget-icon" style={{ background: `${color}26` }}>
                    {budget.category.icon ?? '💰'}
                  </div>
                  <div className="mf-budget-titles">
                    <div className="mf-budget-name">{budget.category.name}</div>
                    <div className={`mf-budget-status ${over ? 'over' : near ? 'near' : ''}`}>{status}</div>
                  </div>
                  <div className="mf-budget-pct">{budget.percentUsed}%</div>
                  <button
                    type="button"
                    className="mf-icon-btn"
                    aria-label="Eliminar presupuesto"
                    onClick={() => onDelete(budget.id)}
                  >
                    <IcoTrash size={15} />
                  </button>
                </div>
                <div className="mf-progress">
                  <div
                    className={`mf-progress-fill ${over ? 'over' : near ? 'near' : ''}`}
                    style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
                  />
                </div>
                <div className="mf-budget-foot">
                  <span className="mono muted">
                    {formatMoney(budget.spent)} de {formatMoney(budget.amount)}
                  </span>
                  <span className="muted">Quedan {formatMoney(remainingBudget)}</span>
                </div>
                <div className="mf-budget-foot" style={{ marginTop: 4 }}>
                  <span className="muted">{daysLeft} días para fin de mes</span>
                  <span className={over ? '' : 'mono'} style={{ color: over ? 'var(--neg)' : 'var(--pos)' }}>
                    {over ? 'Presupuesto superado' : `${formatMoney(perDay)}/día disponible`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className="mf-add-btn" style={{ marginTop: 16 }} onClick={() => setFormOpen(true)}>
        <IcoPlus />
        <span className="mf-add-label">Nuevo Presupuesto</span>
      </button>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nuevo presupuesto">
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Categoría
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required autoFocus>
              <option value="">Elegir…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Límite mensual
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Umbral de alerta (%)
            <input
              type="number"
              min="1"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Si la categoría ya tiene presupuesto, se actualiza.
          </p>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </form>
      </Modal>
    </>
  );
}
