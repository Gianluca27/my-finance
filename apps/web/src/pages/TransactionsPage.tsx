import type { Account, AccountsOverview, Category, DashboardData, Paginated, Transaction, TransactionType } from '@myfinance/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { AddTransactionModal } from '../components/AddTransactionModal';
import { IcoClip, IcoCopy, IcoPencil, IcoSearch, IcoTrash } from '../components/icons';
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

/** Hoy en UTC a medianoche: mismo criterio que `currentMonthKey()` (lib/months.ts) para no
 *  desalinear los rangos rápidos con el "mes actual" del servidor cerca de la medianoche. */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRangeUTC(year: number, monthIndex: number): { from: string; to: string } {
  return {
    from: toDateParam(new Date(Date.UTC(year, monthIndex, 1))),
    to: toDateParam(new Date(Date.UTC(year, monthIndex + 1, 0))),
  };
}

type DateRange = { from: string; to: string } | null;

const DATE_CHIPS: { key: string; label: string; range: () => DateRange }[] = [
  {
    key: 'month',
    label: 'Este mes',
    range: () => {
      const t = todayUTC();
      return monthRangeUTC(t.getUTCFullYear(), t.getUTCMonth());
    },
  },
  {
    key: 'lastMonth',
    label: 'Mes pasado',
    range: () => {
      const t = todayUTC();
      return monthRangeUTC(t.getUTCFullYear(), t.getUTCMonth() - 1);
    },
  },
  {
    key: 'last30',
    label: 'Últimos 30 días',
    range: () => {
      const to = todayUTC();
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 29);
      return { from: toDateParam(from), to: toDateParam(to) };
    },
  },
  { key: 'all', label: 'Todo', range: () => null },
];

export function TransactionsPage() {
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Único filtro con estado local propio: la caja de búsqueda necesita un buffer
  // separado del valor comprometido en la URL para poder debouncear sin reescribirla
  // en cada tecla. El resto de los filtros se lee directo de la URL en cada render:
  // no hay estado duplicado que se pueda desincronizar.
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '');
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  const rawType = searchParams.get('type');
  const filterType: '' | TransactionType = rawType === 'INCOME' || rawType === 'EXPENSE' ? rawType : '';
  const filterCategory = searchParams.get('categoryId') ?? '';
  const filterAccount = searchParams.get('accountId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const rawPage = Number(searchParams.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const activeDateChip = DATE_CHIPS.find((c) => {
    const r = c.range();
    return r ? r.from === from && r.to === to : from === '' && to === '';
  })?.key;

  // `setFilter` puede ejecutarse desde el setTimeout del debounce con un closure de un
  // render viejo: si mergeara sobre el `searchParams` capturado, un filtro elegido durante
  // los 350 ms de espera (ej: categoría) se pisaría al comprometer la búsqueda. El ref se
  // reapunta en cada render, así el merge siempre parte de la URL vigente. (La forma
  // funcional de `setSearchParams` no sirve acá: en react-router 6 su `prev` es también
  // el snapshot del render que creó el callback.)
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  /**
   * Actualiza filtros en la URL — única fuente de verdad. Un valor '' / undefined borra
   * esa clave del query string. `replace: true` evita ensuciar el historial (se usa solo
   * al comprometer la búsqueda debounceada); el resto de los filtros pushea una entrada
   * nueva para que el botón "atrás" del navegador deshaga el último cambio.
   */
  function setFilter(patch: Record<string, string | undefined>, options?: { replace?: boolean }) {
    const current = searchParamsRef.current;
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Evita pushear una entrada de historial idéntica (ej: repetir clic en el chip ya activo).
    if (next.toString() === current.toString()) return;
    setSearchParams(next, { replace: options?.replace ?? false });
  }

  // Debounce de la búsqueda: recién comprometemos a la URL cuando el usuario deja de tipear.
  // Este efecto también corre al montar (deps [searchInput]): si no hiciera nada cuando el
  // texto ya coincide con el `q` de la URL, un mount con ?page=3 perdería la página al
  // reescribirse con page=undefined pese a no haber una búsqueda nueva.
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim();
      const urlQ = searchParamsRef.current.get('q') ?? '';
      if (trimmed === urlQ) {
        setSearch(trimmed);
        return;
      }
      setSearch(trimmed);
      setFilter({ q: trimmed || undefined, page: undefined }, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Si la URL cambia con la página ya montada (ej: la búsqueda de la topbar navegando a
  // /transacciones?q=... estando ya en esta ruta) resincroniza el buffer de búsqueda. El
  // guard evita pisar texto recién tipeado y todavía no comprometido cuando el cambio de
  // URL viene de otro filtro (categoría, cuenta, fecha...) y `q` en realidad no cambió.
  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    if (q === search) return;
    setSearchInput(q);
    setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Recibos adjuntos
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadForId = useRef<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; url: string } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);

  // Edición y duplicado vía modal (reutilizan el de "Nuevo movimiento")
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [duplicating, setDuplicating] = useState<Transaction | null>(null);

  // Selección múltiple: solo ids de la página visible (sin selección cross-página, ver spec).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recatOpen, setRecatOpen] = useState(false);
  const [recatCategoryId, setRecatCategoryId] = useState('');
  const [recatError, setRecatError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const listKey = `transactions:${JSON.stringify([page, filterType, filterCategory, filterAccount, from, to, search])}`;

  // Un cambio de página/filtro cambia qué ids son válidos: limpiar selección para no arrastrar
  // ids que ya no están a la vista.
  useEffect(() => {
    setSelected(new Set());
  }, [listKey]);
  const { data, error: loadError, refresh } = useCached<Paginated<Transaction>>(listKey, () =>
    api.listTransactions({
      page,
      pageSize: PAGE_SIZE,
      type: filterType || undefined,
      categoryId: filterCategory || undefined,
      accountId: filterAccount || undefined,
      from: from || undefined,
      to: to || undefined,
      search: search || undefined,
    }),
  );
  // Resumen del mes: comparte la caché del dashboard, sin fetch extra si ya se cargó.
  const { data: dash } = useCached<DashboardData>('dashboard', () => api.dashboard());
  const monthNet = dash ? dash.monthIncome - dash.monthExpense : 0;

  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = categoriesData ?? [];
  const { data: accountsData } = useCached<AccountsOverview>('accounts', () => api.listAccounts());
  const accounts = accountsData?.items ?? [];
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  // Cada movimiento está en la moneda de su cuenta (spec 19).
  const accountCurrency = (id: string) => accounts.find((a) => a.id === id)?.currency;

  // Selección múltiple (solo página visible)
  const pageIds = data?.items.map((tx) => tx.id) ?? [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedItems = (data?.items ?? []).filter((tx) => selected.has(tx.id));
  const selectedTypes = new Set(selectedItems.map((tx) => tx.type));
  // Si la selección mezcla ingresos y gastos no se puede filtrar por tipo: se muestran todas
  // las categorías (con su tipo aclarado) y el backend rechaza igual si no coincide.
  const homogeneousType: TransactionType | null = selectedTypes.size === 1 ? [...selectedTypes][0] : null;
  const recatCategories = homogeneousType ? categories.filter((c) => c.type === homogeneousType) : categories;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelected(allOnPageSelected ? new Set() : new Set(pageIds));
  }

  /** Un movimiento nuevo/borrado cambia listados, resumen, presupuestos y saldos. */
  function invalidateAfterMutation() {
    invalidate('transactions');
    invalidate('dashboard');
    invalidate('budgets');
    invalidate('accounts');
    // Recategorizar/borrar en lote también cambia el contador por categoría de CategoriesPage.
    invalidate('categories');
    refresh();
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await api.deleteTransaction(id);
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function onBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const plural = ids.length === 1 ? '' : 's';
    if (!confirm(`¿Eliminar ${ids.length} movimiento${plural} seleccionado${plural}? Esta acción no se puede deshacer.`)) {
      return;
    }
    setError(null);
    setBulkBusy(true);
    try {
      await api.bulkTransactions({ ids, action: 'delete' });
      setSelected(new Set());
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBulkBusy(false);
    }
  }

  function openRecategorize() {
    setRecatCategoryId('');
    setRecatError(null);
    setRecatOpen(true);
  }

  async function onConfirmRecategorize(e: FormEvent) {
    e.preventDefault();
    if (!recatCategoryId || selected.size === 0) return;
    setRecatError(null);
    setBulkBusy(true);
    try {
      await api.bulkTransactions({ ids: [...selected], action: 'setCategory', categoryId: recatCategoryId });
      setSelected(new Set());
      setRecatOpen(false);
      invalidateAfterMutation();
    } catch (err) {
      setRecatError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBulkBusy(false);
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

      <AddTransactionModal
        open={duplicating !== null}
        duplicateFrom={duplicating}
        onClose={() => {
          setDuplicating(null);
          refresh();
        }}
      />

      <Modal
        open={recatOpen}
        onClose={() => setRecatOpen(false)}
        title={`Recategorizar ${selected.size} movimiento${selected.size === 1 ? '' : 's'}`}
      >
        <form onSubmit={onConfirmRecategorize} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {recatError && <div className="error-banner">{recatError}</div>}
          <label className="field">
            Categoría
            <select
              value={recatCategoryId}
              onChange={(e) => setRecatCategoryId(e.target.value)}
              required
              autoFocus
            >
              <option value="">Elegir…</option>
              {recatCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                  {!homogeneousType ? ` (${c.type === 'INCOME' ? 'ingreso' : 'gasto'})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button disabled={bulkBusy || !recatCategoryId}>{bulkBusy ? 'Aplicando…' : 'Recategorizar'}</button>
        </form>
      </Modal>

      {dash && (
        <div className="mf-grid-3" style={{ marginBottom: 14 }}>
          {/* Totales consolidados a moneda base por la API; "≈" indica conversión (spec 19). */}
          <div className="card">
            <div className="mf-label">Ingresos del mes</div>
            <div className="mf-figure mf-figure--stat" style={{ color: 'var(--pos)' }}>
              {dash.currency?.converted && '≈ '}
              {formatMoney(dash.monthIncome, dash.currency?.baseCurrency)}
            </div>
          </div>
          <div className="card">
            <div className="mf-label">Gastos del mes</div>
            <div className="mf-figure mf-figure--stat" style={{ color: 'var(--neg)' }}>
              {dash.currency?.converted && '≈ '}
              {formatMoney(dash.monthExpense, dash.currency?.baseCurrency)}
            </div>
          </div>
          <div className="mf-hero-card">
            <div className="mf-label">Neto del mes</div>
            <div
              className="mf-figure mf-figure--stat"
              style={{ color: monthNet < 0 ? 'var(--neg)' : 'var(--text)' }}
            >
              {monthNet >= 0 ? '+ ' : '− '}
              {formatMoney(Math.abs(monthNet), dash.currency?.baseCurrency)}
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
                onClick={() => setFilter({ type: t.value || undefined, page: undefined })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className="mf-select"
            value={filterCategory}
            onChange={(e) => setFilter({ categoryId: e.target.value || undefined, page: undefined })}
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
              onChange={(e) => setFilter({ accountId: e.target.value || undefined, page: undefined })}
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

        <div className="mf-tx-toolbar">
          <div className="mf-seg mf-tx-typeseg">
            {DATE_CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={activeDateChip === c.key ? 'on neutral' : ''}
                onClick={() => {
                  const r = c.range();
                  setFilter({ from: r?.from, to: r?.to, page: undefined });
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="mf-tx-daterange">
            <input
              type="date"
              value={from}
              max={to || undefined}
              aria-label="Desde"
              title="Desde"
              onChange={(e) => setFilter({ from: e.target.value || undefined, page: undefined })}
            />
            <span className="muted">–</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              aria-label="Hasta"
              title="Hasta"
              onChange={(e) => setFilter({ to: e.target.value || undefined, page: undefined })}
            />
          </div>
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
              <col style={{ width: '4%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '29%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos los de esta página"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                  />
                </th>
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
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${tx.note || tx.category?.name || 'movimiento sin nota'} del ${formatRowDate(tx.date)} por ${formatMoney(tx.amount, accountCurrency(tx.accountId))}`}
                      checked={selected.has(tx.id)}
                      onChange={() => toggleOne(tx.id)}
                    />
                  </td>
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
                    {formatMoney(tx.amount, accountCurrency(tx.accountId))}
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
                        aria-label="Duplicar movimiento"
                        title="Duplicar movimiento"
                        onClick={() => setDuplicating(tx)}
                      >
                        <IcoCopy size={16} />
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
              onClick={() => setFilter({ page: page - 1 > 1 ? String(page - 1) : undefined })}
            >
              ←
            </button>
            <button
              type="button"
              className="mf-pagebtn"
              disabled={page >= totalPages}
              aria-label="Página siguiente"
              onClick={() => setFilter({ page: String(page + 1) })}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mf-bulkbar">
          <span className="mf-bulkbar-count">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <div className="mf-bulkbar-actions">
            <button type="button" className="secondary" disabled={bulkBusy} onClick={openRecategorize}>
              Recategorizar
            </button>
            <button type="button" className="danger" disabled={bulkBusy} onClick={onBulkDelete}>
              Eliminar
            </button>
          </div>
          <button
            type="button"
            className="mf-icon-btn"
            aria-label="Cancelar selección"
            title="Cancelar selección"
            onClick={() => setSelected(new Set())}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
