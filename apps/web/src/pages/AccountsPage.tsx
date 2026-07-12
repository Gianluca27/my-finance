import type { Account, AccountsOverview, AccountType, Transfer } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

const TYPE_LABEL: Record<AccountType, string> = {
  CASH: 'Efectivo',
  BANK: 'Banco',
  CARD: 'Tarjeta',
  OTHER: 'Otra',
};
const TYPE_ICON: Record<AccountType, string> = { CASH: '💵', BANK: '🏦', CARD: '💳', OTHER: '👛' };
const COLOR_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];
/** Monedas first-class en la UI. El modelo acepta cualquier código (free-string). */
const CURRENCY_OPTIONS = ['ARS', 'USD'];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

/** Sigla de la cuenta para el avatar: "Banco Galicia" → BAN, "Mercado Pago" → MP. */
function shortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 3).toUpperCase();
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

/** Link al listado de movimientos filtrado por cuenta + rango de un ciclo (filtros de spec 05/11). */
function cycleLink(accountId: string, startIso: string, endIso: string): string {
  return `/transacciones?accountId=${accountId}&from=${startIso.slice(0, 10)}&to=${endIso.slice(0, 10)}`;
}

/** Bloque de ciclo de una cuenta CARD: consumido, disponible, cierre/vencimiento y último resumen. */
function CardCycleInfo({ account: a, onPayStatement }: { account: Account; onPayStatement: (a: Account) => void }) {
  const card = a.card;
  if (!card) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: 13 }}>
      <div className="muted">
        Consumido del ciclo{' '}
        <Link to={cycleLink(a.id, card.cycleStart, card.cycleClosing)} className="mono" style={{ fontWeight: 600 }}>
          {formatMoney(card.cycleSpent, a.currency)}
        </Link>
        {card.availableCredit !== null && (
          <>
            {' '}· disponible{' '}
            <span className="mono" style={{ fontWeight: 600, color: card.availableCredit < 0 ? 'var(--neg)' : undefined }}>
              {formatMoney(card.availableCredit, a.currency)}
            </span>
          </>
        )}
      </div>
      <div className="muted">
        Cierra el {formatDate(card.nextClosingDate)}
        {card.nextPaymentDate && <> · vence el {formatDate(card.nextPaymentDate)}</>}
      </div>
      <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>
          Resumen al {formatDate(card.lastCycle.closing)}:{' '}
          <Link to={cycleLink(a.id, card.lastCycle.start, card.lastCycle.closing)} className="mono" style={{ fontWeight: 600 }}>
            {formatMoney(card.lastCycle.total, a.currency)}
          </Link>
        </span>
        {card.lastCycle.total > 0 && !a.archivedAt && (
          <button type="button" className="mf-link-btn" onClick={() => onPayStatement(a)}>
            Pagar resumen
          </button>
        )}
      </div>
    </div>
  );
}

/** Card de una cuenta, reusada tanto en el listado activo como en la sección de archivadas. */
function AccountCard({
  account: a,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleArchive,
  onReconcile,
  onPayStatement,
}: {
  account: Account;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
  onSetDefault: (a: Account) => void;
  onToggleArchive: (a: Account) => void;
  onReconcile: (a: Account) => void;
  onPayStatement: (a: Account) => void;
}) {
  return (
    <div className="card mf-account-card">
      <div className="mf-account-head">
        <div className="mf-mark" style={{ background: `${a.color}26`, borderColor: `${a.color}4d`, color: a.color }}>
          {a.icon ?? shortCode(a.name)}
        </div>
        <div className="mf-account-titles">
          <div className="mf-account-name">
            {a.name}
            {a.isDefault && <span className="mf-account-default"> · predet.</span>}
          </div>
          <div className="mf-caption">
            {TYPE_LABEL[a.type]} · {a.currency}
            {a.archivedAt && ' · archivada'}
          </div>
        </div>
        <button type="button" className="mf-icon-btn" aria-label="Editar cuenta" onClick={() => onEdit(a)}>
          ✎
        </button>
        <button type="button" className="mf-icon-btn" aria-label="Eliminar cuenta" onClick={() => onDelete(a)}>
          <IcoTrash size={15} />
        </button>
      </div>
      <div className="mf-figure" style={{ color: a.balance < 0 ? 'var(--neg)' : undefined }}>
        {formatMoney(a.balance, a.currency)}
      </div>
      {a.type === 'CARD' && <CardCycleInfo account={a} onPayStatement={onPayStatement} />}
      <div className="mf-account-foot">
        <span className="muted">
          Saldo inicial <span className="mono">{formatMoney(a.initialBalance, a.currency)}</span>
        </span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="mf-link-btn" onClick={() => onReconcile(a)}>
            Ajustar saldo
          </button>
          {a.archivedAt ? (
            <button type="button" className="mf-link-btn" onClick={() => onToggleArchive(a)}>
              Desarchivar
            </button>
          ) : (
            !a.isDefault && (
              <>
                <button type="button" className="mf-link-btn" onClick={() => onToggleArchive(a)}>
                  Archivar
                </button>
                <button type="button" className="mf-link-btn" onClick={() => onSetDefault(a)}>
                  Predeterminar
                </button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountsPage() {
  const [error, setError] = useState<string | null>(null);

  const { data: accountsData, error: loadError, refresh } = useCached<AccountsOverview>('accounts', () =>
    api.listAccounts(),
  );
  const { data: transfers, refresh: refreshTransfers } = useCached<Transfer[]>('transfers', () =>
    api.listTransfers(),
  );
  // Un cache de sesión viejo puede traer la forma anterior (array plano): se descarta.
  const overview = accountsData && !Array.isArray(accountsData) ? accountsData : null;
  const accounts = overview?.items;

  // Alta/edición de cuenta
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('BANK');
  const [initialBalance, setInitialBalance] = useState('0');
  const [currency, setCurrency] = useState('ARS');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [icon, setIcon] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  // Campos de tarjeta (spec 20), solo visibles/enviados con tipo CARD.
  const [creditLimit, setCreditLimit] = useState('');
  const [closingDay, setClosingDay] = useState('');
  const [paymentDay, setPaymentDay] = useState('');
  const [busy, setBusy] = useState(false);

  // Transferencia (alta o edición, según transferEditId)
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEditId, setTransferEditId] = useState<string | null>(null);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  // Monto que entra en destino, solo cuando las monedas difieren (TC implícito).
  const [transferAmountTo, setTransferAmountTo] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transferNote, setTransferNote] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  // Archivadas (colapsadas)
  const [showArchived, setShowArchived] = useState(false);

  // Reconciliación de saldo
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null);
  const [reconcileValue, setReconcileValue] = useState('');
  const [reconcileDate, setReconcileDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const list = accounts ?? [];
  // Las archivadas siguen contando en el patrimonio neto (el dinero existió) pero se ocultan del
  // listado principal y de los selects de alta.
  const activeAccounts = list.filter((a) => !a.archivedAt);
  const archivedAccounts = list.filter((a) => a.archivedAt);
  // Patrimonio neto consolidado a moneda base por la API (con missingRates si falta cotización).
  const netWorth = overview?.netWorth ?? null;
  const transfersThisMonth = (transfers ?? []).filter((t) => isThisMonth(t.date)).length;
  // Moneda del formulario de cuenta: inmutable una vez que hay movimientos (regla de la API).
  const editingAccount = editingId ? list.find((a) => a.id === editingId) ?? null : null;
  const currencyLocked = editingAccount?.hasMovements ?? false;
  // Cuentas origen/destino elegidas en el formulario de transferencia.
  const transferFrom = list.find((a) => a.id === fromId) ?? null;
  const transferTo = list.find((a) => a.id === toId) ?? null;
  const crossCurrency =
    transferFrom !== null && transferTo !== null && transferFrom.currency !== transferTo.currency;
  // Al editar una transferencia vieja, la cuenta puede estar archivada: se incluye igual para que
  // no desaparezca del select ni cambie el valor por debajo.
  const transferAccountOptions = list.filter((a) => !a.archivedAt || a.id === fromId || a.id === toId);

  function invalidateAll() {
    invalidate('accounts');
    invalidate('transfers');
    invalidate('dashboard');
    invalidate('transactions');
    refresh();
    refreshTransfers();
  }

  function openCreate() {
    setEditingId(null);
    setName('');
    setType('BANK');
    setInitialBalance('0');
    setCurrency('ARS');
    setColor(COLOR_PALETTE[0]);
    setIcon('');
    setIsDefault(false);
    setCreditLimit('');
    setClosingDay('');
    setPaymentDay('');
    setError(null);
    setFormOpen(true);
  }

  function openEdit(a: Account) {
    setEditingId(a.id);
    setName(a.name);
    setType(a.type);
    setInitialBalance(String(a.initialBalance));
    setCurrency(a.currency);
    setColor(a.color);
    setIcon(a.icon ?? '');
    setIsDefault(a.isDefault);
    setCreditLimit(a.creditLimit != null ? String(a.creditLimit) : '');
    setClosingDay(a.closingDay != null ? String(a.closingDay) : '');
    setPaymentDay(a.paymentDay != null ? String(a.paymentDay) : '');
    setError(null);
    setFormOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name,
        type,
        initialBalance: Number(initialBalance) || 0,
        currency,
        color,
        icon: icon || null,
        isDefault,
        // Solo las tarjetas llevan límite/cierre/vencimiento; en el resto viajan null
        // (y la API limpia los previos si una CARD cambia de tipo).
        creditLimit: type === 'CARD' && creditLimit !== '' ? Number(creditLimit) : null,
        closingDay: type === 'CARD' && closingDay !== '' ? Number(closingDay) : null,
        // Sin día de cierre no hay vencimiento posible (regla de la API).
        paymentDay: type === 'CARD' && paymentDay !== '' && closingDay !== '' ? Number(paymentDay) : null,
      };
      if (editingId) await api.updateAccount(editingId, payload);
      else await api.createAccount(payload);
      setFormOpen(false);
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onSetDefault(a: Account) {
    setError(null);
    try {
      await api.updateAccount(a.id, { isDefault: true });
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onDelete(a: Account) {
    if (!confirm(`¿Eliminar la cuenta "${a.name}"?`)) return;
    setError(null);
    try {
      await api.deleteAccount(a.id);
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onToggleArchive(a: Account) {
    setError(null);
    try {
      await api.updateAccount(a.id, { archived: a.archivedAt === null });
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function openTransfer() {
    if (activeAccounts.length < 2) {
      setError('Necesitás al menos dos cuentas activas para transferir.');
      return;
    }
    setTransferEditId(null);
    const def = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];
    setFromId(def.id);
    setToId(activeAccounts.find((a) => a.id !== def.id)!.id);
    setTransferAmount('');
    setTransferAmountTo('');
    setTransferDate(new Date().toISOString().slice(0, 10));
    setTransferNote('');
    setError(null);
    setTransferOpen(true);
  }

  /**
   * "Pagar resumen" (spec 20): precarga la transferencia banco → tarjeta con el total del
   * último ciclo cerrado. Si la cuenta origen está en otra moneda, se precarga la punta de
   * la tarjeta (amountTo) y el usuario completa cuánto sale de la origen (TC implícito).
   */
  function openPayStatement(card: Account) {
    const total = card.card?.lastCycle.total ?? 0;
    const candidates = activeAccounts.filter((x) => x.id !== card.id && x.type !== 'CARD');
    const source = candidates.find((x) => x.isDefault) ?? candidates[0] ?? activeAccounts.find((x) => x.id !== card.id);
    if (!source) {
      setError('Necesitás otra cuenta activa desde la cual pagar el resumen.');
      return;
    }
    setTransferEditId(null);
    setFromId(source.id);
    setToId(card.id);
    if (source.currency === card.currency) {
      setTransferAmount(String(total));
      setTransferAmountTo(String(total));
    } else {
      setTransferAmount('');
      setTransferAmountTo(String(total));
    }
    setTransferDate(new Date().toISOString().slice(0, 10));
    setTransferNote(`Pago resumen ${card.name}`);
    setError(null);
    setTransferOpen(true);
  }

  function openEditTransfer(t: Transfer) {
    setTransferEditId(t.id);
    setFromId(t.fromAccountId);
    setToId(t.toAccountId);
    setTransferAmount(String(t.amount));
    setTransferAmountTo(String(t.amountTo ?? t.amount));
    setTransferDate(t.date.slice(0, 10));
    setTransferNote(t.note ?? '');
    setError(null);
    setTransferOpen(true);
  }

  async function onSubmitTransfer(e: FormEvent) {
    e.preventDefault();
    if (fromId === toId) {
      setError('Elegí cuentas distintas.');
      return;
    }
    setError(null);
    setTransferBusy(true);
    try {
      const payload = {
        fromAccountId: fromId,
        toAccountId: toId,
        amount: Number(transferAmount),
        // Entre monedas distintas viajan ambas puntas; con la misma moneda la API iguala.
        amountTo: crossCurrency ? Number(transferAmountTo) : undefined,
        date: transferDate,
        note: transferNote || null,
      };
      if (transferEditId) await api.updateTransfer(transferEditId, payload);
      else await api.createTransfer(payload);
      setTransferOpen(false);
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setTransferBusy(false);
    }
  }

  async function onDeleteTransfer(id: string) {
    if (!confirm('¿Eliminar esta transferencia? Los saldos de las cuentas se recalculan.')) return;
    try {
      await api.deleteTransfer(id);
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function openReconcile(a: Account) {
    setReconcileAccount(a);
    setReconcileValue(String(a.balance));
    setReconcileDate(new Date().toISOString().slice(0, 10));
    setError(null);
  }

  function closeReconcile() {
    if (reconcileBusy) return;
    setReconcileAccount(null);
  }

  async function onSubmitReconcile(e: FormEvent) {
    e.preventDefault();
    if (!reconcileAccount) return;
    setError(null);
    setReconcileBusy(true);
    try {
      await api.reconcileAccount(reconcileAccount.id, {
        actualBalance: Number(reconcileValue),
        date: reconcileDate,
      });
      setReconcileAccount(null);
      invalidateAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setReconcileBusy(false);
    }
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-hero-card mf-accounts-hero">
        <div className="mf-hero-glow" />
        <div className="mf-hero-body">
          <div className="mf-label">Patrimonio neto</div>
          <div
            className="mf-hero-balance"
            style={{ color: (netWorth?.total ?? 0) < 0 ? 'var(--neg)' : undefined }}
          >
            {netWorth?.converted && '≈ '}
            {formatMoney(netWorth?.total ?? 0, netWorth?.baseCurrency)}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Suma del saldo de todas tus cuentas
            {netWorth && netWorth.byCurrency.length > 1 && (
              <> · {netWorth.byCurrency.map((c) => formatMoney(c.amount, c.currency)).join(' + ')}</>
            )}
          </div>
          {netWorth && netWorth.missingRates.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>
              Falta cotización: {netWorth.missingRates.join(', ')} — esos saldos no entran al total
              (se carga en Inversiones).
            </div>
          )}
        </div>
        <div className="mf-accounts-hero-stats">
          <div>
            <div className="mf-statfig">{activeAccounts.length}</div>
            <div className="mf-statcap">{activeAccounts.length === 1 ? 'cuenta' : 'cuentas'}</div>
          </div>
          <div>
            <div className="mf-statfig">{transfersThisMonth}</div>
            <div className="mf-statcap">transfer · mes</div>
          </div>
        </div>
      </div>

      {!accounts ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="mf-grid-2">
          {activeAccounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onEdit={openEdit}
              onDelete={onDelete}
              onSetDefault={onSetDefault}
              onToggleArchive={onToggleArchive}
              onReconcile={openReconcile}
              onPayStatement={openPayStatement}
            />
          ))}

          <div className="mf-dashed-tile mf-dashed-tile--block">
            <button type="button" className="mf-dashed-main" onClick={openCreate}>
              <span className="mf-dashed-mark" aria-hidden="true">
                <IcoPlus />
              </span>
              <span className="mf-dashed-title">Nueva cuenta</span>
            </button>
            <button type="button" className="mf-dashed-sub" onClick={openTransfer}>
              o transferí entre cuentas existentes
            </button>
          </div>
        </div>
      )}

      {archivedAccounts.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <button type="button" className="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Ocultar' : 'Ver'} archivadas ({archivedAccounts.length})
          </button>
          {showArchived && (
            <div className="mf-grid-2" style={{ marginTop: 12 }}>
              {archivedAccounts.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  onEdit={openEdit}
                  onDelete={onDelete}
                  onSetDefault={onSetDefault}
                  onToggleArchive={onToggleArchive}
                  onReconcile={openReconcile}
                  onPayStatement={openPayStatement}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {transfers && transfers.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="mf-label mf-label--dot" style={{ marginBottom: 8 }}>
            Transferencias recientes
          </div>
          <div>
            {transfers.slice(0, 10).map((t) => (
              <div className="mf-list-row mf-transfer-row" key={t.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="mf-legend-dot" style={{ background: t.fromAccount.color }} />
                  {t.fromAccount.name}
                  <span className="muted"> → </span>
                  <span className="mf-legend-dot" style={{ background: t.toAccount.color }} />
                  {t.toAccount.name}
                  {t.note && <span className="muted"> · {t.note}</span>}
                  <span className="muted"> · {formatDate(t.date)}</span>
                </div>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {t.fromAccount.currency !== t.toAccount.currency
                    ? `${formatMoney(t.amount, t.fromAccount.currency)} → ${formatMoney(t.amountTo ?? t.amount, t.toAccount.currency)}`
                    : formatMoney(t.amount, t.fromAccount.currency)}
                </span>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Editar transferencia"
                  onClick={() => openEditTransfer(t)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Eliminar transferencia"
                  onClick={() => onDeleteTransfer(t.id)}
                >
                  <IcoTrash size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? 'Editar cuenta' : 'Nueva cuenta'}>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          </label>
          <label className="field">
            Tipo
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              <option value="CASH">Efectivo</option>
              <option value="BANK">Banco</option>
              <option value="CARD">Tarjeta</option>
              <option value="OTHER">Otra</option>
            </select>
          </label>
          <label className="field">
            Saldo inicial
            <input
              type="number"
              step="0.01"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
            />
          </label>
          <label className="field">
            Moneda
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={currencyLocked}>
              {/* Si la cuenta ya está en otra moneda (modelo free-string), se muestra igual. */}
              {!CURRENCY_OPTIONS.includes(currency) && <option value={currency}>{currency}</option>}
              <option value="ARS">ARS · Peso argentino</option>
              <option value="USD">USD · Dólar</option>
            </select>
            {currencyLocked && (
              <span className="muted" style={{ fontSize: 12 }}>
                La moneda no se puede cambiar: la cuenta ya tiene movimientos registrados en {currency}.
              </span>
            )}
          </label>
          {type === 'CARD' && (
            <>
              <label className="field">
                Límite de crédito (opcional)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="Ej: 500000"
                />
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label className="field" style={{ flex: 1 }}>
                  Día de cierre (opcional)
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    placeholder="1-31"
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Día de vencimiento
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)}
                    placeholder="1-31"
                    disabled={closingDay === ''}
                  />
                </label>
              </div>
              <span className="muted" style={{ fontSize: 12, marginTop: -8 }}>
                Con el día de cierre la app calcula el ciclo del resumen (se ajusta a fin de mes en meses
                cortos). Si el vencimiento es un día anterior o igual al cierre, cae al mes siguiente.
              </span>
            </>
          )}
          <label className="field">
            Emoji (opcional)
            <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder={TYPE_ICON[type]} />
          </label>
          <label className="field">
            Color
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '3px solid var(--text)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Usar como cuenta predeterminada
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : editingId ? 'Guardar' : 'Crear cuenta'}</button>
        </form>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title={transferEditId ? 'Editar transferencia' : 'Transferir entre cuentas'}
      >
        <form onSubmit={onSubmitTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Desde
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {transferAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(a.balance, a.currency)})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Hacia
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              {transferAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(a.balance, a.currency)})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {crossCurrency ? `Monto que sale (${transferFrom!.currency})` : 'Monto'}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              required
              autoFocus
            />
          </label>
          {/* Entre monedas distintas se piden ambas puntas: el TC implícito queda registrado. */}
          {crossCurrency && (
            <label className="field">
              Monto que entra ({transferTo!.currency})
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={transferAmountTo}
                onChange={(e) => setTransferAmountTo(e.target.value)}
                required
              />
              {Number(transferAmount) > 0 && Number(transferAmountTo) > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {Number(transferAmount) >= Number(transferAmountTo)
                    ? `TC implícito: 1 ${transferTo!.currency} ≈ ${formatMoney(Number(transferAmount) / Number(transferAmountTo), transferFrom!.currency)}`
                    : `TC implícito: 1 ${transferFrom!.currency} ≈ ${formatMoney(Number(transferAmountTo) / Number(transferAmount), transferTo!.currency)}`}
                </span>
              )}
            </label>
          )}
          <label className="field">
            Fecha
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} required />
          </label>
          <label className="field">
            Nota (opcional)
            <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} maxLength={500} />
          </label>
          <button disabled={transferBusy}>
            {transferBusy ? 'Guardando…' : transferEditId ? 'Guardar cambios' : 'Transferir'}
          </button>
        </form>
      </Modal>

      <Modal
        open={reconcileAccount !== null}
        onClose={closeReconcile}
        title={reconcileAccount ? `Ajustar saldo: ${reconcileAccount.name}` : ''}
      >
        {reconcileAccount && (
          <form onSubmit={onSubmitReconcile} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <p className="muted" style={{ margin: 0 }}>
              ¿Cuál es el saldo real de esta cuenta? El calculado hoy es{' '}
              <span className="mono">{formatMoney(reconcileAccount.balance, reconcileAccount.currency)}</span>.
            </p>
            <label className="field">
              Saldo real
              <input
                type="number"
                step="0.01"
                value={reconcileValue}
                onChange={(e) => setReconcileValue(e.target.value)}
                autoFocus
                required
              />
            </label>
            <label className="field">
              Fecha del ajuste
              <input type="date" value={reconcileDate} onChange={(e) => setReconcileDate(e.target.value)} required />
            </label>
            {(() => {
              const diff = Math.round((Number(reconcileValue || 0) - reconcileAccount.balance) * 100) / 100;
              if (diff === 0) {
                return <p className="muted" style={{ margin: 0 }}>No se registrará ningún ajuste.</p>;
              }
              return (
                <p className="muted" style={{ margin: 0 }}>
                  Se registrará un movimiento de{' '}
                  <strong style={{ color: diff > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {diff > 0 ? '+' : ''}
                    {formatMoney(diff, reconcileAccount.currency)}
                  </strong>{' '}
                  ({diff > 0 ? 'ingreso' : 'gasto'}) con la nota "Ajuste de saldo".
                </p>
              );
            })()}
            <button disabled={reconcileBusy}>{reconcileBusy ? 'Guardando…' : 'Confirmar'}</button>
          </form>
        )}
      </Modal>
    </>
  );
}
