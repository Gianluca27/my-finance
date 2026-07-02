import type { BudgetStatus, Category } from '@myfinance/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';

export function BudgetsPage() {
  const [budgets, setBudgets] = useState<BudgetStatus[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listBudgets().then(setBudgets).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    api
      .listCategories()
      .then((cats) => setCategories(cats.filter((c) => c.type === 'EXPENSE')))
      .catch(() => {});
  }, [load]);

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
      load();
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
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  return (
    <>
      <h1 className="page-title">Presupuestos</h1>
      <p className="page-subtitle">
        Límites mensuales por categoría con alerta al superar el umbral
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
        <h3>Definir presupuesto</h3>
        <div className="form-row">
          <label className="field">
            Categoría
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
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
          <button disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Si la categoría ya tiene presupuesto, se actualiza.
        </p>
      </form>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {!budgets ? (
          <p className="muted">Cargando…</p>
        ) : budgets.length === 0 ? (
          <p className="muted">Todavía no definiste presupuestos.</p>
        ) : (
          budgets.map((budget) => {
            const over = budget.percentUsed >= 100;
            const near = !over && budget.percentUsed >= budget.alertThreshold;
            return (
              <div className="card" key={budget.id}>
                <div className="list-row" style={{ borderBottom: 'none', paddingTop: 0 }}>
                  <span className="cat-chip" style={{ fontSize: 15, fontWeight: 600 }}>
                    <span className="cat-dot" style={{ background: budget.category.color }} />
                    {budget.category.name}
                  </span>
                  <button className="danger" onClick={() => onDelete(budget.id)}>
                    Eliminar
                  </button>
                </div>
                <div className="meter" style={{ margin: '8px 0' }}>
                  <div
                    className={`meter-fill ${over ? 'over' : near ? 'near' : ''}`}
                    style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span className="muted">
                    {formatMoney(budget.spent)} de {formatMoney(budget.amount)}
                  </span>
                  <span className="legend-value">{budget.percentUsed}%</span>
                </div>
                {over && (
                  <p className="status-note" style={{ color: 'var(--critical)', margin: '8px 0 0' }}>
                    ⛔ Presupuesto superado
                  </p>
                )}
                {near && (
                  <p className="status-note" style={{ color: 'var(--warning)', margin: '8px 0 0' }}>
                    ⚠️ Cerca del límite (umbral {budget.alertThreshold}%)
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
