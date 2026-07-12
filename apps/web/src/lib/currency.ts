import type { ExchangeRate } from '@myfinance/shared';
import { formatMoney } from '../api';

/**
 * Espejo cliente de la conversión de `apps/api/src/lib/currency.ts` (rateToPivot /
 * convertToBase) para PREVISUALIZAR conversiones cross-currency en los modales de
 * pago de deuda y aporte/retiro de meta (spec 19, fase B). El servidor es la
 * autoridad al confirmar: convierte con las mismas reglas y persiste el resultado.
 *
 * Semántica: cada `ExchangeRate` expresa cuántos ARS vale 1 unidad de `currency`;
 * para USD en flujo personal se prefiere el MEP (`USDMEP`) con fallback al oficial.
 */
const PERSONAL_USD_RATE = 'USDMEP';
const PIVOT_CURRENCY = 'ARS';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Piso a centavos: para prellenar montos cuyo convertido no debe superar el saldo. */
export function floor2(n: number): number {
  return Math.floor(n * 100) / 100;
}

/** Cotización de `currency` en ARS (pivote), o null si no hay dato cargado. */
function rateToPivot(currency: string, rates: ExchangeRate[]): number | null {
  if (currency === PIVOT_CURRENCY) return 1;
  const find = (code: string) => rates.find((r) => r.currency === code)?.rate ?? null;
  if (currency === 'USD') return find(PERSONAL_USD_RATE) ?? find('USD');
  return find(currency);
}

/** Cuántas unidades de `to` vale 1 unidad de `from` (pivotea por ARS). Null sin cotización. */
export function crossRate(from: string, to: string, rates: ExchangeRate[]): number | null {
  if (from === to) return 1;
  const fromRate = rateToPivot(from, rates);
  const toRate = rateToPivot(to, rates);
  if (fromRate === null || toRate === null) return null;
  return fromRate / toRate;
}

/** Convierte `amount` de `from` a `to`, redondeado a centavos. Null sin cotización. */
export function convertAmount(amount: number, from: string, to: string, rates: ExchangeRate[]): number | null {
  const rate = crossRate(from, to, rates);
  return rate === null ? null : round2(amount * rate);
}

/** TC entre dos monedas en la dirección legible (la unidad que vale ≥ 1),
 * ej: "1 USD ≈ $ 1.200". Null sin cotización cargada. */
export function rateLabel(a: string, b: string, rates: ExchangeRate[]): string | null {
  const rate = crossRate(a, b, rates);
  if (rate === null) return null;
  return rate >= 1 ? `1 ${a} ≈ ${formatMoney(rate, b)}` : `1 ${b} ≈ ${formatMoney(1 / rate, a)}`;
}
