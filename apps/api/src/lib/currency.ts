/**
 * Conversión de montos entre monedas de cuenta y la moneda base del usuario
 * (spec 19, fase A). Pensado para reusarse en deudas, metas, presupuestos y
 * reportes (fases B/C): toda conversión de flujo personal pasa por acá.
 *
 * Semántica de las cotizaciones: cada fila de `ExchangeRate` expresa cuántos
 * pesos argentinos vale 1 unidad de `currency` (ej: USD -> 1300). ARS es la
 * moneda pivote histórica de la app, así que convertir entre dos monedas
 * cualesquiera pivotea por ARS: monto × rate(origen) / rate(destino).
 */

/**
 * Cotización usada para el dólar en flujos personales (cuentas, transferencias,
 * consolidación del dashboard): el MEP (`USDMEP`, mantenido por el cron de
 * data912) refleja mejor el dólar al que una persona realmente compra/vende
 * que el oficial (`USD`, Twelve Data). Si no hay MEP cargado (ej: data912
 * deshabilitado) se cae al oficial. Decisión de spec 19 — a diferencia de
 * Inversiones, que valúa activos USD con la fila `USD` tal cual.
 */
export const PERSONAL_USD_RATE = 'USDMEP';

/** Moneda pivote de las cotizaciones: `ExchangeRate.rate` está en ARS por unidad. */
export const PIVOT_CURRENCY = 'ARS';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cotización de `currency` en ARS (pivote), o null si no hay dato cargado. */
function rateToPivot(currency: string, rates: Map<string, number>): number | null {
  if (currency === PIVOT_CURRENCY) return 1;
  if (currency === 'USD') return rates.get(PERSONAL_USD_RATE) ?? rates.get('USD') ?? null;
  return rates.get(currency) ?? null;
}

/**
 * Convierte `amount` de `currency` a `baseCurrency` con las cotizaciones
 * vigentes. Devuelve `null` si falta la cotización de alguna de las dos puntas:
 * el caller excluye ese monto del total y reporta la moneda en `missingRates`
 * (patrón de `buildInvestmentsSummary`).
 */
export function convertToBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  rates: Map<string, number>,
): number | null {
  if (currency === baseCurrency) return amount;
  const from = rateToPivot(currency, rates);
  const to = rateToPivot(baseCurrency, rates);
  if (from === null || to === null) return null;
  return (amount * from) / to;
}

export interface ConsolidatedTotals {
  /** Suma en moneda base de las monedas convertibles (excluye `missingRates`). */
  total: number;
  /** true si algún monto distinto de cero entró convertido desde otra moneda. */
  converted: boolean;
  /** Monedas sin cotización cargada, excluidas del total. Ordenadas. */
  missingRates: string[];
}

/**
 * Consolida un mapa de montos por moneda a la moneda base. Las monedas sin
 * cotización quedan fuera del total y se reportan en `missingRates`.
 */
export function consolidateToBase(
  amountsByCurrency: ReadonlyMap<string, number>,
  baseCurrency: string,
  rates: Map<string, number>,
): ConsolidatedTotals {
  let total = 0;
  let converted = false;
  const missing = new Set<string>();
  for (const [currency, amount] of amountsByCurrency) {
    const inBase = convertToBase(amount, currency, baseCurrency, rates);
    if (inBase === null) {
      missing.add(currency);
      continue;
    }
    if (currency !== baseCurrency && amount !== 0) converted = true;
    total += inBase;
  }
  return { total: round2(total), converted, missingRates: Array.from(missing).sort() };
}
