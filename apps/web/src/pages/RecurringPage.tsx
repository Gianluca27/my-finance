import type { Account, Category, Frequency, RecurringExpense, Transaction, TransactionType } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPause, IcoPencil, IcoPlay, IcoPlus, IcoTrash, IcoTrend } from '../components/icons';
import { Modal } from '../components/Modal';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
};

function dueLabel(item: RecurringExpense): string {
  if (item.frequency === 'WEEKLY') return `los ${WEEKDAYS[item.dueDay] ?? '?'}`;
  if (item.frequency === 'YEARLY') return `${item.dueDay} de ${MONTHS_SHORT[(item.dueMonth ?? 1) - 1]}`;
  return `día ${item.dueDay}`;
}

function dueBadge(item: RecurringExpense): { text: string; urgent: boolean } {
  const daysLeft = Math.round((new Date(item.nextDueDate).getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return { text: 'Venció', urgent: true };
  if (daysLeft === 0) return { text: 'Hoy', urgent: true };
  const text = daysLeft === 1 ? 'En 1 día' : `En ${daysLeft} días`;
  return { text, urgent: daysLeft <= 3 };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function utcDateClamped(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))));
}

/**
 * Réplica liviana de `advanceDueDate` (apps/api/src/lib/dates.ts), solo para anticipar la
 * fecha en el confirm de "Saltar". El cálculo autoritativo (y el que se persiste) lo hace
 * siempre el servidor.
 */
function previewSkipDate(item: RecurringExpense): Date {
  const current = new Date(item.nextDueDate);
  const from = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1),
  );

  if (item.frequency === 'WEEKLY') {
    const diff = (item.dueDay - from.getUTCDay() + 7) % 7;
    const result = new Date(from);
    result.setUTCDate(from.getUTCDate() + diff);
    return result;
  }
  if (item.frequency === 'MONTHLY') {
    const thisMonth = utcDateClamped(from.getUTCFullYear(), from.getUTCMonth(), item.dueDay);
    if (thisMonth >= from) return thisMonth;
    return utcDateClamped(from.getUTCFullYear(), from.getUTCMonth() + 1, item.dueDay);
  }
  const monthIndex = (item.dueMonth ?? 1) - 1;
  const thisYear = utcDateClamped(from.getUTCFullYear(), monthIndex, item.dueDay);
  if (thisYear >= from) return thisYear;
  return utcDateClamped(from.getUTCFullYear() + 1, monthIndex, item.dueDay);
}

export function RecurringPage() {
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('1');
  const [dueMonth, setDueMonth] = useState('1');
  const [reminderDays, setReminderDays] = useState('3');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [payItem, setPayItem] = useState<RecurringExpense | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const [historyItem, setHistoryItem] = useState<RecurringExpense | null>(null);
  const [historyPayments, setHistoryPayments] = useState<Transaction[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { data: items, error: loadError, refresh } = useCached<RecurringExpense[]>('recurring', () =>
    api.listRecurring(),
  );
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const { data: accountsData } = useCached<Account[]>('accounts', () => api.listAccounts());
  const accounts = accountsData ?? [];
  // Las categorías del formulario siguen el tipo elegido (gasto fijo vs ingreso fijo).
  const categories = (categoriesData ?? []).filter((c) => c.type === type);

  const activeItems = (items ?? []).filter((i) => i.active);
  const totalExpense = activeItems.filter((i) => i.type === 'EXPENSE').reduce((sum, i) => sum + i.amount, 0);
  const totalIncome = activeItems.filter((i) => i.type === 'INCOME').reduce((sum, i) => sum + i.amount, 0);

  function openCreate() {
    setEditingId(null);
    setName('');
    setType('EXPENSE');
    setAmount('');
    setFrequency('MONTHLY');
    setDueDay('1');
    setDueMonth('1');
    setReminderDays('3');
    setCategoryId('');
    setError(null);
    setFormOpen(true);
  }

  function openEdit(item: RecurringExpense) {
    setEditingId(item.id);
    setName(item.name);
    setType(item.type);
    setAmount(String(item.amount));
    setFrequency(item.frequency);
    setDueDay(String(item.dueDay));
    setDueMonth(String(item.dueMonth ?? 1));
    setReminderDays(String(item.reminderDaysBefore));
    setCategoryId(item.categoryId ?? '');
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
        amount: Number(amount),
        frequency,
        dueDay: Number(dueDay),
        dueMonth: frequency === 'YEARLY' ? Number(dueMonth) : null,
        reminderDaysBefore: Number(reminderDays),
        categoryId: categoryId || null,
      };
      if (editingId) {
        await api.updateRecurring(editingId, payload);
      } else {
        await api.createRecurring(payload);
      }
      setFormOpen(false);
      invalidate('recurring');
      // El dashboard muestra próximos vencimientos y descuenta los fijos del safe-to-spend.
      invalidate('dashboard');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function invalidateAfterPayment() {
    // El pago crea una transacción: además del listado, cambian resumen, presupuestos y saldos.
    invalidate('recurring');
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    invalidate('accounts');
    refresh();
  }

  function onStartPay(item: RecurringExpense) {
    setPayItem(item);
    setPayAmount(String(item.amount));
    setPayAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
    setPayDate(new Date().toISOString().slice(0, 10));
    setError(null);
  }

  function onClosePay() {
    if (payBusy) return;
    setPayItem(null);
  }

  async function onConfirmPay(e: FormEvent) {
    e.preventDefault();
    if (!payItem) return;
    setError(null);
    setPayBusy(true);
    try {
      await api.payRecurring(payItem.id, {
        amount: Number(payAmount),
        accountId: payAccountId || undefined,
        date: payDate || undefined,
      });
      setPayItem(null);
      invalidateAfterPayment();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setPayBusy(false);
    }
  }

  async function onSkip(item: RecurringExpense) {
    const preview = formatDate(previewSkipDate(item).toISOString());
    if (!confirm(`Avanza el vencimiento al ${preview} sin registrar pago.`)) return;
    try {
      await api.skipRecurring(item.id);
      invalidate('recurring');
      invalidate('dashboard');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onOpenHistory(item: RecurringExpense) {
    setHistoryItem(item);
    setHistoryPayments(null);
    setHistoryLoading(true);
    setError(null);
    try {
      setHistoryPayments(await api.listRecurringPayments(item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setHistoryLoading(false);
    }
  }

  function onCloseHistory() {
    setHistoryItem(null);
    setHistoryPayments(null);
  }

  async function onToggle(item: RecurringExpense) {
    try {
      await api.updateRecurring(item.id, { active: !item.active });
      invalidate('recurring');
      invalidate('dashboard');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este gasto recurrente?')) return;
    try {
      await api.deleteRecurring(id);
      invalidate('recurring');
      invalidate('dashboard');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-2" style={{ marginBottom: 14 }}>
        <div className="card mf-recur-total-card">
          <div className="mf-label">Gastos fijos comprometidos</div>
          <div className="mf-figure mf-figure--stat" style={{ color: 'var(--neg)' }}>{formatMoney(totalExpense)}</div>
        </div>
        <div className="card mf-recur-total-card">
          <div className="mf-label">Ingresos fijos esperados</div>
          <div className="mf-figure mf-figure--stat" style={{ color: 'var(--pos)' }}>{formatMoney(totalIncome)}</div>
        </div>
      </div>

      <div className="card">
        {!items ? (
          <p className="muted">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="muted">Todavía no cargaste gastos fijos.</p>
        ) : (
          <div className="mf-recur-list">
            {items.map((item) => {
              const badge = dueBadge(item);
              const color = item.category?.color ?? '#9ca3af';
              const isIncome = item.type === 'INCOME';
              return (
                <div key={item.id} className="mf-recur-row" style={{ opacity: item.active ? 1 : 0.5 }}>
                  <div className="mf-recur-icon" style={{ background: `${color}26` }}>
                    {item.category?.icon ?? (isIncome ? '💵' : '💳')}
                  </div>
                  <div className="mf-recur-info">
                    <div className="mf-recur-name">
                      {item.name}
                      {!item.active && <span className="muted"> (pausado)</span>}
                    </div>
                    <div className="mf-recur-meta">
                      {item.category?.name ?? 'Sin categoría'} · {FREQUENCY_LABEL[item.frequency]} ·{' '}
                      {dueLabel(item)}
                    </div>
                  </div>
                  <span className={`mf-recur-badge ${badge.urgent ? 'urgent' : ''}`}>{badge.text}</span>
                  <div className="mf-recur-amount" style={{ color: isIncome ? 'var(--pos)' : undefined }}>
                    {isIncome ? '+' : ''}
                    {formatMoney(item.amount)}
                  </div>
                  <div className="mf-recur-actions">
                    <button className="mf-recur-pay" onClick={() => onStartPay(item)}>
                      {isIncome ? 'Cobrar' : 'Pagar'}
                    </button>
                    <button type="button" className="ghost" onClick={() => onSkip(item)}>
                      Saltar
                    </button>
                    <button
                      type="button"
                      className="mf-icon-btn"
                      aria-label="Ver historial de pagos"
                      onClick={() => onOpenHistory(item)}
                    >
                      <IcoTrend size={15} />
                    </button>
                    <button
                      type="button"
                      className="mf-icon-btn"
                      aria-label={item.active ? 'Pausar' : 'Activar'}
                      onClick={() => onToggle(item)}
                    >
                      {item.active ? <IcoPause size={15} /> : <IcoPlay size={15} />}
                    </button>
                    <button
                      type="button"
                      className="mf-icon-btn"
                      aria-label="Editar"
                      onClick={() => openEdit(item)}
                    >
                      <IcoPencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="mf-icon-btn"
                      aria-label="Eliminar"
                      onClick={() => onDelete(item.id)}
                    >
                      <IcoTrash size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="mf-recur-footnote">
        Al registrar el pago se crea un movimiento vinculado y el vencimiento avanza al próximo período; podés
        ajustar el monto, la cuenta y la fecha antes de confirmar. Si no corresponde este período usá "Saltar".
        Recibís un recordatorio por push y email según tus preferencias.
      </p>

      <div className="mf-dashed-tile mf-dashed-tile--row">
        <button type="button" className="mf-dashed-main" onClick={openCreate}>
          <span className="mf-dashed-mark" aria-hidden="true">
            <IcoPlus />
          </span>
          <span className="mf-dashed-title">Nuevo gasto fijo</span>
        </button>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Editar movimiento fijo' : 'Nuevo movimiento fijo'}
      >
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Tipo
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as TransactionType);
                setCategoryId('');
              }}
            >
              <option value="EXPENSE">Gasto fijo</option>
              <option value="INCOME">Ingreso fijo</option>
            </select>
          </label>
          <label className="field">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder={type === 'INCOME' ? 'Ej: Sueldo, Alquiler cobrado…' : 'Ej: Netflix, Alquiler…'}
              autoFocus
            />
          </label>
          <label className="field">
            Monto
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
            Frecuencia
            <select
              value={frequency}
              onChange={(e) => {
                const next = e.target.value as Frequency;
                // El dominio de dueDay cambia entre semanal (0-6) y mensual/anual (1-31):
                // al cruzar de dominio se vuelve al primer día válido para no mandar un
                // valor fuera de rango (el server lo rechazaría con 400).
                if ((next === 'WEEKLY') !== (frequency === 'WEEKLY')) {
                  setDueDay(next === 'WEEKLY' ? '0' : '1');
                }
                setFrequency(next);
              }}
            >
              <option value="MONTHLY">Mensual</option>
              <option value="WEEKLY">Semanal</option>
              <option value="YEARLY">Anual</option>
            </select>
          </label>
          {frequency === 'WEEKLY' ? (
            <label className="field">
              Día de la semana
              <select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              Día de vencimiento
              <input
                type="number"
                min="1"
                max="31"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                required
              />
            </label>
          )}
          {frequency === 'YEARLY' && (
            <label className="field">
              Mes
              <select value={dueMonth} onChange={(e) => setDueMonth(e.target.value)}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Recordar (días antes)
            <input
              type="number"
              min="0"
              max="30"
              value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
            />
          </label>
          <label className="field">
            Categoría
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Agregar'}</button>
        </form>
      </Modal>

      <Modal
        open={payItem !== null}
        onClose={onClosePay}
        title={payItem ? `${payItem.type === 'INCOME' ? 'Registrar cobro' : 'Registrar pago'}: ${payItem.name}` : ''}
      >
        {payItem && (
          <form onSubmit={onConfirmPay} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <label className="field">
              Monto
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
                required
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
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
            </label>
            <button disabled={payBusy}>
              {payBusy ? 'Guardando…' : payItem.type === 'INCOME' ? 'Confirmar cobro' : 'Confirmar pago'}
            </button>
          </form>
        )}
      </Modal>

      <Modal
        open={historyItem !== null}
        onClose={onCloseHistory}
        title={historyItem ? `Historial de pagos: ${historyItem.name}` : ''}
      >
        {historyItem &&
          (historyLoading ? (
            <p className="muted">Cargando…</p>
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : !historyPayments || historyPayments.length === 0 ? (
            <p className="muted">
              Todavía no hay pagos vinculados a este recurrente. El historial arranca a partir de esta
              actualización: los pagos registrados antes no quedaron asociados.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="mf-label" style={{ marginBottom: 6 }}>
                Promedio de los últimos {Math.min(6, historyPayments.length)}:{' '}
                {formatMoney(
                  historyPayments.slice(0, 6).reduce((sum, p) => sum + p.amount, 0) /
                    Math.min(6, historyPayments.length),
                )}
              </div>
              {historyPayments.map((p) => (
                <div className="mf-list-row" key={p.id}>
                  <span className="muted" style={{ flex: 1 }}>
                    {formatDate(p.date)}
                  </span>
                  <span className="mono" style={{ fontWeight: 600 }}>
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
