import type {
  Account, AccountsOverview,
  Investment,
  InvestmentDetail,
  InvestmentOperation,
  InvestmentsOverview,
  InvestmentType,
  PortfolioHistory,
  ProviderAvailability,
  ProviderMarket,
  ProviderSource,
  SymbolSearchKind,
  SymbolSearchResult,
} from '@myfinance/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, formatDate, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPencil, IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

const COLOR_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];

const TYPE_LABELS: Record<InvestmentType, string> = {
  ACCION: 'Acción',
  ETF: 'ETF',
  CEDEAR: 'CEDEAR',
  CRIPTO: 'Cripto',
  FCI: 'FCI',
  PLAZO_FIJO: 'Plazo fijo',
  BONO: 'Bono',
  OTRO: 'Otro',
};

const TYPE_FALLBACK_ICON: Record<InvestmentType, string> = {
  ACCION: '📈',
  ETF: '📊',
  CEDEAR: '🌎',
  CRIPTO: '🪙',
  FCI: '🧺',
  PLAZO_FIJO: '🏦',
  BONO: '📜',
  OTRO: '💼',
};

const SOURCE_LABELS: Record<ProviderSource, string> = {
  TWELVE_DATA: 'Twelve Data',
  DATA912: 'data912',
};

const MARKET_LABELS: Record<ProviderMarket, string> = {
  stocks: 'Acciones BYMA',
  cedears: 'CEDEARs',
  bonds: 'Bonos',
  notes: 'Letras',
  corp: 'ONs',
};

const SEARCH_PLACEHOLDERS: Record<SymbolSearchKind, string> = {
  ACCION: 'Ej: AAPL, Apple, GGAL…',
  ETF: 'Ej: SPY, QQQ…',
  CRIPTO: 'Ej: BTC, Ethereum…',
  CEDEAR: 'Ej: AAPL, NVDA, MELI…',
  BONO: 'Ej: AL30, GD30D, TX26…',
};

/** Tipos de activo con buscador de símbolos. El resto se carga a mano. */
function searchKind(type: InvestmentType): SymbolSearchKind | null {
  switch (type) {
    case 'ACCION':
    case 'ETF':
    case 'CRIPTO':
    case 'CEDEAR':
    case 'BONO':
      return type;
    default:
      return null;
  }
}

/** Qué proveedor cubre cada tipo: las acciones consultan los dos (NASDAQ y BYMA). */
function kindEnabled(kind: SymbolSearchKind, providers: ProviderAvailability): boolean {
  switch (kind) {
    case 'ACCION':
      return providers.twelveData || providers.data912;
    case 'ETF':
    case 'CRIPTO':
      return providers.twelveData;
    case 'CEDEAR':
    case 'BONO':
      return providers.data912;
  }
}

const NO_PROVIDERS: ProviderAvailability = { twelveData: false, data912: false };

/** Cotizaciones que mantiene el cron y no se editan a mano. */
function autoRateLabel(currency: string, providers: ProviderAvailability): string | null {
  if (providers.twelveData && currency === 'USD') return 'OFICIAL · auto';
  if (providers.data912 && currency === 'USDMEP') return 'MEP · auto';
  if (providers.data912 && currency === 'USDCCL') return 'CCL · auto';
  return null;
}

const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;

/** Cantidades con hasta 8 decimales (cripto fraccional). */
function formatQty(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 8 });
}

/** Monto en la moneda del activo; sin moneda usa el formato base de la app. */
function formatAsset(value: number, currency: string | null): string {
  if (!currency) return formatMoney(value);
  return `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${currency}`;
}

/** Total del donut: abreviado para que entre dentro del anillo. */
function formatMoneyShort(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`;
  if (v >= 1000) return `$ ${Math.round(v / 1000)}k`;
  return `$ ${Math.round(v)}`;
}

/** Precios unitarios: más decimales cuando el precio es chico (cripto, FCI). */
function formatPrice(value: number, currency: string | null): string {
  const digits = value > 0 && value < 1 ? 8 : 2;
  const num = value.toLocaleString('es-AR', { maximumFractionDigits: digits });
  return currency ? `${num} ${currency}` : `$ ${num}`;
}

function pnlColor(pnl: number): string {
  if (pnl > 0) return 'var(--pos)';
  if (pnl < 0) return 'var(--neg)';
  return 'var(--text)';
}

/** "hace X" a partir de un timestamp (ms), para el estado del refresh de precios. */
function formatAgo(fromMs: number): string {
  const min = Math.floor((Date.now() - fromMs) / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** TIR formateada con signo, o "—" si no hay dato (poco historial / no converge). */
function formatTir(tir: number | null | undefined): string {
  if (tir === null || tir === undefined) return '—';
  return `${tir >= 0 ? '+' : ''}${tir}%`;
}

/** Compra o venta (la RENTA se registra con su propio formulario). */
type TradeType = 'COMPRA' | 'VENTA';

/** Etiqueta contextual de la renta según el tipo de activo. */
function rentaLabel(type: InvestmentType): string {
  if (type === 'BONO') return 'Cupón';
  if (type === 'ACCION' || type === 'CEDEAR' || type === 'ETF') return 'Dividendo';
  return 'Renta';
}

type HistoryRange = 3 | 6 | 12;
const HISTORY_RANGES: HistoryRange[] = [3, 6, 12];

interface AssetFormState {
  id: string | null;
  name: string;
  type: InvestmentType;
  symbol: string;
  currency: string;
  icon: string;
  color: string;
  /** Símbolo vinculado (precio automático), o null = manual. */
  providerSymbol: string | null;
  providerSource: ProviderSource | null;
  providerMarket: ProviderMarket | null;
  providerExchange: string | null;
  /** 100 en renta fija (cotiza cada 100 nominales), 1 en el resto. */
  priceFactor: number;
}

const EMPTY_ASSET_FORM: AssetFormState = {
  id: null,
  name: '',
  type: 'ACCION',
  symbol: '',
  currency: '',
  icon: '',
  color: COLOR_PALETTE[0],
  providerSymbol: null,
  providerSource: null,
  providerMarket: null,
  providerExchange: null,
  priceFactor: 1,
};

export function InvestmentsPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [assetForm, setAssetForm] = useState<AssetFormState | null>(null);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResults, setSymbolResults] = useState<SymbolSearchResult[]>([]);
  const [symbolSearching, setSymbolSearching] = useState(false);

  const [opTarget, setOpTarget] = useState<Investment | null>(null);
  // id de la operación cuando se está editando una compra/venta; null = alta.
  const [opEditId, setOpEditId] = useState<string | null>(null);
  const [opType, setOpType] = useState<TradeType>('COMPRA');
  const [opQuantity, setOpQuantity] = useState('');
  const [opPrice, setOpPrice] = useState('');
  const [opDate, setOpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opNote, setOpNote] = useState('');
  const [opPriceHint, setOpPriceHint] = useState<string | null>(null);
  const [opPriceLoading, setOpPriceLoading] = useState(false);
  // Último precio autocompletado: si el usuario lo pisó a mano, no lo volvemos a tocar.
  const opPriceAutoRef = useRef<string | null>(null);

  // Formulario de renta (dividendo/cupón/amortización). rentaOpId = edición; null = alta.
  const [rentaTarget, setRentaTarget] = useState<Investment | null>(null);
  const [rentaOpId, setRentaOpId] = useState<string | null>(null);
  const [rentaAmount, setRentaAmount] = useState('');
  const [rentaDate, setRentaDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rentaNote, setRentaNote] = useState('');
  const [rentaCredit, setRentaCredit] = useState(false);
  const [rentaAccountId, setRentaAccountId] = useState('');

  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');

  const [detail, setDetail] = useState<InvestmentDetail | null>(null);

  const [rateCurrency, setRateCurrency] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [rateEdit, setRateEdit] = useState<{ currency: string; value: string } | null>(null);

  const [historyMonths, setHistoryMonths] = useState<HistoryRange>(12);
  const [history, setHistory] = useState<PortfolioHistory | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error: loadError, refresh } = useCached<InvestmentsOverview>('investments', () =>
    api.listInvestments(),
  );
  const providers = data?.providers ?? NO_PROVIDERS;
  // Cuentas para el checkbox "acreditar en cuenta" de la renta.
  const { data: accountsData } = useCached<AccountsOverview>('accounts', () => api.listAccounts());
  const accounts = useMemo(() => (accountsData?.items ?? []).filter((a) => a.archivedAt === null), [accountsData]);

  // Curva del portafolio: se recarga al cambiar el rango y tras cada mutación/refresh.
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.getPortfolioHistory(historyMonths));
    } catch {
      setHistory(null);
    }
  }, [historyMonths]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Buscador de símbolos con debounce (ningún proveedor cobra créditos por buscar).
  const formSearchKind = assetForm ? searchKind(assetForm.type) : null;
  const searchAvailable = formSearchKind !== null && kindEnabled(formSearchKind, providers);
  useEffect(() => {
    const q = symbolQuery.trim();
    if (!searchAvailable || !formSearchKind || q.length < 2) {
      setSymbolResults([]);
      setSymbolSearching(false);
      return;
    }
    setSymbolSearching(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await api.searchInvestmentSymbols(formSearchKind, q);
        if (!cancelled) setSymbolResults(res.items);
      } catch {
        if (!cancelled) setSymbolResults([]);
      } finally {
        if (!cancelled) setSymbolSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [symbolQuery, formSearchKind, searchAvailable]);

  // Autocompleta el precio de la operación al elegir una fecha pasada, sin pisar
  // un precio que el usuario ya haya tipeado a mano.
  useEffect(() => {
    if (!opTarget) return;
    // Editando una operación existente: no autocompletar (pisaría el precio real cargado).
    if (opEditId) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    if (opDate === todayStr) {
      setOpPriceLoading(false);
      setOpPriceHint(null);
      const auto = opTarget.currentPrice !== null ? String(opTarget.currentPrice) : null;
      if (auto !== null && (opPrice === '' || opPrice === opPriceAutoRef.current)) {
        setOpPrice(auto);
      }
      opPriceAutoRef.current = auto;
      return;
    }
    let cancelled = false;
    setOpPriceLoading(true);
    setOpPriceHint(null);
    const handle = setTimeout(async () => {
      try {
        const res = await api.getInvestmentPriceAtDate(opTarget.id, opDate);
        if (cancelled) return;
        if (res.price !== null && res.date !== null) {
          if (opPrice === '' || opPrice === opPriceAutoRef.current) {
            setOpPrice(String(res.price));
          }
          opPriceAutoRef.current = String(res.price);
          setOpPriceHint(
            `${res.exact ? 'Cierre' : 'Cierre más cercano'} · ${formatDate(res.date)}: ${formatAsset(res.price, opTarget.currency)}`,
          );
        } else {
          opPriceAutoRef.current = null;
          setOpPriceHint('Sin dato histórico para esta fecha: ingresá el precio manualmente.');
        }
      } catch {
        if (!cancelled) setOpPriceHint(null);
      } finally {
        if (!cancelled) setOpPriceLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // Sólo re-dispara por cambio de fecha/activo: opPrice se lee al momento del pedido, no gatilla el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opDate, opTarget]);

  function openAssetForm(form: AssetFormState) {
    setSymbolQuery('');
    setSymbolResults([]);
    setError(null);
    setAssetForm(form);
  }

  function onPickSymbol(result: SymbolSearchResult) {
    if (!assetForm) return;
    setAssetForm({
      ...assetForm,
      name: assetForm.name.trim() ? assetForm.name : result.name,
      symbol: result.symbol.split('/')[0],
      currency: result.currency,
      providerSymbol: result.symbol,
      providerSource: result.source,
      providerMarket: result.market,
      providerExchange: result.exchange,
      priceFactor: result.priceFactor,
    });
    setSymbolQuery('');
    setSymbolResults([]);
  }

  function onUnlinkSymbol() {
    if (!assetForm) return;
    setAssetForm({
      ...assetForm,
      providerSymbol: null,
      providerSource: null,
      providerMarket: null,
      providerExchange: null,
    });
  }

  function invalidateAfterMutation() {
    invalidate('investments');
    invalidate('dashboard');
    refresh();
    loadHistory();
  }

  async function onRefreshPrices() {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshInvestmentPrices();
      invalidateAfterMutation();
    } catch (err) {
      // Incluye el 429 con el tiempo de espera: el mensaje del server ya es user-facing.
      setError(err instanceof Error ? err.message : 'No se pudieron actualizar los precios.');
    } finally {
      setRefreshing(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  // --- Activos ---

  function onSubmitAsset(e: FormEvent) {
    e.preventDefault();
    if (!assetForm) return;
    const input = {
      name: assetForm.name,
      type: assetForm.type,
      symbol: assetForm.symbol || null,
      currency: assetForm.currency || null,
      icon: assetForm.icon || null,
      color: assetForm.color,
      providerSymbol: assetForm.providerSymbol,
      providerSource: assetForm.providerSource,
      providerMarket: assetForm.providerMarket,
      providerExchange: assetForm.providerExchange,
      // En los vinculados lo recalcula el servidor según el mercado.
      priceFactor: assetForm.priceFactor,
    };
    run(async () => {
      if (assetForm.id) await api.updateInvestment(assetForm.id, input);
      else await api.createInvestment(input);
      setAssetForm(null);
    });
  }

  function onEditAsset(inv: Investment) {
    openAssetForm({
      id: inv.id,
      name: inv.name,
      type: inv.type,
      symbol: inv.symbol ?? '',
      currency: inv.currency ?? '',
      icon: inv.icon ?? '',
      color: inv.color,
      providerSymbol: inv.providerSymbol,
      providerSource: inv.providerSource,
      providerMarket: inv.providerMarket,
      providerExchange: inv.providerExchange,
      priceFactor: inv.priceFactor,
    });
  }

  function onToggleArchive(inv: Investment) {
    run(async () => {
      await api.updateInvestment(inv.id, { archived: inv.archivedAt === null });
    });
  }

  function onDeleteAsset(inv: Investment) {
    if (!confirm(`¿Eliminar "${inv.name}"?`)) return;
    run(async () => {
      await api.deleteInvestment(inv.id);
    });
  }

  // --- Operaciones ---

  function onOpenOperation(inv: Investment, type: TradeType) {
    setOpEditId(null);
    setOpTarget(inv);
    setOpType(type);
    setOpQuantity('');
    const auto = inv.currentPrice !== null ? String(inv.currentPrice) : null;
    setOpPrice(auto ?? '');
    opPriceAutoRef.current = auto;
    setOpPriceHint(null);
    setOpDate(new Date().toISOString().slice(0, 10));
    setOpNote('');
    setError(null);
  }

  function closeOpModal() {
    setOpTarget(null);
    setOpEditId(null);
  }

  function onSubmitOperation(e: FormEvent) {
    e.preventDefault();
    if (!opTarget) return;
    const target = opTarget;
    const editId = opEditId;
    run(async () => {
      const input = {
        type: opType,
        quantity: Number(opQuantity),
        unitPrice: Number(opPrice),
        date: opDate,
        note: opNote || null,
      } as const;
      const result = editId
        ? await api.updateInvestmentOperation(target.id, editId, input)
        : await api.addInvestmentOperation(target.id, input);
      // Editando desde el historial: refresca el detalle abierto con la secuencia recalculada.
      if (detail && detail.id === target.id) setDetail(result);
      closeOpModal();
    });
  }

  // --- Renta (dividendo/cupón/amortización) ---

  function onOpenRenta(inv: Investment) {
    setRentaOpId(null);
    setRentaTarget(inv);
    setRentaAmount('');
    setRentaDate(new Date().toISOString().slice(0, 10));
    setRentaNote('');
    setRentaCredit(false);
    setRentaAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
    setError(null);
  }

  function closeRentaModal() {
    setRentaTarget(null);
    setRentaOpId(null);
  }

  function onSubmitRenta(e: FormEvent) {
    e.preventDefault();
    if (!rentaTarget) return;
    const target = rentaTarget;
    const editId = rentaOpId;
    run(async () => {
      const base = {
        type: 'RENTA' as const,
        amount: Number(rentaAmount),
        date: rentaDate,
        note: rentaNote || null,
      };
      // El "acreditar en cuenta" sólo aplica al alta (no hay vínculo persistido para editarlo).
      const result = editId
        ? await api.updateInvestmentOperation(target.id, editId, base)
        : await api.addInvestmentOperation(target.id, {
            ...base,
            credit: rentaCredit,
            accountId: rentaCredit ? rentaAccountId || null : undefined,
          });
      if (detail && detail.id === target.id) setDetail(result);
      closeRentaModal();
    });
  }

  /** Lápiz del historial: abre el formulario correcto (compra/venta o renta) precargado. */
  function onEditOperation(op: InvestmentOperation) {
    if (!detail) return;
    setError(null);
    if (op.type === 'RENTA') {
      setRentaOpId(op.id);
      setRentaTarget(detail);
      setRentaAmount(String(op.unitPrice));
      setRentaDate(op.date.slice(0, 10));
      setRentaNote(op.note ?? '');
      setRentaCredit(false);
      return;
    }
    setOpEditId(op.id);
    setOpTarget(detail);
    setOpType(op.type);
    setOpQuantity(String(op.quantity));
    setOpPrice(String(op.unitPrice));
    opPriceAutoRef.current = String(op.unitPrice);
    setOpPriceHint(null);
    setOpDate(op.date.slice(0, 10));
    setOpNote(op.note ?? '');
  }

  async function onOpenDetail(inv: Investment) {
    setError(null);
    try {
      setDetail(await api.getInvestment(inv.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function onDeleteOperation(operationId: string) {
    if (!detail) return;
    if (!confirm('¿Eliminar esta operación? La tenencia y el costo promedio se recalculan.')) return;
    const investmentId = detail.id;
    run(async () => {
      setDetail(await api.deleteInvestmentOperation(investmentId, operationId));
    });
  }

  // --- Precio ---

  function onStartPriceEdit(inv: Investment) {
    setPriceEditId(inv.id);
    setPriceValue(inv.currentPrice !== null ? String(inv.currentPrice) : '');
    setError(null);
  }

  function onConfirmPrice(inv: Investment) {
    run(async () => {
      await api.updateInvestmentPrice(inv.id, Number(priceValue));
      setPriceEditId(null);
    });
  }

  // --- Cotizaciones ---

  function onSubmitRate(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api.upsertExchangeRate({ currency: rateCurrency, rate: Number(rateValue) });
      setRateCurrency('');
      setRateValue('');
    });
  }

  function onConfirmRateEdit() {
    if (!rateEdit) return;
    run(async () => {
      await api.upsertExchangeRate({ currency: rateEdit.currency, rate: Number(rateEdit.value) });
      setRateEdit(null);
    });
  }

  function onDeleteRate(currency: string) {
    if (!confirm(`¿Eliminar la cotización de ${currency}? Los activos en esa moneda salen de los totales.`)) return;
    run(async () => {
      await api.deleteExchangeRate(currency);
    });
  }

  const items = data?.items ?? [];
  const rates = data?.rates ?? [];
  const summary = data?.summary ?? null;
  const activeAssets = items.filter((i) => !i.archivedAt);
  const archivedAssets = items.filter((i) => i.archivedAt);
  const rateMap = useMemo(() => new Map(rates.map((r) => [r.currency, r.rate])), [rates]);

  // Panel de dólares: oficial (Twelve Data) contra MEP y CCL (data912), con la brecha.
  const dolares = useMemo(() => {
    const oficial = rateMap.get('USD') ?? null;
    const gap = (value: number) => (oficial !== null && oficial > 0 ? (value / oficial - 1) * 100 : null);
    const tiles = [
      { key: 'USD', label: 'Oficial', value: oficial, gap: null as number | null },
      { key: 'USDMEP', label: 'MEP', value: rateMap.get('USDMEP') ?? null, gap: null as number | null },
      { key: 'USDCCL', label: 'CCL', value: rateMap.get('USDCCL') ?? null, gap: null as number | null },
    ].filter((tile) => tile.value !== null);
    for (const tile of tiles) {
      if (tile.key !== 'USD' && tile.value !== null) tile.gap = gap(tile.value);
    }
    return tiles;
  }, [rateMap]);

  // Distribución del valor actual por tipo de activo, en moneda base (excluye monedas sin TC).
  const distribution = useMemo(() => {
    const byType = new Map<InvestmentType, number>();
    for (const inv of activeAssets) {
      const rate = inv.currency === null ? 1 : rateMap.get(inv.currency);
      if (rate === undefined || inv.currentValue <= 0) continue;
      byType.set(inv.type, (byType.get(inv.type) ?? 0) + inv.currentValue * rate);
    }
    const total = [...byType.values()].reduce((sum, v) => sum + v, 0);
    const entries = [...byType.entries()]
      .map(([type, value], i) => ({
        type,
        value,
        color: COLOR_PALETTE[i % COLOR_PALETTE.length],
        fraction: total > 0 ? value / total : 0,
      }))
      .sort((a, b) => b.value - a.value);
    let cumulative = 0;
    const segments = entries.map((e) => {
      const dash = e.fraction * DONUT_C;
      const segment = { ...e, dash: `${dash} ${DONUT_C - dash}`, offset: -cumulative };
      cumulative += dash;
      return segment;
    });
    return { total, segments };
  }, [activeAssets, rateMap]);

  // Timestamp del precio más reciente entre los activos, para "Actualizado hace {x}".
  const lastPriceUpdate = useMemo(() => {
    let latest: number | null = null;
    for (const inv of items) {
      if (!inv.priceUpdatedAt) continue;
      const t = new Date(inv.priceUpdatedAt).getTime();
      if (latest === null || t > latest) latest = t;
    }
    return latest;
  }, [items]);

  // Geometría de la curva de valor del portafolio (área + línea SVG, como el patrimonio del dashboard).
  const curve = useMemo(() => {
    const pts = history?.points ?? [];
    if (pts.length < 2) return null;
    const W = 600;
    const H = 120;
    const padY = 14;
    const invested = history?.invested ?? 0;
    const values = pts.map((p) => p.value);
    // El invertido entra al rango para que la línea de referencia siempre caiga dentro del gráfico.
    const min = Math.min(...values, invested);
    const max = Math.max(...values, invested);
    const range = max - min || 1;
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    return {
      W,
      H,
      line,
      area: `${line} L ${W} ${H} L 0 ${H} Z`,
      investedY: invested > 0 ? y(invested) : null,
      first: pts[0].date,
      last: pts[pts.length - 1].date,
      lastValue: pts[pts.length - 1].value,
    };
  }, [history]);

  function renderAssetCard(inv: Investment) {
    const missingRate = inv.currency !== null && !rateMap.has(inv.currency);
    return (
      <div className="card mf-asset-card" key={inv.id}>
        <div className="mf-account-head">
          <div
            className="mf-mark"
            style={{ background: `${inv.color}26`, borderColor: `${inv.color}4d`, color: inv.color }}
          >
            {inv.icon ?? inv.symbol?.slice(0, 4) ?? TYPE_FALLBACK_ICON[inv.type]}
          </div>
          <div className="mf-account-titles">
            <div className="mf-account-name">
              {inv.name}
              {inv.symbol && (
                <span className="mono" style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-4)' }}>
                  {inv.symbol}
                </span>
              )}
            </div>
            <div className="mf-caption">
              {TYPE_LABELS[inv.type]}
              {inv.currency ? ` · ${inv.currency}` : ''}
              {inv.priceFactor === 100 ? ' · cada 100 VN' : ''}
            </div>
          </div>
          <button type="button" className="mf-icon-btn" aria-label="Editar activo" onClick={() => onEditAsset(inv)}>
            <IcoPencil size={15} />
          </button>
          {inv.operationCount === 0 && (
            <button
              type="button"
              className="mf-icon-btn"
              aria-label="Eliminar activo"
              onClick={() => onDeleteAsset(inv)}
            >
              <IcoTrash size={15} />
            </button>
          )}
        </div>

        {missingRate && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--warn)' }}>
            Sin cotización {inv.currency} — no suma a los totales.
          </div>
        )}

        <div className="mf-asset-row">
          <span className="muted">Tenencia</span>
          <span className="mono">{formatQty(inv.quantity)}</span>
        </div>
        <div className="mf-asset-row">
          <span className="muted">Costo promedio</span>
          <span className="mono">{formatPrice(inv.avgCost, inv.currency)}</span>
        </div>
        <div className="mf-asset-row">
          <span className="muted">Precio actual</span>
          {priceEditId === inv.id ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min="0.00000001"
                step="any"
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value)}
                style={{ width: 120 }}
                autoFocus
              />
              <button type="button" disabled={busy || !priceValue} onClick={() => onConfirmPrice(inv)}>
                OK
              </button>
              <button type="button" className="secondary" onClick={() => setPriceEditId(null)}>
                ✕
              </button>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="mono">
                {inv.currentPrice !== null ? formatPrice(inv.currentPrice, inv.currency) : '—'}
              </span>
              {inv.providerSymbol ? (
                <span
                  className="mf-delta-badge"
                  style={{ background: 'var(--accent-weak)', fontSize: 10.5 }}
                  title={`Precio automático desde ${
                    inv.providerSource ? SOURCE_LABELS[inv.providerSource] : 'el proveedor'
                  } (${inv.providerSymbol})${
                    inv.priceUpdatedAt ? ` · actualizado ${formatDate(inv.priceUpdatedAt)}` : ''
                  }`}
                >
                  auto
                </span>
              ) : (
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Actualizar precio"
                  title={
                    inv.priceUpdatedAt ? `Actualizado ${formatDate(inv.priceUpdatedAt)}` : 'Cargar precio actual'
                  }
                  onClick={() => onStartPriceEdit(inv)}
                >
                  <IcoPencil size={13} />
                </button>
              )}
            </span>
          )}
        </div>
        <div className="mf-asset-row">
          <span className="muted">Valor actual</span>
          <span className="mono" style={{ fontWeight: 600 }}>
            {formatAsset(inv.currentValue, inv.currency)}
          </span>
        </div>
        <div className="mf-asset-row">
          <span className="muted">Resultado</span>
          <span className="mono" style={{ color: pnlColor(inv.pnl), fontWeight: 600 }}>
            {inv.pnl >= 0 ? '+' : ''}
            {formatAsset(inv.pnl, inv.currency)}
            {inv.investedCost > 0 ? ` (${inv.pnlPercent >= 0 ? '+' : ''}${inv.pnlPercent}%)` : ''}
          </span>
        </div>
        {(inv.incomeCollected ?? 0) > 0 && (
          <div className="mf-asset-row">
            <span className="muted">Renta cobrada</span>
            <span className="mono" style={{ color: 'var(--pos)', fontWeight: 600 }}>
              +{formatAsset(inv.incomeCollected ?? 0, inv.currency)}
            </span>
          </div>
        )}

        <div className="mf-asset-actions">
          {!inv.archivedAt && (
            <>
              <button type="button" onClick={() => onOpenOperation(inv, 'COMPRA')}>
                Comprar
              </button>
              <button
                type="button"
                className="secondary"
                disabled={inv.quantity <= 0}
                onClick={() => onOpenOperation(inv, 'VENTA')}
              >
                Vender
              </button>
              <button type="button" className="ghost" onClick={() => onOpenRenta(inv)}>
                {rentaLabel(inv.type)}
              </button>
            </>
          )}
          <button type="button" className="ghost" onClick={() => onOpenDetail(inv)}>
            Historial
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => onToggleArchive(inv)}>
            {inv.archivedAt ? 'Desarchivar' : 'Archivar'}
          </button>
        </div>
      </div>
    );
  }

  // En renta fija el precio cotiza cada 100 nominales: el importe se divide por el factor.
  const opTotal =
    opTarget && Number(opQuantity) > 0 && Number(opPrice) > 0
      ? (Number(opQuantity) * Number(opPrice)) / opTarget.priceFactor
      : null;

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      {summary && summary.missingRates.length > 0 && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          Falta cotización para: {summary.missingRates.join(', ')}. Cargala en “Cotizaciones” para incluir esos
          activos en los totales.
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <div className="mf-label mf-label--dot" style={{ marginBottom: 0 }}>
            Curva del portafolio
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {HISTORY_RANGES.map((m) => (
              <button
                key={m}
                type="button"
                className={historyMonths === m ? 'accent-soft' : 'ghost'}
                onClick={() => setHistoryMonths(m)}
              >
                {m}M
              </button>
            ))}
          </div>
        </div>
        {curve === null ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            Necesitás al menos dos días con precios registrados para ver la evolución del portafolio.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${curve.W} ${curve.H}`}
              width="100%"
              height={curve.H}
              preserveAspectRatio="none"
              style={{ display: 'block' }}
            >
              <defs>
                <linearGradient id="invCurveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={curve.area} fill="url(#invCurveFill)" />
              <path
                d={curve.line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {curve.investedY !== null && (
                <line
                  x1={0}
                  y1={curve.investedY}
                  x2={curve.W}
                  y2={curve.investedY}
                  stroke="var(--text-4)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            <div
              className="muted"
              style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginTop: 2 }}
            >
              <span>{formatDate(curve.first)}</span>
              {(history?.invested ?? 0) > 0 && (
                <span className="mono">– – invertido {formatMoney(history!.invested)}</span>
              )}
              <span>{formatDate(curve.last)}</span>
            </div>
          </>
        )}
      </div>

      {(providers.twelveData || providers.data912) && (
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 12 }}
        >
          {lastPriceUpdate !== null && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Actualizado {formatAgo(lastPriceUpdate)}
            </span>
          )}
          <button type="button" className="secondary" disabled={refreshing} onClick={onRefreshPrices}>
            {refreshing ? 'Actualizando…' : 'Actualizar precios'}
          </button>
        </div>
      )}

      <div className="mf-grid-3" style={{ marginBottom: 14 }}>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Valor del portafolio</div>
            <div className="mf-figure mf-figure--stat" style={{ fontSize: 32 }}>
              {formatMoney(summary?.totalValue ?? 0)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Invertido</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32 }}>
            {formatMoney(summary?.totalInvested ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Resultado</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32, color: pnlColor(summary?.pnl ?? 0) }}>
            {(summary?.pnl ?? 0) >= 0 ? '+' : ''}
            {formatMoney(summary?.pnl ?? 0)}
          </div>
          {summary && summary.totalInvested > 0 && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {summary.pnlPercent >= 0 ? '+' : ''}
              {summary.pnlPercent}% sobre lo invertido
            </div>
          )}
          {summary?.tir != null && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              TIR anualizada {formatTir(summary.tir)}
            </div>
          )}
        </div>
      </div>

      <div className="mf-grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="mf-label mf-label--dot" style={{ marginBottom: 14 }}>
            Distribución por tipo
          </div>
          {distribution.segments.length === 0 ? (
            <p className="muted">Cargá activos y operaciones para ver la distribución.</p>
          ) : (
            <div className="mf-donut-row">
              <div className="mf-donut-wrap">
                <svg width={108} height={108} viewBox="0 0 108 108" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx={54} cy={54} r={DONUT_R} fill="none" stroke="var(--surface-2)" strokeWidth={13} />
                  {distribution.segments.map((seg) => (
                    <circle
                      key={seg.type}
                      cx={54}
                      cy={54}
                      r={DONUT_R}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={13}
                      strokeDasharray={seg.dash}
                      strokeDashoffset={seg.offset}
                    />
                  ))}
                </svg>
                <div className="mf-donut-center">
                  <div className="mf-donut-total" title={formatMoney(distribution.total)}>
                    {formatMoneyShort(distribution.total)}
                  </div>
                  <div className="mf-caption" style={{ marginTop: 0 }}>
                    total
                  </div>
                </div>
              </div>
              <div className="mf-legend">
                {distribution.segments.map((seg) => (
                  <div className="mf-legend-row" key={seg.type}>
                    <span className="mf-legend-dot" style={{ background: seg.color }} />
                    <span className="mf-legend-name">{TYPE_LABELS[seg.type]}</span>
                    <span className="mono">{Math.round(seg.fraction * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="mf-label mf-label--dot" style={{ marginBottom: 6 }}>
            Cotizaciones
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Valor de cada moneda extranjera en moneda base. Se usa para consolidar los totales.
            {providers.twelveData && ' El USD (oficial) se actualiza solo a diario.'}
            {providers.data912 && ' El MEP y el CCL también (USDMEP, USDCCL).'}
          </p>

          {dolares.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {dolares.map((tile) => (
                <div
                  key={tile.key}
                  style={{
                    flex: 1,
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div className="mf-caption" style={{ marginTop: 0 }}>
                    {tile.label}
                  </div>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 15 }}>
                    $ {tile.value!.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                  </div>
                  {tile.gap !== null && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      brecha {tile.gap >= 0 ? '+' : ''}
                      {tile.gap.toFixed(1)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {rates.length === 0 && <p className="muted">Sin cotizaciones cargadas.</p>}
          {rates.map((rate) => {
            const autoLabel = autoRateLabel(rate.currency, providers);
            return (
            <div className="mf-list-row" key={rate.id}>
              <div className="mono" style={{ fontWeight: 600, width: 62 }}>
                {rate.currency}
              </div>
              {autoLabel !== null ? (
                <>
                  <div className="mono" style={{ flex: 1 }}>
                    $ {rate.rate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                  </div>
                  <span
                    className="mf-delta-badge"
                    style={{ background: 'var(--accent-weak)', fontSize: 10.5 }}
                    title={`Se actualiza a diario desde ${rate.currency === 'USD' ? 'Twelve Data' : 'data912'}.`}
                  >
                    {autoLabel}
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {formatDate(rate.updatedAt)}
                  </span>
                </>
              ) : rateEdit?.currency === rate.currency ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={rateEdit.value}
                    onChange={(e) => setRateEdit({ currency: rate.currency, value: e.target.value })}
                    style={{ width: 130 }}
                    autoFocus
                  />
                  <button type="button" disabled={busy || !rateEdit.value} onClick={onConfirmRateEdit}>
                    OK
                  </button>
                  <button type="button" className="secondary" onClick={() => setRateEdit(null)}>
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <div className="mono" style={{ flex: 1 }}>
                    $ {rate.rate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                  </div>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {formatDate(rate.updatedAt)}
                  </span>
                  <button
                    type="button"
                    className="mf-icon-btn"
                    aria-label={`Editar cotización ${rate.currency}`}
                    onClick={() => setRateEdit({ currency: rate.currency, value: String(rate.rate) })}
                  >
                    <IcoPencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="mf-icon-btn"
                    aria-label={`Eliminar cotización ${rate.currency}`}
                    onClick={() => onDeleteRate(rate.currency)}
                  >
                    <IcoTrash size={14} />
                  </button>
                </>
              )}
            </div>
            );
          })}
          <form className="mf-rate-form" onSubmit={onSubmitRate}>
            <label className="field mf-rate-currency">
              Moneda
              <input
                value={rateCurrency}
                onChange={(e) => setRateCurrency(e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={8}
                required
              />
            </label>
            <label className="field mf-rate-value">
              Cotización
              <input
                type="number"
                min="0.000001"
                step="any"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                placeholder="1300"
                required
              />
            </label>
            <button className="accent-soft" disabled={busy}>
              Guardar
            </button>
          </form>
        </div>
      </div>

      {!data ? (
        <p className="muted">Cargando…</p>
      ) : activeAssets.length === 0 ? (
        <p className="muted">Todavía no cargaste inversiones.</p>
      ) : (
        <div className="mf-grid-2">{activeAssets.map(renderAssetCard)}</div>
      )}

      {archivedAssets.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Ocultar' : 'Ver'} archivados ({archivedAssets.length})
          </button>
          {showArchived && <div className="mf-grid-2" style={{ marginTop: 12 }}>{archivedAssets.map(renderAssetCard)}</div>}
        </div>
      )}

      <div className="mf-dashed-tile mf-dashed-tile--row">
        <button type="button" className="mf-dashed-main" onClick={() => openAssetForm(EMPTY_ASSET_FORM)}>
          <span className="mf-dashed-mark" aria-hidden="true">
            <IcoPlus />
          </span>
          <span className="mf-dashed-title">Nuevo activo</span>
        </button>
      </div>

      {/* --- Modal alta/edición de activo --- */}
      <Modal
        open={assetForm !== null}
        onClose={() => setAssetForm(null)}
        title={assetForm?.id ? 'Editar activo' : 'Nuevo activo'}
      >
        {assetForm && (
          <form onSubmit={onSubmitAsset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <label className="field">
              Nombre
              <input
                value={assetForm.name}
                onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                required
                maxLength={100}
                placeholder="Ej: Bitcoin, Plazo fijo BBVA, AAPL…"
                autoFocus
              />
            </label>
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Tipo
                <select
                  value={assetForm.type}
                  onChange={(e) => {
                    const type = e.target.value as InvestmentType;
                    // El símbolo vinculado depende del tipo (un CEDEAR no vive en NASDAQ):
                    // cambiar de tipo desvincula y hay que volver a buscar.
                    setAssetForm({
                      ...assetForm,
                      type,
                      providerSymbol: null,
                      providerSource: null,
                      providerMarket: null,
                      providerExchange: null,
                      priceFactor: 1,
                    });
                  }}
                >
                  {(Object.keys(TYPE_LABELS) as InvestmentType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ width: 110 }}>
                Símbolo
                <input
                  value={assetForm.symbol}
                  onChange={(e) => setAssetForm({ ...assetForm, symbol: e.target.value.toUpperCase() })}
                  maxLength={20}
                  placeholder="BTC"
                  disabled={assetForm.providerSymbol !== null}
                />
              </label>
              <label className="field" style={{ width: 110 }}>
                Moneda
                <input
                  value={assetForm.currency}
                  onChange={(e) => setAssetForm({ ...assetForm, currency: e.target.value.toUpperCase() })}
                  maxLength={8}
                  placeholder="Base"
                  // Twelve Data devuelve la moneda real; en data912 es una sugerencia del
                  // sufijo de la especie (AL30 = ARS, AL30D = USD) y se puede corregir.
                  disabled={assetForm.providerSource === 'TWELVE_DATA'}
                />
              </label>
            </div>

            {/* Vinculación con un proveedor: buscador para los tipos con cobertura */}
            {searchAvailable && formSearchKind && (
              assetForm.providerSymbol ? (
                <div
                  className="mf-list-row"
                  style={{ background: 'var(--accent-weak)', borderRadius: 8, padding: '8px 10px' }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Vinculado a{' '}
                      <span className="mono">
                        {assetForm.providerSymbol}
                        {assetForm.providerExchange ? ` · ${assetForm.providerExchange}` : ''}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      Precio automático desde {assetForm.providerSource ? SOURCE_LABELS[assetForm.providerSource] : ''}
                      , cada día al cierre del mercado.
                      {assetForm.priceFactor === 100 && ' Cotiza cada 100 nominales.'}
                    </div>
                  </div>
                  <button type="button" className="secondary" onClick={onUnlinkSymbol}>
                    Desvincular
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <label className="field">
                    Buscar símbolo (precio automático)
                    <input
                      value={symbolQuery}
                      onChange={(e) => setSymbolQuery(e.target.value)}
                      placeholder={SEARCH_PLACEHOLDERS[formSearchKind]}
                      maxLength={40}
                    />
                  </label>
                  {symbolQuery.trim().length >= 2 && (
                    <div className="card" style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', padding: 6 }}>
                      {symbolSearching && <p className="muted" style={{ margin: 6 }}>Buscando…</p>}
                      {!symbolSearching && symbolResults.length === 0 && (
                        <p className="muted" style={{ margin: 6, fontSize: 12.5 }}>
                          Sin resultados. Podés completar el símbolo a mano abajo (precio manual).
                        </p>
                      )}
                      {symbolResults.map((result) => (
                        <button
                          key={`${result.source}-${result.market ?? ''}-${result.symbol}`}
                          type="button"
                          className="ghost"
                          style={{ display: 'flex', width: '100%', gap: 8, textAlign: 'left', alignItems: 'center' }}
                          onClick={() => onPickSymbol(result)}
                        >
                          <span className="mono" style={{ fontWeight: 600, minWidth: 80 }}>
                            {result.symbol}
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {/* data912 no publica nombres: ahí `name` es el propio símbolo. */}
                            {result.name === result.symbol ? '—' : result.name}
                          </span>
                          <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                            {result.market ? MARKET_LABELS[result.market] : result.exchange ?? 'Cripto'} ·{' '}
                            {result.currency}
                          </span>
                          <span
                            className="mf-delta-badge"
                            style={{ background: 'var(--surface-2)', fontSize: 10, whiteSpace: 'nowrap' }}
                          >
                            {SOURCE_LABELS[result.source]}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {/* Renta fija manual: sin esto, la valuación de un bono sale 100x inflada. */}
            {assetForm.type === 'BONO' && !assetForm.providerSymbol && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={assetForm.priceFactor === 100}
                  onChange={(e) => setAssetForm({ ...assetForm, priceFactor: e.target.checked ? 100 : 1 })}
                />
                Cotiza cada 100 nominales (bonos, letras, ONs)
              </label>
            )}

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {assetForm.providerSymbol
                ? `Activo vinculado: el precio lo mantiene ${
                    assetForm.providerSource ? SOURCE_LABELS[assetForm.providerSource] : 'el proveedor'
                  }. Desvinculalo para cargarlo a mano.${
                    assetForm.providerSource === 'DATA912'
                      ? ' La moneda es una sugerencia según la especie: corregila si no coincide.'
                      : ''
                  }`
                : 'Moneda vacía = moneda base de la app. Con moneda (ej: USD), cargá su cotización para consolidar totales.'}
            </p>
            <label className="field">
              Emoji (opcional)
              <input
                value={assetForm.icon}
                onChange={(e) => setAssetForm({ ...assetForm, icon: e.target.value })}
                maxLength={4}
                placeholder={TYPE_FALLBACK_ICON[assetForm.type]}
              />
            </label>
            <label className="field">
              Color
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAssetForm({ ...assetForm, color: c })}
                    aria-label={`Color ${c}`}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: c,
                      border: assetForm.color === c ? '3px solid var(--text)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </label>
            <button disabled={busy}>{busy ? 'Guardando…' : assetForm.id ? 'Guardar cambios' : 'Crear activo'}</button>
          </form>
        )}
      </Modal>

      {/* --- Modal detalle: histórico de precio + operaciones (antes que los de operación
           para que el modal de edición, abierto desde el historial, quede por encima) --- */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Historial · ${detail.name}` : ''}
      >
        {detail && (
          <DetailBody
            detail={detail}
            onEditOperation={onEditOperation}
            onDeleteOperation={onDeleteOperation}
            busy={busy}
          />
        )}
      </Modal>

      {/* --- Modal compra/venta (alta y edición) --- */}
      <Modal
        open={opTarget !== null}
        onClose={closeOpModal}
        title={
          opTarget
            ? `${opEditId ? 'Editar operación' : opType === 'COMPRA' ? 'Comprar' : 'Vender'} · ${opTarget.name}`
            : ''
        }
      >
        {opTarget && (
          <form onSubmit={onSubmitOperation} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Operación
                <select value={opType} onChange={(e) => setOpType(e.target.value as TradeType)}>
                  <option value="COMPRA">Compra</option>
                  <option value="VENTA">Venta</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Fecha
                <input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} required />
              </label>
            </div>
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                {opTarget.priceFactor === 100 ? 'Cantidad (nominales)' : 'Cantidad'}
                <input
                  type="number"
                  min="0.00000001"
                  step="any"
                  value={opQuantity}
                  onChange={(e) => setOpQuantity(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                {opTarget.priceFactor === 100 ? 'Precio (cada 100 VN)' : 'Precio unitario'}
                {opTarget.currency ? ` (${opTarget.currency})` : ''}
                <input
                  type="number"
                  min="0.00000001"
                  step="any"
                  value={opPrice}
                  onChange={(e) => setOpPrice(e.target.value)}
                  required
                />
              </label>
            </div>
            {(opPriceLoading || opPriceHint) && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {opPriceLoading ? 'Buscando precio histórico…' : opPriceHint}
              </p>
            )}
            {opType === 'VENTA' && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Tenencia disponible: {formatQty(opTarget.quantity)}
              </p>
            )}
            {opTotal !== null && (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                Total: <span className="mono">{formatAsset(opTotal, opTarget.currency)}</span>
              </p>
            )}
            <label className="field">
              Nota (opcional)
              <input value={opNote} onChange={(e) => setOpNote(e.target.value)} maxLength={500} />
            </label>
            <button disabled={busy}>
              {busy ? 'Guardando…' : opEditId ? 'Guardar cambios' : 'Registrar operación'}
            </button>
          </form>
        )}
      </Modal>

      {/* --- Modal renta (dividendo/cupón/amortización, alta y edición) --- */}
      <Modal
        open={rentaTarget !== null}
        onClose={closeRentaModal}
        title={
          rentaTarget
            ? `${rentaOpId ? 'Editar' : 'Registrar'} ${rentaLabel(rentaTarget.type).toLowerCase()} · ${rentaTarget.name}`
            : ''
        }
      >
        {rentaTarget && (
          <form onSubmit={onSubmitRenta} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Monto cobrado{rentaTarget.currency ? ` (${rentaTarget.currency})` : ''}
                <input
                  type="number"
                  min="0.00000001"
                  step="any"
                  value={rentaAmount}
                  onChange={(e) => setRentaAmount(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Fecha
                <input type="date" value={rentaDate} onChange={(e) => setRentaDate(e.target.value)} required />
              </label>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              El monto total cobrado, no por unidad. No cambia la tenencia ni el costo promedio; suma al resultado
              total y a la TIR.
            </p>
            <label className="field">
              Nota (opcional)
              <input value={rentaNote} onChange={(e) => setRentaNote(e.target.value)} maxLength={500} />
            </label>
            {/* Acreditar en cuenta: sólo al alta (la edición no toca movimientos ya creados). */}
            {!rentaOpId && (
              <>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={rentaCredit}
                    disabled={accounts.length === 0}
                    onChange={(e) => setRentaCredit(e.target.checked)}
                  />
                  Acreditar como ingreso en una cuenta
                </label>
                {rentaCredit && (
                  <label className="field">
                    Cuenta
                    <select value={rentaAccountId} onChange={(e) => setRentaAccountId(e.target.value)}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <button disabled={busy}>
              {busy ? 'Guardando…' : rentaOpId ? 'Guardar cambios' : 'Registrar'}
            </button>
          </form>
        )}
      </Modal>

    </>
  );
}

function DetailBody({
  detail,
  onEditOperation,
  onDeleteOperation,
  busy,
}: {
  detail: InvestmentDetail;
  onEditOperation: (op: InvestmentOperation) => void;
  onDeleteOperation: (operationId: string) => void;
  busy: boolean;
}) {
  // Geometría del gráfico de precio (línea + área), mismo patrón SVG que el dashboard.
  const chart = useMemo(() => {
    const pts = detail.priceHistory;
    if (pts.length < 2) return null;
    const W = 560;
    const H = 110;
    const padY = 12;
    const values = pts.map((p) => p.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');
    return { W, H, line, area: `${line} L ${W} ${H} L 0 ${H} Z`, min, max };
  }, [detail]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {detail.tir != null && (
        <div className="mf-asset-row" style={{ marginTop: -4 }}>
          <span className="muted">TIR anualizada</span>
          <span className="mono" style={{ color: pnlColor(detail.tir), fontWeight: 600 }}>
            {formatTir(detail.tir)}
          </span>
        </div>
      )}
      {(detail.incomeCollected ?? 0) > 0 && (
        <div className="mf-asset-row" style={{ marginTop: -4 }}>
          <span className="muted">Renta cobrada</span>
          <span className="mono" style={{ color: 'var(--pos)', fontWeight: 600 }}>
            +{formatAsset(detail.incomeCollected ?? 0, detail.currency)}
          </span>
        </div>
      )}
      <div>
        <div className="mf-label" style={{ marginBottom: 8 }}>
          Precio
        </div>
        {chart === null ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            {detail.providerMarket === 'notes' || detail.providerMarket === 'corp'
              ? 'Este instrumento no tiene histórico en data912: el gráfico se va completando con la actualización diaria.'
              : 'Actualizá el precio al menos dos veces para ver la evolución.'}
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${chart.W} ${chart.H}`}
              width="100%"
              height={chart.H}
              preserveAspectRatio="none"
              style={{ display: 'block' }}
            >
              <defs>
                <linearGradient id="invPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={chart.area} fill="url(#invPriceFill)" />
              <path
                d={chart.line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }} className="muted">
              <span>{formatDate(detail.priceHistory[0].date)}</span>
              <span className="mono">
                mín {formatPrice(chart.min, detail.currency)} · máx {formatPrice(chart.max, detail.currency)}
              </span>
              <span>{formatDate(detail.priceHistory[detail.priceHistory.length - 1].date)}</span>
            </div>
          </>
        )}
      </div>

      <div>
        <div className="mf-label" style={{ marginBottom: 8 }}>
          Operaciones
        </div>
        {detail.operations.length === 0 ? (
          <p className="muted">Sin operaciones registradas.</p>
        ) : (
          detail.operations.map((op) => {
            const isRenta = op.type === 'RENTA';
            const badgeLabel = isRenta ? rentaLabel(detail.type) : op.type === 'COMPRA' ? 'Compra' : 'Venta';
            return (
              <div className="mf-list-row" key={op.id}>
                <span
                  className="mf-delta-badge"
                  style={{
                    background: op.type === 'VENTA' ? 'var(--neg-weak)' : 'var(--accent-weak)',
                    color: isRenta ? 'var(--warn)' : op.type === 'COMPRA' ? 'var(--pos)' : 'var(--neg)',
                  }}
                >
                  {badgeLabel}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {isRenta
                      ? 'Renta cobrada'
                      : `${formatQty(op.quantity)} × ${formatPrice(op.unitPrice, detail.currency)}`}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {formatDate(op.date)}
                    {op.note ? ` · ${op.note}` : ''}
                  </div>
                </div>
                <span className="mono" style={{ fontWeight: 600, color: isRenta ? 'var(--pos)' : undefined }}>
                  {isRenta
                    ? `+${formatAsset(op.unitPrice, detail.currency)}`
                    : formatAsset((op.quantity * op.unitPrice) / detail.priceFactor, detail.currency)}
                </span>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Editar operación"
                  disabled={busy}
                  onClick={() => onEditOperation(op)}
                >
                  <IcoPencil size={14} />
                </button>
                <button
                  type="button"
                  className="mf-icon-btn"
                  aria-label="Eliminar operación"
                  disabled={busy}
                  onClick={() => onDeleteOperation(op.id)}
                >
                  <IcoTrash size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
