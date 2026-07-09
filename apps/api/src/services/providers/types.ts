/**
 * Contrato común de los proveedores de precios.
 *
 * El cron y las rutas nunca nombran un proveedor concreto: piden por
 * `providerSource` y el registry (`./index`) resuelve el adapter.
 *
 * Los uniones se declaran acá y no se importan de `@myfinance/shared` porque el
 * tsconfig de la API tiene `rootDir: src`. Espejan `packages/shared/src/types.ts`.
 */

export type ProviderSource = 'TWELVE_DATA' | 'DATA912';

/** Mercado dentro de data912. Null para Twelve Data. */
export type ProviderMarket = 'stocks' | 'cedears' | 'bonds' | 'notes' | 'corp';

export type SymbolSearchKind = 'ACCION' | 'ETF' | 'CRIPTO' | 'CEDEAR' | 'BONO';

/** Renta fija argentina: cotiza cada 100 nominales. */
export const FIXED_INCOME_MARKETS: readonly ProviderMarket[] = ['bonds', 'notes', 'corp'];

/** Nominales que cubre un precio cotizado en un mercado dado. */
export function priceFactorFor(market: ProviderMarket | null): number {
  return market !== null && FIXED_INCOME_MARKETS.includes(market) ? 100 : 1;
}

/** Identifica un instrumento dentro de un proveedor. */
export interface SymbolRef {
  symbol: string;
  market: ProviderMarket | null;
}

/**
 * Clave de un ref en los `Map` de precios. El mercado forma parte de la clave
 * porque el mismo ticker podría existir en dos listados de data912.
 */
export function refKey(ref: SymbolRef): string {
  return `${ref.market ?? ''}:${ref.symbol}`;
}

export interface ProviderSymbol {
  /** Símbolo con el que se piden precios (ej: AAPL, BTC/USD, AL30D). */
  symbol: string;
  /** data912 no publica nombres: sus adapters caen al propio símbolo. */
  name: string;
  exchange: string | null;
  /** Moneda sugerida para prellenar el formulario. */
  currency: string;
  source: ProviderSource;
  market: ProviderMarket | null;
  priceFactor: number;
}

export interface DailyClose {
  date: Date;
  price: number;
}

export interface PriceProvider {
  readonly source: ProviderSource;
  readonly enabled: boolean;
  /** Nombre para mensajes de error al usuario. */
  readonly label: string;
  /** Si este proveedor tiene cobertura para el tipo de activo. */
  covers(kind: SymbolSearchKind): boolean;
  search(kind: SymbolSearchKind, query: string): Promise<ProviderSymbol[]>;
  /** Último precio. Lanza si el símbolo no existe o el proveedor falla. */
  fetchPrice(ref: SymbolRef): Promise<number>;
  /** Precios de varios símbolos. Los que fallan se omiten del resultado. Clave: `refKey`. */
  fetchPrices(refs: SymbolRef[]): Promise<Map<string, number>>;
  /** Cierres diarios en orden cronológico. `[]` si el mercado no tiene histórico. */
  fetchDailyCloses(ref: SymbolRef): Promise<DailyClose[]>;
}

/** Días de histórico que se backfillean al vincular un activo. */
export const BACKFILL_DAYS = 365;
