import type { Category, Debt, DebtDirection } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

const DIRECTION_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Debés',
  OWED_TO_ME: 'Te deben',
};

const AVATAR_PALETTE = ['#f59e0b', '#ef4444', '#22c55e', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function DebtsPage() {
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

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
      setFormOpen(false);
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
  const oweDebts = activeDebts.filter((d) => d.direction === 'I_OWE');
  const owedDebts = activeDebts.filter((d) => d.direction === 'OWED_TO_ME');

  const totalIOwe = oweDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const totalOwedToMe = owedDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const netBalance = totalOwedToMe - totalIOwe;

  function renderDebtCard(debt: Debt) {
    const paid = debt.totalAmount - debt.remainingBalance;
    const percentPaid = debt.totalAmount > 0 ? Math.min(100, Math.round((paid / debt.totalAmount) * 100)) : 100;
    const color = avatarColor(debt.counterparty);
    const barModifier = debt.direction === 'I_OWE' ? 'owe' : 'owed';
    return (
      <div className="card mf-debt-card" key={debt.id}>
        <div className="mf-debt-head">
          <div className="mf-debt-avatar" style={{ background: color }}>
            {debt.counterparty.slice(0, 1).toUpperCase()}
          </div>
          <div className="mf-debt-titles">
            <div className="mf-debt-name">{debt.counterparty}</div>
            <div className="mf-debt-desc">{debt.description || DIRECTION_LABEL[debt.direction]}</div>
          </div>
          {!debt.settledAt && (
            <div className="mf-debt-amounts">
              <div className="mf-debt-remaining">{formatMoney(debt.remainingBalance)}</div>
              <div className="mf-debt-total">de {formatMoney(debt.totalAmount)}</div>
            </div>
          )}
          {!debt.settledAt && (
            <button
              type="button"
              className="mf-icon-btn"
              aria-label="Eliminar deuda"
              onClick={() => onDelete(debt.id)}
            >
              <IcoTrash size={14} />
            </button>
          )}
        </div>

        {debt.settledAt ? (
          <p className="muted mono" style={{ margin: '10px 0 0' }}>
            Saldada · {formatMoney(debt.totalAmount)}
          </p>
        ) : (
          <div className="mf-progress" style={{ marginTop: 12 }}>
            <div className={`mf-progress-fill ${barModifier}`} style={{ width: `${percentPaid}%` }} />
          </div>
        )}

        {!debt.settledAt &&
          (payingId === debt.id ? (
            <div className="form-row" style={{ marginTop: 10 }}>
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
            <button type="button" className="mf-debt-pay" onClick={() => onStartPay(debt)}>
              Registrar pago
            </button>
          ))}
      </div>
    );
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="mf-eyebrow">Debo</div>
          <div className="mf-hero-balance" style={{ fontSize: 32, color: 'var(--neg)' }}>
            {formatMoney(totalIOwe)}
          </div>
        </div>
        <div className="card">
          <div className="mf-eyebrow">Me deben</div>
          <div className="mf-hero-balance" style={{ fontSize: 32, color: 'var(--pos)' }}>
            {formatMoney(totalOwedToMe)}
          </div>
        </div>
        <div className="card">
          <div className="mf-eyebrow">Balance neto</div>
          <div
            className="mf-hero-balance"
            style={{ fontSize: 32, color: netBalance < 0 ? 'var(--neg)' : 'var(--pos)' }}
          >
            {netBalance < 0 ? '−' : ''}
            {formatMoney(Math.abs(netBalance))}
          </div>
        </div>
      </div>

      {!debts ? (
        <p className="muted">Cargando…</p>
      ) : activeDebts.length === 0 ? (
        <p className="muted">No hay deudas activas.</p>
      ) : (
        <div className="mf-grid-2">
          <div>
            <div className="mf-eyebrow" style={{ marginBottom: 12 }}>
              Debo
            </div>
            <div className="mf-debt-col">
              {oweDebts.length === 0 ? <p className="muted">Nada pendiente.</p> : oweDebts.map(renderDebtCard)}
            </div>
          </div>
          <div>
            <div className="mf-eyebrow" style={{ marginBottom: 12 }}>
              Me deben
            </div>
            <div className="mf-debt-col">
              {owedDebts.length === 0 ? <p className="muted">Nada pendiente.</p> : owedDebts.map(renderDebtCard)}
            </div>
          </div>
        </div>
      )}

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

      <div className="card" style={{ marginTop: 16 }}>
        <button type="button" className="mf-add-btn" onClick={() => setFormOpen(true)}>
          <IcoPlus />
          <span className="mf-add-label">Nueva</span>
        </button>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nueva deuda">
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
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
              autoFocus
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
          <label className="field">
            Descripción
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar deuda'}</button>
        </form>
      </Modal>
    </>
  );
}
