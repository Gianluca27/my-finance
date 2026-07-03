import type { Category, Paginated, Transaction, TransactionType } from '@myfinance/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoSearch, IcoTrash } from '../components/icons';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatRowDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

const TYPE_TABS: { value: '' | TransactionType; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'INCOME', label: 'Ingresos' },
  { value: 'EXPENSE', label: 'Gastos' },
];

export function TransactionsPage() {
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<'' | TransactionType>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Edición inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<TransactionType>('EXPENSE');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const listKey = `transactions:${JSON.stringify([page, filterType, filterCategory, search])}`;
  const { data, error: loadError, refresh } = useCached<Paginated<Transaction>>(listKey, () =>
    api.listTransactions({
      page,
      pageSize: PAGE_SIZE,
      type: filterType || undefined,
      categoryId: filterCategory || undefined,
      search: search || undefined,
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

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await api.deleteTransaction(id);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function onStartEdit(tx: Transaction) {
    setEditingId(tx.id);
    setEditType(tx.type);
    setEditAmount(String(tx.amount));
    setEditDate(tx.date.slice(0, 10));
    setEditCategoryId(tx.categoryId ?? '');
    setEditNote(tx.note ?? '');
    setError(null);
  }

  function onCancelEdit() {
    setEditingId(null);
  }

  async function onSaveEdit(id: string) {
    setError(null);
    setEditBusy(true);
    try {
      await api.updateTransaction(id, {
        type: editType,
        amount: Number(editAmount),
        date: editDate,
        note: editNote || null,
        categoryId: editCategoryId || null,
      });
      setEditingId(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setEditBusy(false);
    }
  }

  const editCategories = categories.filter((c) => c.type === editType);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="card mf-tx-card">
        <div className="mf-tx-toolbar">
          <div className="mf-seg mf-tx-typeseg">
            {TYPE_TABS.map((t) => (
              <button
                key={t.value || 'all'}
                type="button"
                className={filterType === t.value ? 'on neutral' : ''}
                onClick={() => {
                  setFilterType(t.value);
                  setPage(1);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className="mf-select"
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
          <label className="mf-tx-search">
            <IcoSearch />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por nota o monto…"
            />
          </label>
          <div className="mf-tx-count">{data ? `${data.total} movimientos` : ''}</div>
        </div>

        {!data ? (
          <p className="muted" style={{ padding: '0 20px 20px' }}>
            Cargando…
          </p>
        ) : data.items.length === 0 ? (
          <p className="muted" style={{ padding: '0 20px 20px' }}>
            No hay movimientos con esos filtros.
          </p>
        ) : (
          <table className="mf-tx-table">
            <colgroup>
              <col style={{ width: '10%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Detalle</th>
                <th>Categoría</th>
                <th className="num">Monto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((tx) =>
                editingId === tx.id ? (
                  <tr key={tx.id}>
                    <td>
                      <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    </td>
                    <td>
                      <input value={editNote} onChange={(e) => setEditNote(e.target.value)} maxLength={500} />
                    </td>
                    <td>
                      <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}>
                        <option value="">Sin categoría</option>
                        {editCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.icon ? `${c.icon} ` : ''}
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <select
                          value={editType}
                          onChange={(e) => {
                            const t = e.target.value as TransactionType;
                            setEditType(t);
                            setEditCategoryId('');
                          }}
                        >
                          <option value="EXPENSE">Gasto</option>
                          <option value="INCOME">Ingreso</option>
                        </select>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          required
                        />
                      </div>
                    </td>
                    <td className="num">
                      <div className="row-actions">
                        <button disabled={editBusy} onClick={() => onSaveEdit(tx.id)}>
                          {editBusy ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button className="secondary" disabled={editBusy} onClick={onCancelEdit}>
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={tx.id} className="mf-tx-row" onClick={() => onStartEdit(tx)}>
                    <td className="mf-tx-date">{formatRowDate(tx.date)}</td>
                    <td className="mf-tx-detail">{tx.note || '—'}</td>
                    <td>
                      <span className="cat-chip">
                        <span className="cat-dot" style={{ background: tx.category?.color ?? '#9ca3af' }} />
                        {tx.category?.name ?? 'Sin categoría'}
                      </span>
                    </td>
                    <td
                      className={`num mf-tx-amount ${tx.type === 'INCOME' ? 'income' : 'expense'}`}
                    >
                      {tx.type === 'INCOME' ? '+ ' : '− '}
                      {formatMoney(tx.amount)}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="mf-icon-btn"
                        aria-label="Eliminar movimiento"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(tx.id);
                        }}
                      >
                        <IcoTrash size={16} />
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}

        <div className="mf-tx-pagination">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="mf-tx-pagebtns">
            <button
              type="button"
              className="mf-pagebtn"
              disabled={page <= 1}
              aria-label="Página anterior"
              onClick={() => setPage(page - 1)}
            >
              ←
            </button>
            <button
              type="button"
              className="mf-pagebtn"
              disabled={page >= totalPages}
              aria-label="Página siguiente"
              onClick={() => setPage(page + 1)}
            >
              →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
