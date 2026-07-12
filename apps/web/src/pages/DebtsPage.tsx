import type { Account, AccountsOverview, Category, Debt, DebtDetail, DebtDirection, ExchangeRate } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';
import { useAuth } from '../auth';
import { invalidate, useCached } from '../cache';
import { IcoPencil, IcoPlus, IcoTrash, IcoTrend } from '../components/icons';
import { Modal } from '../components/Modal';
import { crossRate, floor2, rateLabel } from '../lib/currency';

const DIRECTION_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Debés',
  OWED_TO_ME: 'Te deben',
};

/** Monedas first-class en la UI. El modelo acepta cualquier código (free-string). */
const CURRENCY_OPTIONS = ['ARS', 'USD'];

/** Fecha local YYYY-MM-DD (evita corrimiento de zona horaria de toISOString). */
function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Toma la parte YYYY-MM-DD de un ISO/fecha sin reinterpretar zona horaria. */
function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/** Fecha corta dd/mm de un ISO, sin reinterpretar zona horaria. */
function shortDate(iso: string): string {
  const [, m, d] = toDateInput(iso).split('-');
  return `${d}/${m}`;
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
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [direction, setDirection] = useState<DebtDirection>('I_OWE');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  // Deuda en cuotas (spec 17): el monto por cuota se autocalcula (total / cuotas) mientras el
  // usuario no lo edite a mano (installmentAmountEdited).
  const [inInstallments, setInInstallments] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('');
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [installmentAmountEdited, setInstallmentAmountEdited] = useState(false);
  const [firstDueDate, setFirstDueDate] = useState('');
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
  const { data: accountsData } = useCached<AccountsOverview>('accounts', () => api.listAccounts());
  // Las archivadas no se ofrecen para registrar nuevos pagos.
  const accounts = (accountsData?.items ?? []).filter((a) => !a.archivedAt);
  // Cotizaciones vigentes: previsualizan la conversión de pagos cross-currency
  // (el servidor convierte con las mismas reglas al confirmar).
  const { data: ratesData } = useCached<ExchangeRate[]>('rates', () => api.listExchangeRates());
  const rates = ratesData ?? [];

  // La moneda es inmutable con pagos registrados (regla de la API, espejo de cuentas).
  const editingDebt = editingId ? (debts ?? []).find((d) => d.id === editingId) : undefined;
  const currencyLocked = editingDebt?.hasPayments ?? false;

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

  /** Monto por cuota autocalculado (total / cuotas, 2 decimales) o '' si aún no se puede. */
  function autoInstallmentAmount(total: string, count: string): string {
    const t = Number(total);
    const c = Number(count);
    return t > 0 && c > 0 ? String(Math.round((t / c) * 100) / 100) : '';
  }

  /** Recalcula el monto por cuota cuando cambian total o cuotas, salvo que el usuario lo haya editado. */
  function syncInstallmentAmount(total: string, count: string) {
    if (!installmentAmountEdited) setInstallmentAmount(autoInstallmentAmount(total, count));
  }

  function resetForm() {
    setEditingId(null);
    setDirection('I_OWE');
    setCounterparty('');
    setDescription('');
    setTotalAmount('');
    // Default de moneda: la base del usuario (spec 19 fase B).
    setCurrency(user?.baseCurrency ?? 'ARS');
    setCategoryId('');
    setDueDate('');
    setInInstallments(false);
    setInstallmentCount('');
    setInstallmentAmount('');
    setInstallmentAmountEdited(false);
    setFirstDueDate('');
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
    setCurrency(debt.currency ?? 'ARS');
    setCategoryId(debt.categoryId ?? '');
    setDueDate(debt.dueDate ? toDateInput(debt.dueDate) : '');
    const hasPlan = debt.installmentCount != null;
    setInInstallments(hasPlan);
    setInstallmentCount(hasPlan ? String(debt.installmentCount) : '');
    setInstallmentAmount(
      hasPlan
        ? debt.installmentAmount != null
          ? String(debt.installmentAmount)
          : autoInstallmentAmount(String(debt.totalAmount), String(debt.installmentCount))
        : '',
    );
    // Si el monto guardado fue explícito, no lo pisamos al recalcular total/cuotas.
    setInstallmentAmountEdited(hasPlan && debt.installmentAmount != null);
    setFirstDueDate(debt.firstDueDate ? toDateInput(debt.firstDueDate) : '');
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
        currency,
        categoryId: categoryId || null,
        dueDate: dueDate || null,
        // Con el toggle apagado se mandan null explícitos: al editar, quita el plan de cuotas.
        installmentCount: inInstallments ? Number(installmentCount) : null,
        installmentAmount: inInstallments && installmentAmount ? Number(installmentAmount) : null,
        firstDueDate: inInstallments ? firstDueDate || null : null,
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

  /** Prellenado del monto del pago, en la MONEDA DE LA CUENTA elegida: la próxima cuota
   * (capada al saldo) o el saldo restante. Cross-currency se convierte con piso a centavos,
   * así el reconvertido del servidor nunca supera el saldo; sin cotización queda vacío. */
  function payPrefill(debt: Debt, account: Account | undefined): string {
    const target = debt.nextInstallment
      ? Math.min(debt.nextInstallment.amount, debt.remainingBalance)
      : debt.remainingBalance;
    const debtCurrency = debt.currency ?? 'ARS';
    if (!account || account.currency === debtCurrency) return String(target);
    const rate = crossRate(debtCurrency, account.currency, rates);
    return rate === null ? '' : String(floor2(target * rate));
  }

  function onStartPay(debt: Debt) {
    const account = accounts.find((a) => a.isDefault) ?? accounts[0];
    setPayingId(debt.id);
    // En cuotas precarga el monto de la próxima cuota (editable: adelantar capital sigue siendo
    // un pago parcial normal); sin cuotas, el saldo restante como siempre.
    setPayAmount(payPrefill(debt, account));
    setPayAccountId(account?.id ?? '');
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
  // Vencimiento efectivo: en cuotas manda la próxima cuota impaga; si no, la dueDate global.
  const effectiveDueDate = (d: Debt) => d.nextInstallment?.dueDate ?? d.dueDate;
  // Deudas con vencimiento primero (más próximo/vencido arriba); sin fecha al final.
  const byDueDate = (a: Debt, b: Debt) => {
    const dueA = effectiveDueDate(a);
    const dueB = effectiveDueDate(b);
    if (dueA && dueB) return dueA.localeCompare(dueB);
    if (dueA) return -1;
    if (dueB) return 1;
    return 0;
  };
  const oweDebts = activeDebts.filter((d) => d.direction === 'I_OWE').sort(byDueDate);
  const owedDebts = activeDebts.filter((d) => d.direction === 'OWED_TO_ME').sort(byDueDate);

  // Totales por moneda de deuda, sin convertir: acá se muestran los nominales de cada
  // moneda (el consolidado a base con "≈" vive en el dashboard).
  const sumByCurrency = (list: Debt[]) => {
    const map = new Map<string, number>();
    for (const d of list) {
      const c = d.currency ?? 'ARS';
      map.set(c, (map.get(c) ?? 0) + d.remainingBalance);
    }
    return map;
  };
  const oweByCurrency = sumByCurrency(oweDebts);
  const owedByCurrency = sumByCurrency(owedDebts);
  const netByCurrency = new Map<string, number>(owedByCurrency);
  for (const [c, v] of oweByCurrency) netByCurrency.set(c, (netByCurrency.get(c) ?? 0) - v);
  const multiCurrency = new Set([...oweByCurrency.keys(), ...owedByCurrency.keys()]).size > 1;
  const moneyList = (map: Map<string, number>) =>
    map.size === 0 ? formatMoney(0) : Array.from(map, ([c, v]) => formatMoney(v, c)).join(' + ');
  const netEntries = Array.from(netByCurrency);
  const netAllNonNegative = netEntries.every(([, v]) => v >= 0);

  function renderDebtCard(debt: Debt) {
    const debtCurrency = debt.currency ?? 'ARS';
    const paid = debt.totalAmount - debt.remainingBalance;
    const isInstallment = debt.installmentCount != null && debt.paidInstallments != null;
    // En cuotas la barra avanza por cuotas pagadas (un pago parcial no la mueve hasta completar la cuota).
    const percentPaid = isInstallment
      ? Math.min(100, Math.round((debt.paidInstallments! / debt.installmentCount!) * 100))
      : debt.totalAmount > 0
        ? Math.min(100, Math.round((paid / debt.totalAmount) * 100))
        : 100;
    const color = avatarColor(debt.counterparty);
    const barModifier = debt.direction === 'I_OWE' ? 'owe' : 'owed';
    const badge = dueBadge(effectiveDueDate(debt));
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
              <div className="mf-debt-remaining">{formatMoney(debt.remainingBalance, debtCurrency)}</div>
              <div className="mf-debt-total">de {formatMoney(debt.totalAmount, debtCurrency)}</div>
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

        {!debt.settledAt && isInstallment && (
          <div className="muted mono" style={{ marginTop: 8, fontSize: 13 }}>
            Cuota {debt.paidInstallments}/{debt.installmentCount}
            {debt.nextInstallment && (
              <>
                {' '}
                · próxima {shortDate(debt.nextInstallment.dueDate)} ·{' '}
                {formatMoney(debt.nextInstallment.amount, debtCurrency)}
              </>
            )}
          </div>
        )}

        {debt.settledAt ? (
          <p className="muted mono" style={{ margin: '10px 0 0' }}>
            Saldada · {formatMoney(debt.totalAmount, debtCurrency)}
          </p>
        ) : (
          <div className="mf-progress" style={{ marginTop: 12 }}>
            <div className={`mf-progress-fill ${barModifier}`} style={{ width: `${percentPaid}%` }} />
          </div>
        )}

        {!debt.settledAt &&
          (payingId === debt.id ? (
            (() => {
              // El monto se ingresa en la moneda de la cuenta elegida; si difiere de la de la
              // deuda se muestra la conversión (TC + convertido) antes de confirmar.
              const payAccount = accounts.find((a) => a.id === payAccountId);
              const cross = payAccount !== undefined && payAccount.currency !== debtCurrency;
              const rateToDebt = cross ? crossRate(payAccount.currency, debtCurrency, rates) : 1;
              const rateMissing = cross && rateToDebt === null;
              const converted =
                cross && rateToDebt !== null && payAmount !== ''
                  ? Math.round(Number(payAmount) * rateToDebt * 100) / 100
                  : null;
              const maxAmount = !cross
                ? debt.remainingBalance
                : rateToDebt !== null
                  ? floor2(debt.remainingBalance / rateToDebt)
                  : undefined;
              return (
                <div style={{ marginTop: 10 }}>
                  <div className="form-row">
                    <label className="field">
                      {cross ? `Monto (${payAccount.currency})` : 'Monto'}
                      <input
                        type="number"
                        min="0.01"
                        max={maxAmount}
                        step="0.01"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        autoFocus
                      />
                    </label>
                    {accounts.length > 0 && (
                      <label className="field">
                        Cuenta
                        <select
                          value={payAccountId}
                          onChange={(e) => {
                            setPayAccountId(e.target.value);
                            // Cambiar de cuenta re-prellena el monto en su moneda.
                            setPayAmount(payPrefill(debt, accounts.find((a) => a.id === e.target.value)));
                          }}
                        >
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.icon ? `${a.icon} ` : ''}
                              {a.name} ({a.currency})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="field">
                      Fecha
                      <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                    </label>
                    <button disabled={payBusy || rateMissing} onClick={() => onConfirmPay(debt)}>
                      {payBusy ? 'Guardando…' : 'Confirmar'}
                    </button>
                    <button className="secondary" disabled={payBusy} onClick={onCancelPay}>
                      Cancelar
                    </button>
                  </div>
                  {rateMissing && (
                    <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 6 }}>
                      Falta cotización para convertir {payAccount.currency} a {debtCurrency}: cargala en
                      Inversiones para pagar desde esta cuenta.
                    </div>
                  )}
                  {cross && converted !== null && (
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                      ≈ {formatMoney(converted, debtCurrency)} se descuentan de la deuda ·{' '}
                      {rateLabel(payAccount.currency, debtCurrency, rates)}
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <button type="button" className="mf-debt-pay" onClick={() => onStartPay(debt)}>
              {isInstallment ? 'Pagar cuota' : 'Registrar pago'}
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
          <div className="mf-figure mf-figure--stat" style={{ fontSize: multiCurrency ? 22 : 32, color: 'var(--neg)' }}>
            {moneyList(oweByCurrency)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Me deben</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: multiCurrency ? 22 : 32, color: 'var(--pos)' }}>
            {moneyList(owedByCurrency)}
          </div>
        </div>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Balance neto</div>
            {/* Con varias monedas el neto se muestra por moneda, sin convertir. */}
            <div
              className="mf-figure mf-figure--stat"
              style={{ fontSize: multiCurrency ? 22 : 32, color: netAllNonNegative ? 'var(--pos)' : 'var(--neg)' }}
            >
              {netEntries.length === 0
                ? formatMoney(0)
                : netEntries
                    .map(([c, v]) => `${v < 0 ? '−' : ''}${formatMoney(Math.abs(v), c)}`)
                    .join(' · ')}
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
          <div className="form-row">
            <label className="field" style={{ flex: 2 }}>
              Monto total
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={totalAmount}
                onChange={(e) => {
                  setTotalAmount(e.target.value);
                  if (inInstallments) syncInstallmentAmount(e.target.value, installmentCount);
                }}
                required
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Moneda
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={currencyLocked}>
                {/* Si la deuda ya está en otra moneda (modelo free-string), se muestra igual. */}
                {!CURRENCY_OPTIONS.includes(currency) && <option value={currency}>{currency}</option>}
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {currencyLocked && (
            <p className="muted" style={{ margin: 0 }}>
              La moneda no se puede cambiar: la deuda ya tiene pagos registrados en {currency}.
            </p>
          )}
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
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={inInstallments}
              onChange={(e) => {
                setInInstallments(e.target.checked);
                if (e.target.checked) syncInstallmentAmount(totalAmount, installmentCount);
              }}
              style={{ width: 'auto' }}
            />
            En cuotas
          </label>
          {inInstallments && (
            <>
              <div className="form-row">
                <label className="field">
                  Cuotas
                  <input
                    type="number"
                    min="1"
                    max="360"
                    step="1"
                    value={installmentCount}
                    onChange={(e) => {
                      setInstallmentCount(e.target.value);
                      syncInstallmentAmount(totalAmount, e.target.value);
                    }}
                    required
                  />
                </label>
                <label className="field">
                  Monto por cuota
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={installmentAmount}
                    onChange={(e) => {
                      setInstallmentAmount(e.target.value);
                      setInstallmentAmountEdited(true);
                    }}
                  />
                </label>
                <label className="field">
                  Primer vencimiento
                  <input
                    type="date"
                    value={firstDueDate}
                    onChange={(e) => setFirstDueDate(e.target.value)}
                    required
                  />
                </label>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Las cuotas vencen todos los meses el mismo día (con ajuste a fin de mes) y la última
                ajusta la diferencia contra el total.
                {editingId &&
                  ' Editar estos campos regenera el cronograma: las cuotas pagadas se recalculan según los pagos ya registrados.'}
              </p>
            </>
          )}
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
                {formatMoney(historyDetail.totalAmount - historyDetail.remainingBalance, historyDetail.currency)} de{' '}
                {formatMoney(historyDetail.totalAmount, historyDetail.currency)} en {historyDetail.payments.length} pago
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
                  {/* Lo que impactó en la deuda, en su moneda: el convertido si el pago cruzó monedas. */}
                  <span className="mono" style={{ fontWeight: 600, marginLeft: 'auto' }}>
                    {formatMoney(p.entityAmount ?? p.amount, historyDetail.currency)}
                  </span>
                </div>
              ))}
            </div>
          ))}
      </Modal>
    </>
  );
}
