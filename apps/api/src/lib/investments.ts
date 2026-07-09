/** Tolerancia para comparar cantidades (evita falsos negativos por flotantes). */
const QTY_EPS = 1e-8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/** Operación en números planos (los Decimal de Prisma se convierten antes). */
export interface PositionOp {
  type: 'COMPRA' | 'VENTA';
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
  pnl: number;
  pnlPercent: number;
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
  return {
    quantity: round8(position.quantity),
    avgCost: round8(position.avgCost),
    investedCost: round2(investedCost),
    currentValue: round2(currentValue),
    pnl: round2(pnl),
    pnlPercent: investedCost > 0 ? round2((pnl / investedCost) * 100) : 0,
    operationCount: ops.length,
  };
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
