import type { Account, Category, Debt, DebtDetail, DebtDirection } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPencil, IcoPlus, IcoTrash, IcoTrend } from '../components/icons';
import { Modal } from '../components/Modal';

const DIRECTION_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Debés',
  OWED_TO_ME: 'Te deben',
};

/** Fecha local YYYY-MM-DD (evita corrimiento de zona horaria de toISOString). */
function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Toma la parte YYYY-MM-DD de un ISO/fecha sin reinterpretar zona horaria. */
function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

type DueBadge = { text: string; modifier: 'overdue' | 'soon' | 'plain' };

/** Badge de vencimiento comparando solo la parte de fecha contra hoy. */
function dueBadge(dueDate: string | null): DueBadge | null {
  if (!dueDate) return null;
  const due = toDateInput(dueDate);
  const today = todayISODate();
  const days = Math.round((Date.parse(`${due}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000);
  const [, m, d] = due.split('-');
  const short = `${d}/${m}`;
  if (days < 0) return { text: 'Vencida', modifier: 'overdue' };
  if (days === 0) return { text: 'Vence hoy', modifier: 'soon' };
  if (days <= 7) return { text: `Vence en ${days} día${days === 1 ? '' : 's'}`, modifier: 'soon' };
  return { text: `Vence ${short}`, modifier: 'plain' };
}

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [direction, setDirection] = useState<DebtDirection>('I_OWE');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  // `historyFor` abre el modal ya (con el nombre disponible) mientras `historyDetail` carga el
  // historial de pagos en sí — mismo split que RecurringPage (historyItem/historyPayments).
  const [historyFor, setHistoryFor] = useState<Debt | null>(null);
  const [historyDetail, setHistoryDetail] = useState<DebtDetail | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { data: debts, error: loadError, refresh } = useCached<Debt[]>('debts', () => api.listDebts());
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = categoriesData ?? [];
  const { data: accountsData } = useCached<Account[]>('accounts', () => api.listAccounts());
  // Las archivadas no se ofrecen para registrar nuevos pagos.
  const accounts = (accountsData ?? []).filter((a) => !a.archivedAt);

  // El pago genera EXPENSE (I_OWE) o INCOME (OWED_TO_ME): la categoría elegible sigue esa dirección.
  const formCategories = categories.filter((c) => c.type === (direction === 'I_OWE' ? 'EXPENSE' : 'INCOME'));

  function invalidateAfterMutation() {
    invalidate('debts');
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    // El pago de una deuda impacta el saldo de la cuenta por defecto.
    invalidate('accounts');
    refresh();
  }

  function resetForm() {
    setEditingId(null);
    setDirection('I_OWE');
    setCounterparty('');
    setDescription('');
    setTotalAmount('');
    setCategoryId('');
    setDueDate('');
  }

  function onOpenCreate() {
    resetForm();
    setError(null);
    setFormOpen(true);
  }

  function onStartEdit(debt: Debt) {
    setEditingId(debt.id);
    setDirection(debt.direction);
    setCounterparty(debt.counterparty);
    setDescription(debt.description ?? '');
    setTotalAmount(String(debt.totalAmount));
    setCategoryId(debt.categoryId ?? '');
    setDueDate(debt.dueDate ? toDateInput(debt.dueDate) : '');
    setError(null);
    setFormOpen(true);
  }

  function onCloseForm() {
    setFormOpen(false);
    resetForm();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        counterparty,
        description: description || null,
        totalAmount: Number(totalAmount),
        categoryId: categoryId || null,
        dueDate: dueDate || null,
      };
      if (editingId) {
        await api.updateDebt(editingId, payload);
      } else {
        await api.createDebt({ direction, ...payload });
      }
      onCloseForm();
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
    setPayAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
    setPayDate(todayISODate());
    setError(null);
  }

  function onCancelPay() {
    setPayingId(null);
  }

  async function onConfirmPay(debt: Debt) {
    setError(null);
    setPayBusy(true);
    try {
      await api.payDebt(debt.id, Number(payAmount), payAccountId || undefined, payDate || undefined);
      setPayingId(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setPayBusy(false);
    }
  }

  async function onOpenHistory(debt: Debt) {
    setHistoryFor(debt);
    setHistoryDetail(null);
    setHistoryLoading(true);
    setError(null);
    try {
      setHistoryDetail(await api.getDebt(debt.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setHistoryLoading(false);
    }
  }

  function onCloseHistory() {
    setHistoryFor(null);
    setHistoryDetail(null);
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
  // Deudas con vencimiento primero (más próximo/vencido arriba); sin fecha al final.
  const byDueDate = (a: Debt, b: Debt) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  };
  const oweDebts = activeDebts.filter((d) => d.direction === 'I_OWE').sort(byDueDate);
  const owedDebts = activeDebts.filter((d) => d.direction === 'OWED_TO_ME').sort(byDueDate);

  const totalIOwe = oweDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const totalOwedToMe = owedDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const netBalance = totalOwedToMe - totalIOwe;

  function renderDebtCard(debt: Debt) {
    const paid = debt.totalAmount - debt.remainingBalance;
    const percentPaid = debt.totalAmount > 0 ? Math.min(100, Math.round((paid / debt.totalAmount) * 100)) : 100;
    const color = avatarColor(debt.counterparty);
    const barModifier = debt.direction === 'I_OWE' ? 'owe' : 'owed';
    const badge = dueBadge(debt.dueDate);
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
          <div className="mf-debt-actions">
            <button
              type="button"
              className="mf-icon-btn"
              aria-label="Ver historial de pagos"
              onClick={() => onOpenHistory(debt)}
            >
              <IcoTrend size={14} />
            </button>
            {!debt.settledAt && (
              <>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Editar deuda"
                  onClick={() => onStartEdit(debt)}
                >
                  <IcoPencil size={14} />
                </button>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Eliminar deuda"
                  onClick={() => onDelete(debt.id)}
                >
                  <IcoTrash size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {!debt.settledAt && badge && <span className={`mf-due-badge ${badge.modifier}`}>{badge.text}</span>}

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
              {accounts.length > 0 && (
                <label className="field">
                  Cuenta
                  <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.icon ? `${a.icon} ` : ''}
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Fecha
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
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

      <div className="mf-grid-3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="mf-label">Debo</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32, color: 'var(--neg)' }}>
            {formatMoney(totalIOwe)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Me deben</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32, color: 'var(--pos)' }}>
            {formatMoney(totalOwedToMe)}
          </div>
        </div>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Balance neto</div>
            <div
              className="mf-figure mf-figure--stat"
              style={{ fontSize: 32, color: netBalance < 0 ? 'var(--neg)' : 'var(--pos)' }}
            >
              {netBalance < 0 ? '−' : ''}
              {formatMoney(Math.abs(netBalance))}
            </div>
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

      <div className="mf-dashed-tile mf-dashed-tile--row">
        <button type="button" className="mf-dashed-main" onClick={onOpenCreate}>
          <span className="mf-dashed-mark" aria-hidden="true">
            <IcoPlus />
          </span>
          <span className="mf-dashed-title">Nueva deuda</span>
        </button>
      </div>

      <Modal open={formOpen} onClose={onCloseForm} title={editingId ? 'Editar deuda' : 'Nueva deuda'}>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Dirección
            <select
              value={direction}
              disabled={editingId !== null}
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
            Vencimiento
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            Descripción
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          <button disabled={busy}>
            {busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Agregar deuda'}
          </button>
        </form>
      </Modal>

      <Modal
        open={historyFor !== null}
        onClose={onCloseHistory}
        title={historyFor ? `Historial de pagos: ${historyFor.counterparty}` : ''}
      >
        {historyFor &&
          // El error va antes de chequear `historyDetail`: si la carga falla, detail queda null y
          // el "Cargando…" sería permanente (el banner de página queda tapado por el backdrop).
          (historyLoading ? (
            <p className="muted">Cargando…</p>
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : !historyDetail ? null : historyDetail.payments.length === 0 ? (
            <p className="muted">Todavía no registraste pagos para esta deuda.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="mf-label" style={{ marginBottom: 6 }}>
                {historyFor.direction === 'I_OWE' ? 'Pagaste' : 'Te pagaron'}{' '}
                {formatMoney(historyDetail.totalAmount - historyDetail.remainingBalance)} de{' '}
                {formatMoney(historyDetail.totalAmount)} en {historyDetail.payments.length} pago
                {historyDetail.payments.length === 1 ? '' : 's'}.
              </div>
              {historyDetail.payments.map((p) => (
                <div className="mf-list-row" key={p.id}>
                  <span className="muted" style={{ flexShrink: 0 }}>
                    {formatDate(p.date)}
                  </span>
                  {p.note && (
                    <span
                      className="muted"
                      style={{
                        flex: 1,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.note}
                    </span>
                  )}
                  <span className="mono" style={{ fontWeight: 600, marginLeft: 'auto' }}>
                    {formatMoney(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          ))}
      </Modal>
    </>
  );
}
