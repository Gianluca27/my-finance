import type { Account, AccountType, Transfer } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
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

export function AccountsPage() {
  const [error, setError] = useState<string | null>(null);

  const { data: accounts, error: loadError, refresh } = useCached<Account[]>('accounts', () => api.listAccounts());
  const { data: transfers, refresh: refreshTransfers } = useCached<Transfer[]>('transfers', () =>
    api.listTransfers(),
  );

  // Alta/edición de cuenta
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('BANK');
  const [initialBalance, setInitialBalance] = useState('0');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [icon, setIcon] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  // Transferencia
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  const list = accounts ?? [];
  const netWorth = list.reduce((sum, a) => sum + a.balance, 0);
  const transfersThisMonth = (transfers ?? []).filter((t) => isThisMonth(t.date)).length;

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
    setColor(COLOR_PALETTE[0]);
    setIcon('');
    setIsDefault(false);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(a: Account) {
    setEditingId(a.id);
    setName(a.name);
    setType(a.type);
    setInitialBalance(String(a.initialBalance));
    setColor(a.color);
    setIcon(a.icon ?? '');
    setIsDefault(a.isDefault);
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
        color,
        icon: icon || null,
        isDefault,
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

  function openTransfer() {
    if (list.length < 2) {
      setError('Necesitás al menos dos cuentas para transferir.');
      return;
    }
    const def = list.find((a) => a.isDefault) ?? list[0];
    setFromId(def.id);
    setToId(list.find((a) => a.id !== def.id)!.id);
    setTransferAmount('');
    setTransferNote('');
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
      await api.createTransfer({
        fromAccountId: fromId,
        toAccountId: toId,
        amount: Number(transferAmount),
        note: transferNote || null,
      });
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

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-hero-card mf-accounts-hero">
        <div className="mf-hero-glow" />
        <div className="mf-hero-body">
          <div className="mf-label">Patrimonio neto</div>
          <div className="mf-hero-balance" style={{ color: netWorth < 0 ? 'var(--neg)' : undefined }}>
            {formatMoney(netWorth)}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Suma del saldo de todas tus cuentas
          </div>
        </div>
        <div className="mf-accounts-hero-stats">
          <div>
            <div className="mf-statfig">{list.length}</div>
            <div className="mf-statcap">{list.length === 1 ? 'cuenta' : 'cuentas'}</div>
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
          {list.map((a) => (
            <div className="card mf-account-card" key={a.id}>
              <div className="mf-account-head">
                <div
                  className="mf-mark"
                  style={{ background: `${a.color}26`, borderColor: `${a.color}4d`, color: a.color }}
                >
                  {a.icon ?? shortCode(a.name)}
                </div>
                <div className="mf-account-titles">
                  <div className="mf-account-name">
                    {a.name}
                    {a.isDefault && <span className="mf-account-default"> · predet.</span>}
                  </div>
                  <div className="mf-caption">{TYPE_LABEL[a.type]}</div>
                </div>
                <button type="button" className="mf-icon-btn" aria-label="Editar cuenta" onClick={() => openEdit(a)}>
                  ✎
                </button>
                <button type="button" className="mf-icon-btn" aria-label="Eliminar cuenta" onClick={() => onDelete(a)}>
                  <IcoTrash size={15} />
                </button>
              </div>
              <div className="mf-figure" style={{ color: a.balance < 0 ? 'var(--neg)' : undefined }}>
                {formatMoney(a.balance)}
              </div>
              <div className="mf-account-foot">
                <span className="muted">
                  Saldo inicial <span className="mono">{formatMoney(a.initialBalance)}</span>
                </span>
                {!a.isDefault && (
                  <button type="button" className="mf-link-btn" onClick={() => onSetDefault(a)}>
                    Predeterminar
                  </button>
                )}
              </div>
            </div>
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
                  {formatMoney(t.amount)}
                </span>
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

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transferir entre cuentas">
        <form onSubmit={onSubmitTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Desde
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(a.balance)})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Hacia
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(a.balance)})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Monto
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
          <label className="field">
            Nota (opcional)
            <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} maxLength={500} />
          </label>
          <button disabled={transferBusy}>{transferBusy ? 'Guardando…' : 'Transferir'}</button>
        </form>
      </Modal>
    </>
  );
}
