import type { Account, Category, DashboardData, Paginated, Transaction, TransactionType } from '@myfinance/shared';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { AddTransactionModal } from '../components/AddTransactionModal';
import { IcoClip, IcoPencil, IcoSearch, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

/** Reescala la imagen (máx 1280px) y la devuelve como JPEG base64 para no superar ~1 MB. */
async function prepareImage(file: File): Promise<{ data: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.8),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mime: 'image/jpeg' };
}

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
  const [filterAccount, setFilterAccount] = useState('');
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

  // Recibos adjuntos
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadForId = useRef<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; url: string } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);

  // Edición vía modal (reutiliza el de "Nuevo movimiento")
  const [editing, setEditing] = useState<Transaction | null>(null);

  const listKey = `transactions:${JSON.stringify([page, filterType, filterCategory, filterAccount, search])}`;
  const { data, error: loadError, refresh } = useCached<Paginated<Transaction>>(listKey, () =>
    api.listTransactions({
      page,
      pageSize: PAGE_SIZE,
      type: filterType || undefined,
      categoryId: filterCategory || undefined,
      accountId: filterAccount || undefined,
      search: search || undefined,
    }),
  );
  // Resumen del mes: comparte la caché del dashboard, sin fetch extra si ya se cargó.
  const { data: dash } = useCached<DashboardData>('dashboard', () => api.dashboard());
  const monthNet = dash ? dash.monthIncome - dash.monthExpense : 0;

  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = categoriesData ?? [];
  const { data: accountsData } = useCached<Account[]>('accounts', () => api.listAccounts());
  const accounts = accountsData ?? [];
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  /** Un movimiento nuevo/borrado cambia listados, resumen, presupuestos y saldos. */
  function invalidateAfterMutation() {
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    invalidate('accounts');
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

  function onPickReceipt(id: string) {
    uploadForId.current = id;
    fileRef.current?.click();
  }

  async function onReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = uploadForId.current;
    e.target.value = '';
    if (!file || !id) return;
    setError(null);
    setUploadingId(id);
    try {
      const { data, mime } = await prepareImage(file);
      await api.uploadReceipt(id, data, mime);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setUploadingId(null);
    }
  }

  async function onViewReceipt(id: string) {
    setError(null);
    setViewBusy(true);
    try {
      const blob = await api.getReceipt(id);
      setViewing({ id, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setViewBusy(false);
    }
  }

  function closeViewer() {
    if (viewing) URL.revokeObjectURL(viewing.url);
    setViewing(null);
  }

  async function onDeleteReceipt(id: string) {
    if (!confirm('¿Eliminar el recibo adjunto?')) return;
    try {
      await api.deleteReceipt(id);
      closeViewer();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={onReceiptFile}
      />

      <Modal open={viewing !== null} onClose={closeViewer} title="Recibo adjunto">
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <img
              src={viewing.url}
              alt="Recibo"
              style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, objectFit: 'contain' }}
            />
            <button className="secondary" onClick={() => onDeleteReceipt(viewing.id)}>
              Eliminar recibo
            </button>
          </div>
        )}
      </Modal>

      <AddTransactionModal
        open={editing !== null}
        transaction={editing}
        onClose={() => {
          setEditing(null);
          refresh();
        }}
      />

      {dash && (
        <div className="mf-grid-3" style={{ marginBottom: 14 }}>
          <div className="card">
            <div className="mf-label">Ingresos del mes</div>
            <div className="mf-figure mf-figure--stat" style={{ color: 'var(--pos)' }}>
              {formatMoney(dash.monthIncome)}
            </div>
          </div>
          <div className="card">
            <div className="mf-label">Gastos del mes</div>
            <div className="mf-figure mf-figure--stat" style={{ color: 'var(--neg)' }}>
              {formatMoney(dash.monthExpense)}
            </div>
          </div>
          <div className="mf-hero-card">
            <div className="mf-label">Neto del mes</div>
            <div
              className="mf-figure mf-figure--stat"
              style={{ color: monthNet < 0 ? 'var(--neg)' : 'var(--text)' }}
            >
              {monthNet >= 0 ? '+ ' : '− '}
              {formatMoney(Math.abs(monthNet))}
            </div>
          </div>
        </div>
      )}

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
          {accounts.length > 0 && (
            <select
              className="mf-select"
              value={filterAccount}
              onChange={(e) => {
                setFilterAccount(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
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
              <col style={{ width: '32%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '14%' }} />
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
              {data.items.map((tx) => (
                <tr key={tx.id} className="mf-tx-row">
                  <td className="mf-tx-date">{formatRowDate(tx.date)}</td>
                  <td className="mf-tx-detail">
                    {tx.note || '—'}
                    {accounts.length > 1 && accountName(tx.accountId) && (
                      <div className="muted" style={{ fontSize: 11.5 }}>{accountName(tx.accountId)}</div>
                    )}
                  </td>
                  <td>
                    <span className="cat-chip">
                      <span className="cat-dot" style={{ background: tx.category?.color ?? '#9ca3af' }} />
                      {tx.category?.name ?? 'Sin categoría'}
                    </span>
                  </td>
                  <td className={`num mf-tx-amount ${tx.type === 'INCOME' ? 'income' : 'expense'}`}>
                    {tx.type === 'INCOME' ? '+ ' : '− '}
                    {formatMoney(tx.amount)}
                  </td>
                  <td className="num">
                    <div className="row-actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="mf-icon-btn"
                        disabled={uploadingId === tx.id || viewBusy}
                        aria-label={tx.receiptMime ? 'Ver recibo' : 'Adjuntar recibo'}
                        title={tx.receiptMime ? 'Ver recibo' : 'Adjuntar recibo'}
                        style={tx.receiptMime ? { color: 'var(--accent)' } : undefined}
                        onClick={() => {
                          if (uploadingId === tx.id) return;
                          tx.receiptMime ? onViewReceipt(tx.id) : onPickReceipt(tx.id);
                        }}
                      >
                        <IcoClip size={16} />
                      </button>
                      <button
                        type="button"
                        className="mf-icon-btn"
                        aria-label="Editar movimiento"
                        title="Editar movimiento"
                        onClick={() => setEditing(tx)}
                      >
                        <IcoPencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="mf-icon-btn"
                        aria-label="Eliminar movimiento"
                        title="Eliminar movimiento"
                        onClick={() => onDelete(tx.id)}
                      >
                        <IcoTrash size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mf-tx-pagination">
          <span className="mono">
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
