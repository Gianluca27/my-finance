import { config } from '../../config';
import {
  BACKFILL_DAYS,
  type DailyClose,
  type PriceProvider,
  type ProviderMarket,
  type ProviderSymbol,
  type SymbolRef,
  type SymbolSearchKind,
  priceFactorFor,
  refKey,
} from './types';

/**
 * Cliente de data912 (https://data912.com/docs) — mercado argentino.
 *
 * Pública y sin API key. Una request trae un mercado entero (924 CEDEARs de una),
 * así que los listados se cachean en memoria y tanto la búsqueda como el precio
 * se resuelven con un lookup. El histórico sí es una request por ticker.
 *
 * Límite: 120 req/min por endpoint. Los datos se refrescan cada ~20 s upstream.
 */

/** Endpoint de precios en vivo por mercado. */
const LIVE_PATHS: Record<ProviderMarket, string> = {
  stocks: '/live/arg_stocks',
  cedears: '/live/arg_cedears',
  bonds: '/live/arg_bonds',
  notes: '/live/arg_notes',
  corp: '/live/arg_corp',
};

/** Solo tres mercados tienen histórico OHLC. Los otros arrancan el gráfico vacío. */
const HISTORICAL_PATHS: Partial<Record<ProviderMarket, string>> = {
  stocks: '/historical/stocks',
  cedears: '/historical/cedears',
  bonds: '/historical/bonds',
};

const MARKET_LABELS: Record<ProviderMarket, string> = {
  stocks: 'BYMA acciones',
  cedears: 'BYMA CEDEARs',
  bonds: 'BYMA bonos',
  notes: 'BYMA letras',
  corp: 'BYMA ONs',
};

/** Los listados cambian de precio cada ~20 s; 5 min alcanza para un cron diario y una búsqueda interactiva. */
const LIVE_TTL_MS = 5 * 60 * 1000;

/** Cuántos tickers líquidos promedia la mediana de MEP y CCL. */
const DOLAR_SAMPLE_SIZE = 10;

export const data912Enabled = config.data912Enabled;
if (!data912Enabled) {
  console.warn('[data912] DATA912_ENABLED=false — mercado argentino y dólar MEP/CCL deshabilitados');
}

async function d912Get<T>(path: string): Promise<T> {
  if (!data912Enabled) throw new Error('data912 no está habilitado');
  const res = await fetch(`${config.data912BaseUrl}${path}`);
  if (res.status === 429) {
    throw new Error('data912 rechazó la consulta por límite de peticiones. Probá de nuevo en un minuto.');
  }
  if (!res.ok) throw new Error(`data912 respondió HTTP ${res.status}`);
  return (await res.json()) as T;
}

// --- Caché en memoria de los listados en vivo ---

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const liveCache = new Map<string, CacheEntry<unknown>>();

async function cachedGet<T>(path: string, ttlMs: number): Promise<T> {
  const hit = liveCache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await d912Get<T>(path);
  liveCache.set(path, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

// --- Precios en vivo ---

/** Fila de cualquiera de los cinco listados `/live/arg_*`. */
export interface LiveRow {
  symbol: string;
  /** Último precio operado. */
  c?: number | null;
  px_bid?: number | null;
  px_ask?: number | null;
}

/**
 * Precio de una fila: último operado; si no hay, el punto medio de las puntas.
 * Devuelve `null` cuando la especie no operó ni tiene puntas (se omite del resultado).
 */
export function pickPrice(row: LiveRow): number | null {
  const last = Number(row.c);
  if (Number.isFinite(last) && last > 0) return last;
  const bid = Number(row.px_bid);
  const ask = Number(row.px_ask);
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) return (bid + ask) / 2;
  return null;
}

function fetchMarket(market: ProviderMarket): Promise<LiveRow[]> {
  return cachedGet<LiveRow[]>(LIVE_PATHS[market], LIVE_TTL_MS);
}

async function marketIndex(market: ProviderMarket): Promise<Map<string, LiveRow>> {
  const rows = await fetchMarket(market);
  return new Map(rows.map((row) => [row.symbol.toUpperCase(), row]));
}

function assertMarket(ref: SymbolRef): ProviderMarket {
  if (ref.market === null) throw new Error('data912 requiere un mercado (stocks, cedears, bonds, notes, corp)');
  return ref.market;
}

async function fetchPrice(ref: SymbolRef): Promise<number> {
  const market = assertMarket(ref);
  const row = (await marketIndex(market)).get(ref.symbol.toUpperCase());
  if (!row) throw new Error(`${ref.symbol} no cotiza en ${MARKET_LABELS[market]}`);
  const price = pickPrice(row);
  if (price === null) throw new Error(`data912 no devolvió precio para ${ref.symbol}`);
  return price;
}

/**
 * Precios de varios símbolos. Los refs se agrupan por mercado, así que el costo
 * es una request por mercado (cacheada), no una por símbolo. Un mercado que
 * falla se loguea y se omite; los demás igual devuelven precio.
 */
async function fetchPrices(refs: SymbolRef[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const byMarket = new Map<ProviderMarket, SymbolRef[]>();
  for (const ref of refs) {
    if (ref.market === null) continue;
    const list = byMarket.get(ref.market) ?? [];
    list.push(ref);
    byMarket.set(ref.market, list);
  }

  for (const [market, marketRefs] of byMarket) {
    let index: Map<string, LiveRow>;
    try {
      index = await marketIndex(market);
    } catch (err) {
      console.error(`[data912] Error pidiendo el listado de ${market}:`, err);
      continue;
    }
    for (const ref of marketRefs) {
      const row = index.get(ref.symbol.toUpperCase());
      const price = row ? pickPrice(row) : null;
      if (price !== null) result.set(refKey(ref), price);
      else console.warn(`[data912] Sin precio para ${ref.symbol} (${market})`);
    }
  }
  return result;
}

// --- Histórico ---

interface OhlcRow {
  date: string;
  c: number;
}

/** Cierres diarios del último año. `[]` en `notes` y `corp`: no tienen endpoint histórico. */
async function fetchDailyCloses(ref: SymbolRef): Promise<DailyClose[]> {
  const market = assertMarket(ref);
  const path = HISTORICAL_PATHS[market];
  if (!path) return [];

  const rows = await d912Get<OhlcRow[]>(`${path}/${encodeURIComponent(ref.symbol.toUpperCase())}`);
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
  return rows
    .map((row) => ({ date: new Date(`${row.date}T00:00:00.000Z`), price: Number(row.c) }))
    .filter(
      (row) =>
        Number.isFinite(row.price) &&
        row.price > 0 &&
        !Number.isNaN(row.date.getTime()) &&
        row.date.getTime() >= cutoff,
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// --- Búsqueda ---

/**
 * Rango plausible del cociente precio_ARS / precio_USD de una misma especie:
 * cualquier MEP o CCL cae acá. Sirve para reconocer una especie en dólares sin
 * hardcodear la cotización del día.
 */
const USD_SPECIES_RATIO = { min: 500, max: 3000 };

/**
 * Moneda sugerida para prellenar el formulario (el usuario puede corregirla).
 *
 * Un mismo instrumento cotiza en pesos y en dólares bajo especies distintas, y
 * el sufijo `D` (MEP) o `C` (CCL) las distingue... salvo cuando el ticker en
 * pesos ya termina en D o C. Los casos son reales y frecuentes:
 *
 *   YPFD   acción de YPF Clase D, en pesos       → su especie en dólares es YPFDD
 *   AMD, C, HD, GLD, MCD, HSBC, KGC              → CEDEARs de tickers que terminan en D/C
 *   BA37D, SA24D                                 → bonos en pesos que terminan en D
 *
 * Por eso en `stocks`, `cedears` y `bonds` no alcanza el sufijo: se exige además
 * que exista la especie base y que el cociente de precios se parezca a un MEP/CCL.
 * En `notes` y `corp` la convención sí es limpia (en ONs: O = pesos, D/C = dólares)
 * y la especie base no siempre está publicada, así que ahí manda el sufijo.
 *
 * Residuo conocido: una especie en dólares cuya base no figura en el listado
 * (TECOD, BA7DD) se sugiere como ARS. El usuario la corrige en el formulario.
 */
export function suggestCurrency(
  market: ProviderMarket,
  symbol: string,
  priceBySymbol: Map<string, number | null>,
): string {
  const upper = symbol.toUpperCase();
  const last = upper.slice(-1);
  if (last !== 'D' && last !== 'C') return 'ARS';
  if (market === 'notes' || market === 'corp') return 'USD';

  const price = priceBySymbol.get(upper);
  const basePrice = priceBySymbol.get(upper.slice(0, -1));
  if (!price || !basePrice) return 'ARS';
  const ratio = basePrice / price;
  return ratio > USD_SPECIES_RATIO.min && ratio < USD_SPECIES_RATIO.max ? 'USD' : 'ARS';
}

/** Los que empiezan con la consulta primero; después los que la contienen. */
export function rankSymbols(symbols: string[], query: string): string[] {
  const q = query.trim().toUpperCase();
  const starts = symbols.filter((s) => s.startsWith(q));
  const contains = symbols.filter((s) => !s.startsWith(q) && s.includes(q));
  return [...starts.sort(), ...contains.sort()];
}

async function searchMarket(market: ProviderMarket, query: string): Promise<ProviderSymbol[]> {
  const rows = await fetchMarket(market);
  // La moneda de una especie se deduce comparándola con su base: hace falta todo el listado.
  const priceBySymbol = new Map(rows.map((row) => [row.symbol.toUpperCase(), pickPrice(row)]));
  const symbols = rankSymbols([...priceBySymbol.keys()], query);
  return symbols.slice(0, 30).map((symbol) => ({
    symbol,
    // data912 no publica el nombre del instrumento: el símbolo es todo lo que hay.
    name: symbol,
    exchange: 'BYMA',
    currency: suggestCurrency(market, symbol, priceBySymbol),
    source: 'DATA912' as const,
    market,
    priceFactor: priceFactorFor(market),
  }));
}

/** Mercados de data912 que cubren cada tipo de activo de la app. */
const KIND_MARKETS: Partial<Record<SymbolSearchKind, ProviderMarket[]>> = {
  ACCION: ['stocks'],
  CEDEAR: ['cedears'],
  BONO: ['bonds', 'notes', 'corp'],
};

async function search(kind: SymbolSearchKind, query: string): Promise<ProviderSymbol[]> {
  const markets = KIND_MARKETS[kind];
  if (!markets) return [];
  // Un mercado caído no debe vaciar los resultados de los otros.
  const settled = await Promise.allSettled(markets.map((market) => searchMarket(market, query)));
  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value;
    console.error('[data912] Error buscando símbolos:', result.reason);
    return [];
  });
}

// --- Dólar MEP y CCL ---

/** Mediana; `null` si no queda ningún valor válido. */
export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

export interface MepRow {
  ticker: string;
  close?: number | null;
  mark?: number | null;
  v_ars?: number | null;
  panel?: string;
}

export interface CclRow {
  ticker_ar: string;
  CCL_close?: number | null;
  CCL_mark?: number | null;
  volume_rank?: number | null;
}

/**
 * MEP: mediana del cierre implícito de los bonos soberanos más operados.
 * La mediana absorbe la especie ilíquida que no operó y arrastra un cierre viejo.
 */
export function computeMep(rows: MepRow[]): number | null {
  const bonds = rows
    .filter((row) => row.panel === 'bonds')
    .sort((a, b) => (Number(b.v_ars) || 0) - (Number(a.v_ars) || 0))
    .slice(0, DOLAR_SAMPLE_SIZE);
  return median(bonds.map((row) => Number(row.close ?? row.mark)));
}

/**
 * CCL: mediana del cierre implícito de las especies más operadas.
 * `/live/ccl` repite tickers (una fila por especie), así que se deduplica antes de cortar.
 */
export function computeCcl(rows: CclRow[]): number | null {
  const seen = new Set<string>();
  const top: CclRow[] = [];
  for (const row of [...rows].sort((a, b) => (Number(a.volume_rank) || Infinity) - (Number(b.volume_rank) || Infinity))) {
    if (seen.has(row.ticker_ar)) continue;
    seen.add(row.ticker_ar);
    top.push(row);
    if (top.length === DOLAR_SAMPLE_SIZE) break;
  }
  return median(top.map((row) => Number(row.CCL_close ?? row.CCL_mark)));
}

export interface DolarRates {
  mep: number | null;
  ccl: number | null;
}

/** Cotizaciones implícitas del día. Cada una falla por separado. */
export async function fetchDolar(): Promise<DolarRates> {
  const [mep, ccl] = await Promise.all([
    d912Get<MepRow[]>('/live/mep')
      .then(computeMep)
      .catch((err) => {
        console.error('[data912] Error calculando el MEP:', err);
        return null;
      }),
    d912Get<CclRow[]>('/live/ccl')
      .then(computeCcl)
      .catch((err) => {
        console.error('[data912] Error calculando el CCL:', err);
        return null;
      }),
  ]);
  return { mep, ccl };
}

/** Monedas cuya cotización mantiene el cron de data912 (no editables a mano). */
export const DOLAR_CURRENCIES = { mep: 'USDMEP', ccl: 'USDCCL' } as const;

export const data912Provider: PriceProvider = {
  source: 'DATA912',
  label: 'data912',
  get enabled() {
    return data912Enabled;
  },
  covers(kind: SymbolSearchKind) {
    return KIND_MARKETS[kind] !== undefined;
  },
  search,
  fetchPrice,
  fetchPrices,
  fetchDailyCloses,
};
