/** Tolerancia para comparar cantidades (evita falsos negativos por flotantes). */
const QTY_EPS = 1e-8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/**
 * Tipo de operación. RENTA (dividendo/cupón/amortización) no mueve la tenencia:
 * se persiste con `quantity` 0 y el monto total cobrado en `unitPrice` (efectivo
 * real, no un precio cotizado). Reusar `unitPrice` evita agregar una columna.
 */
export type OperationType = 'COMPRA' | 'VENTA' | 'RENTA';

/** Operación en números planos (los Decimal de Prisma se convierten antes). */
export interface PositionOp {
  type: OperationType;
  quantity: number;
  unitPrice: number;
}

export interface Position {
  quantity: number;
  /** Costo total de la tenencia actual (a costo promedio ponderado). */
  investedCost: number;
  /** Costo promedio ponderado por unidad. Las ventas no lo alteran. */
  avgCost: number;
}

/**
 * Recorre las operaciones en orden cronológico acumulando cantidad y costo a
 * promedio ponderado. Devuelve `null` si en algún punto una venta supera la
 * tenencia disponible (secuencia inválida).
 */
export function computePosition(ops: PositionOp[]): Position | null {
  let qty = 0;
  let cost = 0;
  for (const op of ops) {
    // RENTA no compra ni vende: no toca tenencia ni costo (ver InvestmentMetrics).
    if (op.type === 'RENTA') continue;
    if (op.type === 'COMPRA') {
      cost += op.quantity * op.unitPrice;
      qty += op.quantity;
    } else {
      if (op.quantity > qty + QTY_EPS) return null;
      const avg = qty > 0 ? cost / qty : 0;
      cost -= avg * op.quantity;
      qty -= op.quantity;
      // Limpia el polvo de flotantes al cerrar la posición completa.
      if (qty < QTY_EPS) {
        qty = 0;
        cost = 0;
      }
    }
  }
  return { quantity: qty, investedCost: cost, avgCost: qty > 0 ? cost / qty : 0 };
}

export interface InvestmentMetrics {
  quantity: number;
  avgCost: number;
  investedCost: number;
  currentValue: number;
  /** P&L por precio (no realizado): currentValue − investedCost. Es el "pnlPrice". */
  pnl: number;
  /** pnl sobre lo invertido, en %. Base precio (la renta no entra acá). */
  pnlPercent: number;
  /** Renta cobrada acumulada (Σ RENTA): dividendos, cupones y amortizaciones, en efectivo real. */
  incomeCollected: number;
  /** Resultado total: pnl (precio) + incomeCollected (renta). */
  pnlTotal: number;
  operationCount: number;
}

/**
 * Métricas calculadas de un activo, en su propia moneda. Si nunca se cargó un
 * precio actual, se valúa al costo promedio (P&L = 0).
 *
 * `priceFactor` son los nominales que cubre un precio cotizado: 1 en acciones,
 * CEDEARs y cripto; 100 en renta fija argentina, que cotiza cada 100 VN. Solo
 * escala los importes: `avgCost` queda en precio cotizado, comparable con
 * `currentPrice`, y `pnlPercent` es un cociente donde el factor se cancela.
 */
export function investmentMetrics(
  currentPrice: number | null,
  ops: PositionOp[],
  priceFactor = 1,
): InvestmentMetrics {
  // Invariante: las escrituras validan la secuencia, así que acá nunca debería
  // ser null; si igual pasa, se reporta la posición como vacía en vez de romper.
  const position = computePosition(ops) ?? { quantity: 0, investedCost: 0, avgCost: 0 };
  const factor = priceFactor > 0 ? priceFactor : 1;
  const effectivePrice = currentPrice ?? position.avgCost;
  const investedCost = position.investedCost / factor;
  const currentValue = (position.quantity * effectivePrice) / factor;
  const pnl = currentValue - investedCost;
  // La renta cobrada es efectivo real ya recibido: se suma tal cual, sin dividir
  // por el factor (a diferencia de investedCost/currentValue, que vienen de un precio cotizado).
  let incomeCollected = 0;
  for (const op of ops) if (op.type === 'RENTA') incomeCollected += op.unitPrice;
  return {
    quantity: round8(position.quantity),
    avgCost: round8(position.avgCost),
    investedCost: round2(investedCost),
    currentValue: round2(currentValue),
    pnl: round2(pnl),
    pnlPercent: investedCost > 0 ? round2((pnl / investedCost) * 100) : 0,
    incomeCollected: round2(incomeCollected),
    pnlTotal: round2(pnl + incomeCollected),
    operationCount: ops.length,
  };
}

/** Operación con fecha, para cortes temporales y flujos de TIR. */
export interface DatedPositionOp extends PositionOp {
  date: Date;
}

/**
 * Tenencia y costo a una fecha de corte: reusa `computePosition` sobre las
 * operaciones con fecha `<= asOf`, en orden cronológico. Una posición válida
 * mantiene la validez en cualquier prefijo (una venta nunca depende de compras
 * posteriores), así que nunca devuelve `null` si la secuencia completa era válida.
 */
export function positionAsOf(ops: DatedPositionOp[], asOf: Date): Position | null {
  const cutoff = asOf.getTime();
  const upTo = ops
    .filter((op) => op.date.getTime() <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return computePosition(upTo);
}

/**
 * Primera RENTA de la secuencia que quedaría sin tenencia a su fecha (`null` si
 * todas tienen tenencia > 0). No se cobra renta de lo que no se tiene: una renta
 * huérfana infla `incomeCollected` y la TIR. Sirve para revalidar la secuencia
 * completa al editar o borrar OTRA operación (mover o eliminar la única compra
 * puede dejar una renta huérfana que `computePosition` no ve, porque ignora la RENTA).
 */
export function firstRentaWithoutHolding(ops: DatedPositionOp[]): DatedPositionOp | null {
  for (const op of ops) {
    if (op.type !== 'RENTA') continue;
    const pos = positionAsOf(ops, op.date);
    if (!pos || pos.quantity <= 0) return op;
  }
  return null;
}

/** Flujo de caja fechado para la TIR: negativo = egreso (compra), positivo = ingreso (venta/valuación). */
export interface CashFlow {
  date: Date;
  amount: number;
}

/**
 * Importe de caja de una operación (en moneda del activo) para la TIR: compra
 * negativa, venta positiva, ambas divididas por `priceFactor` (espacio monetario,
 * igual que `currentValue`). La RENTA entra positiva por su monto total cobrado,
 * sin dividir por el factor (ya es efectivo real, no un precio cotizado).
 */
export function operationCashAmount(op: Pick<PositionOp, 'type' | 'quantity' | 'unitPrice'>, priceFactor = 1): number {
  if (op.type === 'RENTA') return op.unitPrice;
  const factor = priceFactor > 0 ? priceFactor : 1;
  return ((op.type === 'COMPRA' ? -1 : 1) * (op.quantity * op.unitPrice)) / factor;
}

const XIRR_TOLERANCE = 1e-6;
/** Rango mínimo de flujos: por debajo, anualizar amplifica ruido y no es informativo. */
const XIRR_MIN_DAYS = 30;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

/**
 * TIR anualizada (money-weighted / XIRR) de una serie de flujos fechados.
 * Resuelve la tasa `r` que anula `Σ amount_i / (1 + r)^(años_i)` por
 * Newton-Raphson, con bisección de respaldo sobre un bracket acotado.
 *
 * Devuelve `null` si hay menos de dos flujos, el rango es menor a
 * {@link XIRR_MIN_DAYS} días, no hay flujos de ambos signos (la ecuación no
 * tiene raíz) o el método no converge. Es genérica: los flujos de dividendos o
 * cupones se agregan a la lista sin cambiar la firma.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const spanDays = (sorted[sorted.length - 1].date.getTime() - t0) / MS_PER_DAY;
  if (spanDays < XIRR_MIN_DAYS) return null;
  // Sin al menos un flujo positivo y uno negativo la NPV no cruza cero.
  if (!sorted.some((f) => f.amount > 0) || !sorted.some((f) => f.amount < 0)) return null;

  const years = sorted.map((f) => (f.date.getTime() - t0) / (MS_PER_DAY * DAYS_PER_YEAR));
  const npv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) sum += sorted[i].amount / (1 + rate) ** years[i];
    return sum;
  };
  const dNpv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) sum -= (years[i] * sorted[i].amount) / (1 + rate) ** (years[i] + 1);
    return sum;
  };

  // Newton-Raphson desde una tasa razonable.
  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    const value = npv(rate);
    if (Math.abs(value) < XIRR_TOLERANCE) return rate;
    const deriv = dNpv(rate);
    if (!Number.isFinite(deriv) || deriv === 0) break;
    const next = rate - value / deriv;
    // (1 + r) debe ser positivo o las potencias se rompen; si Newton se va, cae a bisección.
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < XIRR_TOLERANCE) return next;
    rate = next;
  }

  // Bisección de respaldo: bracket amplio pero finito (-99.99% a +10000% anual).
  let low = -0.9999;
  let high = 100;
  let fLow = npv(low);
  const fHigh = npv(high);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return null;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < XIRR_TOLERANCE) return mid;
    if (fLow * fMid < 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return null;
}

export interface PricePoint {
  date: Date;
  price: number;
}

/** Tolerancia para "precio en una fecha": cubre fines de semana/feriados sin fingir precisión. */
export const PRICE_LOOKUP_TOLERANCE_DAYS = 5;

/**
 * Busca el punto más cercano a `target` dentro de la tolerancia, para
 * autocompletar el precio de una operación al elegir una fecha pasada. Ante
 * un empate de distancia, gana el punto anterior (dato ya cerrado ese día).
 */
export function closestPriceMatch(points: PricePoint[], target: Date): PricePoint | null {
  const toleranceMs = PRICE_LOOKUP_TOLERANCE_DAYS * 86_400_000;
  let best: PricePoint | null = null;
  let bestDiff = Infinity;
  for (const point of points) {
    const diff = Math.abs(point.date.getTime() - target.getTime());
    if (diff > toleranceMs) continue;
    if (diff < bestDiff || (diff === bestDiff && best !== null && point.date.getTime() < best.date.getTime())) {
      best = point;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Rango de tiempo para el histórico de precios de un activo. Espeja
 * `PriceHistoryRange` de `@myfinance/shared` (no se importa: la API tiene
 * `rootDir: src`, ver `services/providers/types.ts`).
 */
export type PriceHistoryRange = '1w' | '1m' | '3m' | '6m' | 'ytd' | '1y';

export const PRICE_HISTORY_RANGES: readonly PriceHistoryRange[] = ['1w', '1m', '3m', '6m', 'ytd', '1y'];

/** Días atrás por rango, salvo 'ytd' (arranca el 1° de enero UTC del año de `now`). */
const RANGE_DAYS: Record<Exclude<PriceHistoryRange, 'ytd'>, number> = {
  '1w': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/** Fecha de corte (UTC) de un rango: se incluyen los puntos con `date >= cutoff`. */
export function priceHistoryCutoff(range: PriceHistoryRange, now: Date): Date {
  if (range === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY);
}

export interface InvestmentsSummaryData {
  totalInvested: number;
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  missingRates: string[];
}

/**
 * Consolida los totales del portafolio en moneda base usando las cotizaciones
 * vigentes. Los activos en una moneda sin cotización cargada quedan fuera de
 * los totales y su moneda se reporta en `missingRates`.
 */
export function buildInvestmentsSummary(
  items: Array<{ currency: string | null; investedCost: number; currentValue: number }>,
  rates: Map<string, number>,
): InvestmentsSummaryData {
  let totalInvested = 0;
  let totalValue = 0;
  const missing = new Set<string>();
  for (const item of items) {
    const rate = item.currency === null ? 1 : rates.get(item.currency);
    if (rate === undefined) {
      missing.add(item.currency as string);
      continue;
    }
    totalInvested += item.investedCost * rate;
    totalValue += item.currentValue * rate;
  }
  const pnl = totalValue - totalInvested;
  return {
    totalInvested: round2(totalInvested),
    totalValue: round2(totalValue),
    pnl: round2(pnl),
    pnlPercent: totalInvested > 0 ? round2((pnl / totalInvested) * 100) : 0,
    missingRates: Array.from(missing).sort(),
  };
}
