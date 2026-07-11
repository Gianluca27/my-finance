import type { Category, Frequency, RecurringExpense, TransactionType } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPause, IcoPencil, IcoPlay, IcoPlus, IcoTrash } from '../components/icons';
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

  const { data: items, error: loadError, refresh } = useCached<RecurringExpense[]>('recurring', () =>
    api.listRecurring(),
  );
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
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

  async function onPay(item: RecurringExpense) {
    const verb = item.type === 'INCOME' ? 'el cobro' : 'el pago';
    if (!confirm(`¿Registrar ${verb} de "${item.name}" por ${formatMoney(item.amount)}?`)) return;
    try {
      await api.payRecurring(item.id);
      // El pago crea una transacción: además del listado, cambian resumen, presupuestos y saldos.
      invalidate('recurring');
      invalidate('transactions');
      invalidate('dashboard');
      invalidate('budgets');
      invalidate('accounts');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
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
                    <button className="mf-recur-pay" onClick={() => onPay(item)}>
                      {isIncome ? 'Cobrar' : 'Pagar'}
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
        Al registrar el pago se crea un movimiento y el próximo vencimiento avanza al mes siguiente. Recibís un
        recordatorio por push y email según tus preferencias.
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
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
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
    </>
  );
}
