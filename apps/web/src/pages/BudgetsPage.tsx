import type { BudgetStatus, Category } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';
import { currentMonthKey, monthLabel, MonthPicker } from '../components/MonthPicker';

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const isCurrentMonth = month === currentMonthKey();

  const [error, setError] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const { data: budgets, error: loadError, refresh } = useCached<BudgetStatus[]>(`budgets:${month}`, () =>
    api.listBudgets(month),
  );
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = (categoriesData ?? []).filter((c) => c.type === 'EXPENSE');

  const totalBudgeted = (budgets ?? []).reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = (budgets ?? []).reduce((sum, b) => sum + b.spent, 0);

  // Días que quedan en el mes en curso (incluyendo hoy) para repartir lo que resta del
  // presupuesto. Solo tiene sentido para el mes actual: en uno pasado ya no queda nada por repartir.
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
      <div style={{ marginBottom: 14 }}>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {!isCurrentMonth && (
        <div className="mf-readonly-banner">Viendo {monthLabel(month)} — solo lectura</div>
      )}

      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="mf-label">Presupuestado</div>
          <div className="mf-figure mf-figure--stat">
            {formatMoney(totalBudgeted)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Gastado en {monthLabel(month)}</div>
          <div className="mf-figure mf-figure--stat" style={{ color: 'var(--neg)' }}>
            {formatMoney(totalSpent)}
          </div>
        </div>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Restante</div>
            <div className="mf-figure mf-figure--stat" style={{ color: 'var(--pos)' }}>
              {formatMoney(totalBudgeted - totalSpent)}
            </div>
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
                  {isCurrentMonth && (
                    <button
                      type="button"
                      className="mf-icon-btn"
                      aria-label="Eliminar presupuesto"
                      onClick={() => onDelete(budget.id)}
                    >
                      <IcoTrash size={15} />
                    </button>
                  )}
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
                  {isCurrentMonth ? (
                    <>
                      <span className="muted">{daysLeft} días para fin de mes</span>
                      <span className={over ? '' : 'mono'} style={{ color: over ? 'var(--neg)' : 'var(--pos)' }}>
                        {over ? 'Presupuesto superado' : `${formatMoney(perDay)}/día disponible`}
                      </span>
                    </>
                  ) : (
                    <span className={over ? '' : 'mono'} style={{ color: over ? 'var(--neg)' : 'var(--pos)' }}>
                      {over ? 'Presupuesto superado' : 'Presupuesto cumplido'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isCurrentMonth && (
        <div className="mf-dashed-tile mf-dashed-tile--row">
          <button type="button" className="mf-dashed-main" onClick={() => setFormOpen(true)}>
            <span className="mf-dashed-mark" aria-hidden="true">
              <IcoPlus />
            </span>
            <span className="mf-dashed-title">Nuevo presupuesto</span>
          </button>
        </div>
      )}

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
