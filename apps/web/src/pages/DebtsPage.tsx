import type { Category, Debt, DebtDirection } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';

const DIRECTION_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Debés',
  OWED_TO_ME: 'Te deben',
};

export function DebtsPage() {
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const [direction, setDirection] = useState<DebtDirection>('I_OWE');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const { data: debts, error: loadError, refresh } = useCached<Debt[]>('debts', () => api.listDebts());
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = categoriesData ?? [];

  // El pago genera EXPENSE (I_OWE) o INCOME (OWED_TO_ME): la categoría elegible sigue esa dirección.
  const formCategories = categories.filter((c) => c.type === (direction === 'I_OWE' ? 'EXPENSE' : 'INCOME'));

  function invalidateAfterMutation() {
    invalidate('debts');
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createDebt({
        direction,
        counterparty,
        description: description || null,
        totalAmount: Number(totalAmount),
        categoryId: categoryId || null,
      });
      setCounterparty('');
      setDescription('');
      setTotalAmount('');
      setCategoryId('');
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onStartPay(debt: Debt) {
    setPayingId(debt.id);
    setPayAmount(String(debt.remainingBalance));
    setError(null);
  }

  function onCancelPay() {
    setPayingId(null);
  }

  async function onConfirmPay(debt: Debt) {
    setError(null);
    setPayBusy(true);
    try {
      await api.payDebt(debt.id, Number(payAmount));
      setPayingId(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setPayBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar esta deuda? Los pagos ya registrados quedan como movimientos sueltos.')) return;
    try {
      await api.deleteDebt(id);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const activeDebts = (debts ?? []).filter((d) => !d.settledAt);
  const settledDebts = (debts ?? []).filter((d) => d.settledAt);

  function renderDebtCard(debt: Debt) {
    const paid = debt.totalAmount - debt.remainingBalance;
    const percentPaid = debt.totalAmount > 0 ? Math.min(100, Math.round((paid / debt.totalAmount) * 100)) : 100;
    return (
      <div className="card" key={debt.id}>
        <div className="list-row" style={{ borderBottom: 'none', paddingTop: 0 }}>
          <span className="cat-chip" style={{ fontSize: 15, fontWeight: 600 }}>
            {debt.category && <span className="cat-dot" style={{ background: debt.category.color }} />}
            {debt.counterparty}
          </span>
          {!debt.settledAt && (
            <button className="danger" onClick={() => onDelete(debt.id)}>
              Eliminar
            </button>
          )}
        </div>
        <p className="muted" style={{ margin: '2px 0 8px' }}>
          {DIRECTION_LABEL[debt.direction]}
          {debt.description ? ` · ${debt.description}` : ''}
        </p>
        {!debt.settledAt && (
          <div className="meter" style={{ margin: '8px 0' }}>
            <div className="meter-fill" style={{ width: `${percentPaid}%` }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span className="muted mono">
            {debt.settledAt
              ? `Saldada · ${formatMoney(debt.totalAmount)}`
              : `Pagado ${formatMoney(paid)} / ${formatMoney(debt.totalAmount)}`}
          </span>
          {!debt.settledAt && <span className="legend-value">{formatMoney(debt.remainingBalance)} restante</span>}
        </div>

        {!debt.settledAt &&
          (payingId === debt.id ? (
            <div className="form-row" style={{ marginTop: 8 }}>
              <label className="field">
                Monto
                <input
                  type="number"
                  min="0.01"
                  max={debt.remainingBalance}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  autoFocus
                />
              </label>
              <button disabled={payBusy} onClick={() => onConfirmPay(debt)}>
                {payBusy ? 'Guardando…' : 'Confirmar'}
              </button>
              <button className="secondary" disabled={payBusy} onClick={onCancelPay}>
                Cancelar
              </button>
            </div>
          ) : (
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button className="secondary" onClick={() => onStartPay(debt)}>
                Registrar pago
              </button>
            </div>
          ))}
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Deudas</h1>
      <p className="page-subtitle">Plata que debés o que te deben, sin interés ni cronograma</p>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
        <h3>Nueva deuda</h3>
        <div className="form-row">
          <label className="field">
            Dirección
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as DebtDirection);
                setCategoryId('');
              }}
            >
              <option value="I_OWE">Yo debo</option>
              <option value="OWED_TO_ME">Me deben</option>
            </select>
          </label>
          <label className="field">
            Persona/entidad
            <input
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              required
              maxLength={100}
              placeholder="Ej: Juan, tarjeta…"
            />
          </label>
          <label className="field">
            Monto total
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Categoría
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {formCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 2 }}>
            Descripción
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar deuda'}</button>
        </div>
      </form>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {!debts ? (
          <p className="muted">Cargando…</p>
        ) : activeDebts.length === 0 ? (
          <p className="muted">No hay deudas activas.</p>
        ) : (
          activeDebts.map(renderDebtCard)
        )}
      </div>

      {settledDebts.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={() => setShowSettled((v) => !v)}>
            {showSettled ? 'Ocultar' : 'Ver'} saldadas ({settledDebts.length})
          </button>
          {showSettled && (
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 12 }}
            >
              {settledDebts.map(renderDebtCard)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
