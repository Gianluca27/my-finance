import type { Category, Paginated, Transaction, TransactionType } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<'' | TransactionType>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Formulario de alta
  const [formType, setFormType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const listKey = `transactions:${JSON.stringify([page, filterType, filterCategory, filterFrom, filterTo])}`;
  const { data, error: loadError, refresh } = useCached<Paginated<Transaction>>(listKey, () =>
    api.listTransactions({
      page,
      pageSize: PAGE_SIZE,
      type: filterType || undefined,
      categoryId: filterCategory || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    }),
  );
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = categoriesData ?? [];

  /** Un movimiento nuevo/borrado cambia listados, resumen y presupuestos. */
  function invalidateAfterMutation() {
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    refresh();
  }

  const formCategories = categories.filter((c) => c.type === formType);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createTransaction({
        type: formType,
        amount: Number(amount),
        date,
        note: note || null,
        categoryId: categoryId || null,
      });
      setAmount('');
      setNote('');
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await api.deleteTransaction(id);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h1 className="page-title">Movimientos</h1>
      <p className="page-subtitle">Registrá tus ingresos y gastos</p>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
        <h3>Nuevo movimiento</h3>
        <div className="form-row">
          <label className="field">
            Tipo
            <select
              value={formType}
              onChange={(e) => {
                setFormType(e.target.value as TransactionType);
                setCategoryId('');
              }}
            >
              <option value="EXPENSE">Gasto</option>
              <option value="INCOME">Ingreso</option>
            </select>
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
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
            Nota
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar movimiento'}</button>
        </div>
      </form>

      <div className="card">
        <div className="toolbar">
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value as '' | TransactionType);
              setPage(1);
            }}
          >
            <option value="">Todos los tipos</option>
            <option value="INCOME">Ingresos</option>
            <option value="EXPENSE">Gastos</option>
          </select>
          <select
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => {
              setFilterFrom(e.target.value);
              setPage(1);
            }}
            title="Desde"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => {
              setFilterTo(e.target.value);
              setPage(1);
            }}
            title="Hasta"
          />
        </div>

        {!data ? (
          <p className="muted">Cargando…</p>
        ) : data.items.length === 0 ? (
          <p className="muted">No hay movimientos con esos filtros. Probá ampliar las fechas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Nota</th>
                <th className="num">Monto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((tx) => (
                <tr key={tx.id}>
                  <td className="mono">{formatDate(tx.date)}</td>
                  <td>
                    <span className="cat-chip">
                      <span
                        className="cat-dot"
                        style={{ background: tx.category?.color ?? '#9ca3af' }}
                      />
                      {tx.category?.name ?? 'Sin categoría'}
                    </span>
                  </td>
                  <td className="muted">{tx.note}</td>
                  <td className={`num ${tx.type === 'INCOME' ? 'amount-income' : 'amount-expense'}`}>
                    {tx.type === 'INCOME' ? '+' : '−'}
                    {formatMoney(tx.amount)}
                  </td>
                  <td className="num">
                    <button className="danger" onClick={() => onDelete(tx.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="pagination">
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            className="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente →
          </button>
        </div>
      </div>
    </>
  );
}
