import { config } from '../../config';
import {
  BACKFILL_DAYS,
  type DailyClose,
  type PriceProvider,
  type ProviderSymbol,
  type SymbolRef,
  type SymbolSearchKind,
  refKey,
} from './types';

/**
 * Cliente de Twelve Data (https://twelvedata.com/docs).
 *
 * Reglas de créditos del plan gratuito que este módulo respeta:
 * - Endpoints de referencia (symbol_search, cryptocurrencies): NO consumen créditos.
 * - Endpoints de mercado (price, time_series): 1 crédito por símbolo,
 *   límite de 8 créditos/minuto y 800/día.
 *
 * Cobertura: acciones/ETFs de EE.UU. y cripto. El mercado argentino no entra en
 * el plan gratuito — de eso se ocupa el adapter de data912.
 */

/// Override para tests/desarrollo contra un mock local.
const BASE_URL = process.env.TWELVE_DATA_BASE_URL || 'https://api.twelvedata.com';

/** Cuántos símbolos de mercado se piden por minuto (límite del plan gratuito). */
const CREDITS_PER_MINUTE = 8;

export const twelveDataEnabled = Boolean(config.twelveDataApiKey);
if (!twelveDataEnabled) {
  console.warn('[twelvedata] TWELVE_DATA_API_KEY no configurada — precios de EE.UU. y cripto quedan manuales');
}

interface TdErrorBody {
  code?: number;
  message?: string;
  status?: string;
}

function isTdError(value: unknown): value is TdErrorBody {
  return (
    typeof value === 'object' && value !== null && (value as TdErrorBody).status === 'error'
  );
}

async function tdGet<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!twelveDataEnabled) throw new Error('Twelve Data no está configurado');
  const search = new URLSearchParams({ ...params, apikey: config.twelveDataApiKey! });
  const res = await fetch(`${BASE_URL}${path}?${search.toString()}`);
  if (!res.ok) throw new Error(`Twelve Data respondió HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (isTdError(data)) {
    throw new Error(`Twelve Data: ${data.message ?? `error ${data.code ?? 'desconocido'}`}`);
  }
  return data as T;
}

// --- Caché en memoria para endpoints de referencia (gratis pero lentos) ---

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

// --- Búsqueda de símbolos (endpoints de referencia, sin costo de créditos) ---

const SEARCH_TTL_MS = 60 * 60 * 1000; // 1 h por consulta
const CRYPTO_LIST_TTL_MS = 24 * 60 * 60 * 1000; // el listado de cripto cambia poco

interface SymbolSearchRow {
  symbol: string;
  instrument_name: string;
  exchange: string;
  instrument_type: string;
  country: string;
  currency: string;
}

/** Tipos de instrumento del plan gratuito que mapean a cada tipo de la app. */
const INSTRUMENT_TYPES: Record<'ACCION' | 'ETF', string[]> = {
  ACCION: ['Common Stock', 'American Depositary Receipt', 'REIT'],
  ETF: ['ETF'],
};

function toProviderSymbol(symbol: string, name: string, exchange: string | null, currency: string): ProviderSymbol {
  return { symbol, name, exchange, currency, source: 'TWELVE_DATA', market: null, priceFactor: 1 };
}

async function searchStocks(kind: 'ACCION' | 'ETF', query: string): Promise<ProviderSymbol[]> {
  const data = await cached(`search:${query.toUpperCase()}`, SEARCH_TTL_MS, () =>
    tdGet<{ data: SymbolSearchRow[] }>('/symbol_search', { symbol: query, outputsize: '120' }),
  );
  const allowed = INSTRUMENT_TYPES[kind];
  return (data.data ?? [])
    .filter((row) => row.country === 'United States' && allowed.includes(row.instrument_type))
    .slice(0, 30)
    .map((row) => toProviderSymbol(row.symbol, row.instrument_name, row.exchange || null, row.currency || 'USD'));
}

interface CryptoRow {
  symbol: string;
  currency_base: string;
  currency_quote: string;
}

async function searchCrypto(query: string): Promise<ProviderSymbol[]> {
  const data = await cached('crypto-list', CRYPTO_LIST_TTL_MS, () =>
    tdGet<{ data: CryptoRow[] }>('/cryptocurrencies', { currency_quote: 'USD' }),
  );
  const q = query.trim().toUpperCase();
  return (data.data ?? [])
    .filter((row) => {
      const base = row.symbol.split('/')[0];
      return base.startsWith(q) || row.currency_base.toUpperCase().includes(q);
    })
    .slice(0, 30)
    .map((row) => toProviderSymbol(row.symbol, row.currency_base, null, 'USD'));
}

// --- Precios (endpoints de mercado, 1 crédito por símbolo) ---

interface PriceRow {
  price?: string;
}

async function fetchPrice(ref: SymbolRef): Promise<number> {
  const data = await tdGet<PriceRow>('/price', { symbol: ref.symbol });
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Twelve Data no devolvió precio para ${ref.symbol}`);
  }
  return price;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Últimos precios de varios símbolos en llamadas batch, respetando el límite
 * de créditos por minuto (chunks de a 8, con espera entre chunks). Los
 * símbolos que fallan (delisted, sin cobertura) se omiten del resultado.
 */
async function fetchPrices(refs: SymbolRef[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const unique = [...new Set(refs.map((ref) => ref.symbol))];
  for (let i = 0; i < unique.length; i += CREDITS_PER_MINUTE) {
    if (i > 0) await sleep(62_000); // ventana nueva de créditos por minuto
    const chunk = unique.slice(i, i + CREDITS_PER_MINUTE);
    try {
      const data = await tdGet<Record<string, PriceRow> | PriceRow>('/price', { symbol: chunk.join(',') });
      // Con un solo símbolo la respuesta es plana; en batch viene indexada por símbolo.
      const bySymbol =
        chunk.length === 1
          ? { [chunk[0]]: data as PriceRow }
          : (data as Record<string, PriceRow>);
      for (const symbol of chunk) {
        const price = Number(bySymbol[symbol]?.price);
        if (Number.isFinite(price) && price > 0) result.set(refKey({ symbol, market: null }), price);
        else console.warn(`[twelvedata] Sin precio para ${symbol}`);
      }
    } catch (err) {
      console.error(`[twelvedata] Error pidiendo precios de ${chunk.join(',')}:`, err);
    }
  }
  return result;
}

/**
 * Cierres diarios del último año (para el backfill del histórico al vincular).
 * 1 crédito. Devuelve en orden cronológico ascendente.
 */
async function fetchDailyCloses(ref: SymbolRef): Promise<DailyClose[]> {
  const data = await tdGet<{ values?: Array<{ datetime: string; close: string }> }>('/time_series', {
    symbol: ref.symbol,
    interval: '1day',
    outputsize: String(BACKFILL_DAYS),
  });
  return (data.values ?? [])
    .map((row) => ({ date: new Date(`${row.datetime}T00:00:00.000Z`), price: Number(row.close) }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0 && !Number.isNaN(row.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Cotización del dólar oficial (par configurable). `null` si no hay dato. */
export async function fetchOfficialUsdRate(): Promise<number | null> {
  const prices = await fetchPrices([{ symbol: config.twelveDataUsdPair, market: null }]);
  return prices.get(refKey({ symbol: config.twelveDataUsdPair, market: null })) ?? null;
}

export const twelveDataProvider: PriceProvider = {
  source: 'TWELVE_DATA',
  label: 'Twelve Data',
  get enabled() {
    return twelveDataEnabled;
  },
  covers(kind: SymbolSearchKind) {
    return kind === 'ACCION' || kind === 'ETF' || kind === 'CRIPTO';
  },
  search(kind, query) {
    if (kind === 'CRIPTO') return searchCrypto(query);
    if (kind === 'ACCION' || kind === 'ETF') return searchStocks(kind, query);
    return Promise.resolve([]);
  },
  fetchPrice,
  fetchPrices,
  fetchDailyCloses,
};
