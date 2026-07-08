import { config } from '../config';

/**
 * Cliente de Twelve Data (https://twelvedata.com/docs).
 *
 * Reglas de créditos del plan gratuito que este módulo respeta:
 * - Endpoints de referencia (symbol_search, cryptocurrencies): NO consumen créditos.
 * - Endpoints de mercado (price, time_series): 1 crédito por símbolo,
 *   límite de 8 créditos/minuto y 800/día.
 */

/// Override para tests/desarrollo contra un mock local.
const BASE_URL = process.env.TWELVE_DATA_BASE_URL || 'https://api.twelvedata.com';

/** Cuántos símbolos de mercado se piden por minuto (límite del plan gratuito). */
const CREDITS_PER_MINUTE = 8;

export const twelveDataEnabled = Boolean(config.twelveDataApiKey);
if (!twelveDataEnabled) {
  console.warn('[twelvedata] TWELVE_DATA_API_KEY no configurada — precios automáticos deshabilitados');
}

export interface ProviderSymbol {
  /** Símbolo con el que se piden precios (ej: AAPL, BTC/USD). */
  symbol: string;
  name: string;
  /** Bolsa (ej: NASDAQ). Null para cripto. */
  exchange: string | null;
  /** Moneda de cotización (ej: USD). */
  currency: string;
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

async function searchStocks(kind: 'ACCION' | 'ETF', query: string): Promise<ProviderSymbol[]> {
  const data = await cached(`search:${query.toUpperCase()}`, SEARCH_TTL_MS, () =>
    tdGet<{ data: SymbolSearchRow[] }>('/symbol_search', { symbol: query, outputsize: '120' }),
  );
  const allowed = INSTRUMENT_TYPES[kind];
  return (data.data ?? [])
    .filter((row) => row.country === 'United States' && allowed.includes(row.instrument_type))
    .slice(0, 30)
    .map((row) => ({
      symbol: row.symbol,
      name: row.instrument_name,
      exchange: row.exchange || null,
      currency: row.currency || 'USD',
    }));
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
    .map((row) => ({
      symbol: row.symbol,
      name: row.currency_base,
      exchange: null,
      currency: 'USD',
    }));
}

export function searchSymbols(kind: 'ACCION' | 'ETF' | 'CRIPTO', query: string): Promise<ProviderSymbol[]> {
  return kind === 'CRIPTO' ? searchCrypto(query) : searchStocks(kind, query);
}

// --- Precios (endpoints de mercado, 1 crédito por símbolo) ---

interface PriceRow {
  price?: string;
}

/** Último precio de un símbolo. Lanza si el símbolo no existe o no hay créditos. */
export async function fetchPrice(symbol: string): Promise<number> {
  const data = await tdGet<PriceRow>('/price', { symbol });
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Twelve Data no devolvió precio para ${symbol}`);
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
export async function fetchPrices(symbols: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const unique = [...new Set(symbols)];
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
        if (Number.isFinite(price) && price > 0) result.set(symbol, price);
        else console.warn(`[twelvedata] Sin precio para ${symbol}`);
      }
    } catch (err) {
      console.error(`[twelvedata] Error pidiendo precios de ${chunk.join(',')}:`, err);
    }
  }
  return result;
}

export interface DailyClose {
  date: Date;
  price: number;
}

/**
 * Cierres diarios del último año (para el backfill del histórico al vincular).
 * 1 crédito. Devuelve en orden cronológico ascendente.
 */
export async function fetchDailyCloses(symbol: string, outputsize = 365): Promise<DailyClose[]> {
  const data = await tdGet<{ values?: Array<{ datetime: string; close: string }> }>('/time_series', {
    symbol,
    interval: '1day',
    outputsize: String(outputsize),
  });
  return (data.values ?? [])
    .map((row) => ({ date: new Date(`${row.datetime}T00:00:00.000Z`), price: Number(row.close) }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0 && !Number.isNaN(row.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
