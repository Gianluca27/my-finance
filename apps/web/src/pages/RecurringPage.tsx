import type { Category, Frequency, RecurringExpense } from '@myfinance/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
};

export function RecurringPage() {
  const [items, setItems] = useState<RecurringExpense[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('1');
  const [dueMonth, setDueMonth] = useState('1');
  const [reminderDays, setReminderDays] = useState('3');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listRecurring().then(setItems).catch((err) => setError(err.message));
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
      await api.createRecurring({
        name,
        amount: Number(amount),
        frequency,
        dueDay: Number(dueDay),
        dueMonth: frequency === 'YEARLY' ? Number(dueMonth) : null,
        reminderDaysBefore: Number(reminderDays),
        categoryId: categoryId || null,
      });
      setName('');
      setAmount('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onPay(item: RecurringExpense) {
    if (!confirm(`¿Registrar el pago de "${item.name}" por ${formatMoney(item.amount)}?`)) return;
    try {
      await api.payRecurring(item.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onToggle(item: RecurringExpense) {
    try {
      await api.updateRecurring(item.id, { active: !item.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este gasto recurrente?')) return;
    try {
      await api.deleteRecurring(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function dueLabel(item: RecurringExpense): string {
    if (item.frequency === 'WEEKLY') return `los ${WEEKDAYS[item.dueDay] ?? '?'}`;
    if (item.frequency === 'YEARLY') return `el ${item.dueDay} de ${MONTHS[(item.dueMonth ?? 1) - 1]}`;
    return `el día ${item.dueDay}`;
  }

  return (
    <>
      <h1 className="page-title">Gastos fijos</h1>
      <p className="page-subtitle">
        Suscripciones, alquiler, expensas… con recordatorios antes del vencimiento
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
        <h3>Nuevo gasto fijo</h3>
        <div className="form-row">
          <label className="field" style={{ flex: 2 }}>
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="Ej: Netflix, Alquiler…"
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
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </form>

      <div className="card">
        {!items ? (
          <p className="muted">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="muted">Todavía no cargaste gastos fijos.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Frecuencia</th>
                <th>Próximo vencimiento</th>
                <th className="num">Monto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ opacity: item.active ? 1 : 0.5 }}>
                  <td>
                    {item.name}
                    {!item.active && <span className="muted"> (pausado)</span>}
                  </td>
                  <td>
                    <span className="cat-chip">
                      <span
                        className="cat-dot"
                        style={{ background: item.category?.color ?? '#9ca3af' }}
                      />
                      {item.category?.name ?? 'Sin categoría'}
                    </span>
                  </td>
                  <td>
                    {FREQUENCY_LABEL[item.frequency]} {dueLabel(item)}
                  </td>
                  <td className="mono">{formatDate(item.nextDueDate)}</td>
                  <td className="num amount-expense">{formatMoney(item.amount)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="secondary" onClick={() => onPay(item)}>
                        Registrar pago
                      </button>
                      <button className="secondary" onClick={() => onToggle(item)}>
                        {item.active ? 'Pausar' : 'Activar'}
                      </button>
                      <button className="danger" onClick={() => onDelete(item.id)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
