import type {
  Investment,
  InvestmentDetail,
  InvestmentOperationType,
  InvestmentsOverview,
  InvestmentType,
  SymbolSearchResult,
} from '@myfinance/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

/** Tipos con buscador de símbolos de Twelve Data (lo que cubre el plan free). */
type SearchableType = 'ACCION' | 'ETF' | 'CRIPTO';

function searchableType(type: InvestmentType): SearchableType | null {
  return type === 'ACCION' || type === 'ETF' || type === 'CRIPTO' ? type : null;
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

interface AssetFormState {
  id: string | null;
  name: string;
  type: InvestmentType;
  symbol: string;
  currency: string;
  icon: string;
  color: string;
  /** Símbolo de Twelve Data vinculado (precio automático), o null = manual. */
  providerSymbol: string | null;
  providerExchange: string | null;
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
  providerExchange: null,
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
  const [opType, setOpType] = useState<InvestmentOperationType>('COMPRA');
  const [opQuantity, setOpQuantity] = useState('');
  const [opPrice, setOpPrice] = useState('');
  const [opDate, setOpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opNote, setOpNote] = useState('');

  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');

  const [detail, setDetail] = useState<InvestmentDetail | null>(null);

  const [rateCurrency, setRateCurrency] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [rateEdit, setRateEdit] = useState<{ currency: string; value: string } | null>(null);

  const { data, error: loadError, refresh } = useCached<InvestmentsOverview>('investments', () =>
    api.listInvestments(),
  );
  const providerEnabled = data?.providerEnabled ?? false;

  // Buscador de símbolos con debounce (los endpoints de búsqueda no gastan créditos).
  const formSearchType = assetForm ? searchableType(assetForm.type) : null;
  useEffect(() => {
    const q = symbolQuery.trim();
    if (!providerEnabled || !formSearchType || q.length < 2) {
      setSymbolResults([]);
      setSymbolSearching(false);
      return;
    }
    setSymbolSearching(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await api.searchInvestmentSymbols(formSearchType, q);
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
  }, [symbolQuery, formSearchType, providerEnabled]);

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
      providerExchange: result.exchange,
    });
    setSymbolQuery('');
    setSymbolResults([]);
  }

  function onUnlinkSymbol() {
    if (!assetForm) return;
    setAssetForm({ ...assetForm, providerSymbol: null, providerExchange: null });
  }

  function invalidateAfterMutation() {
    invalidate('investments');
    invalidate('dashboard');
    refresh();
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
      providerExchange: assetForm.providerExchange,
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
      providerExchange: inv.providerExchange,
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

  function onOpenOperation(inv: Investment, type: InvestmentOperationType) {
    setOpTarget(inv);
    setOpType(type);
    setOpQuantity('');
    setOpPrice(inv.currentPrice !== null ? String(inv.currentPrice) : '');
    setOpDate(new Date().toISOString().slice(0, 10));
    setOpNote('');
    setError(null);
  }

  function onSubmitOperation(e: FormEvent) {
    e.preventDefault();
    if (!opTarget) return;
    run(async () => {
      await api.addInvestmentOperation(opTarget.id, {
        type: opType,
        quantity: Number(opQuantity),
        unitPrice: Number(opPrice),
        date: opDate,
        note: opNote || null,
      });
      setOpTarget(null);
    });
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
                  title={`Precio automático (${inv.providerSymbol})${
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

  const opTotal = Number(opQuantity) > 0 && Number(opPrice) > 0 ? Number(opQuantity) * Number(opPrice) : null;

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      {summary && summary.missingRates.length > 0 && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          Falta cotización para: {summary.missingRates.join(', ')}. Cargala en “Cotizaciones” para incluir esos
          activos en los totales.
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
            {providerEnabled && ' El USD (oficial) se actualiza solo a diario; para MEP o blue creá otra moneda (ej: USDMEP).'}
          </p>
          {rates.length === 0 && <p className="muted">Sin cotizaciones cargadas.</p>}
          {rates.map((rate) => (
            <div className="mf-list-row" key={rate.id}>
              <div className="mono" style={{ fontWeight: 600, width: 52 }}>
                {rate.currency}
              </div>
              {providerEnabled && rate.currency === 'USD' ? (
                <>
                  <div className="mono" style={{ flex: 1 }}>
                    $ {rate.rate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                  </div>
                  <span
                    className="mf-delta-badge"
                    style={{ background: 'var(--accent-weak)', fontSize: 10.5 }}
                    title="Dólar oficial, actualizado a diario desde Twelve Data. Para MEP o blue creá otra moneda (ej: USDMEP)."
                  >
                    OFICIAL · auto
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
          ))}
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
                    // Al pasar a un tipo sin cobertura de Twelve Data, se desvincula.
                    setAssetForm({
                      ...assetForm,
                      type,
                      ...(searchableType(type) ? {} : { providerSymbol: null, providerExchange: null }),
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
                  disabled={assetForm.providerSymbol !== null}
                />
              </label>
            </div>

            {/* Vinculación con Twelve Data: buscador para tipos con cobertura */}
            {providerEnabled && formSearchType && (
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
                      El precio se actualiza solo cada día al cierre del mercado.
                    </div>
                  </div>
                  <button type="button" className="secondary" onClick={onUnlinkSymbol}>
                    Desvincular
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <label className="field">
                    Buscar en Twelve Data (precio automático)
                    <input
                      value={symbolQuery}
                      onChange={(e) => setSymbolQuery(e.target.value)}
                      placeholder={
                        formSearchType === 'CRIPTO' ? 'Ej: BTC, Ethereum…' : 'Ej: AAPL, Apple, SPY…'
                      }
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
                          key={`${result.symbol}-${result.exchange ?? ''}`}
                          type="button"
                          className="ghost"
                          style={{ display: 'flex', width: '100%', gap: 8, textAlign: 'left' }}
                          onClick={() => onPickSymbol(result)}
                        >
                          <span className="mono" style={{ fontWeight: 600, minWidth: 80 }}>
                            {result.symbol}
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {result.name}
                          </span>
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {result.exchange ?? 'Cripto'} · {result.currency}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {assetForm.providerSymbol
                ? 'Activo vinculado: símbolo, moneda y precio los maneja Twelve Data. Desvinculalo para editarlos a mano.'
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

      {/* --- Modal compra/venta --- */}
      <Modal
        open={opTarget !== null}
        onClose={() => setOpTarget(null)}
        title={opTarget ? `${opType === 'COMPRA' ? 'Comprar' : 'Vender'} · ${opTarget.name}` : ''}
      >
        {opTarget && (
          <form onSubmit={onSubmitOperation} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Operación
                <select value={opType} onChange={(e) => setOpType(e.target.value as InvestmentOperationType)}>
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
                Cantidad
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
                Precio unitario{opTarget.currency ? ` (${opTarget.currency})` : ''}
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
            <button disabled={busy}>{busy ? 'Guardando…' : 'Registrar operación'}</button>
          </form>
        )}
      </Modal>

      {/* --- Modal detalle: histórico de precio + operaciones --- */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Historial · ${detail.name}` : ''}
      >
        {detail && <DetailBody detail={detail} onDeleteOperation={onDeleteOperation} busy={busy} />}
      </Modal>
    </>
  );
}

function DetailBody({
  detail,
  onDeleteOperation,
  busy,
}: {
  detail: InvestmentDetail;
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
      <div>
        <div className="mf-label" style={{ marginBottom: 8 }}>
          Precio
        </div>
        {chart === null ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            Actualizá el precio al menos dos veces para ver la evolución.
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
          detail.operations.map((op) => (
            <div className="mf-list-row" key={op.id}>
              <span
                className="mf-delta-badge"
                style={{
                  background: op.type === 'COMPRA' ? 'var(--accent-weak)' : 'var(--neg-weak)',
                  color: op.type === 'COMPRA' ? 'var(--pos)' : 'var(--neg)',
                }}
              >
                {op.type === 'COMPRA' ? 'Compra' : 'Venta'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 13 }}>
                  {formatQty(op.quantity)} × {formatPrice(op.unitPrice, detail.currency)}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {formatDate(op.date)}
                  {op.note ? ` · ${op.note}` : ''}
                </div>
              </div>
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatAsset(op.quantity * op.unitPrice, detail.currency)}
              </span>
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
          ))
        )}
      </div>
    </div>
  );
}
