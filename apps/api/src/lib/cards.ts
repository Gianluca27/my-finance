import { prisma } from '../prisma';
import { utcDateClamped } from './dates';

/**
 * Ciclos de tarjeta de crédito (spec 20). El ciclo es DERIVADO, nunca persistido
 * (mismo patrón que el cronograma de deudas en cuotas): el resumen que cierra en
 * la fecha C incluye las transacciones en (cierre anterior, C], con el día de
 * cierre clampeado a fin de mes como `advanceDueDate` (día 31 → 30/28).
 */

/** Días de anticipación del recordatorio de vencimiento del resumen (patrón spec 09). */
export const CARD_REMINDER_DAYS_BEFORE = 3;

/** Umbral fijo de la alerta de límite: consumo del ciclo >= 80% de creditLimit
 * (mismo default que Budget.alertThreshold; en esta fase no es configurable). */
export const CARD_LIMIT_ALERT_THRESHOLD = 80;

export interface CardCycle {
  /** Primer día del ciclo (medianoche UTC): el día siguiente al cierre anterior. */
  start: Date;
  /** Fecha de cierre del ciclo (medianoche UTC). Los consumos de ese día ENTRAN al ciclo. */
  closing: Date;
  /** Primer instante excluido (medianoche UTC del día siguiente al cierre): límite
   * superior half-open para consultas por rango (`date >= start AND date < end`),
   * necesario porque las transacciones pueden tener hora intra-día. */
  end: Date;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Medianoche UTC del día de `date` (descarta la hora). */
function dayOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Ciclo cuyo cierre es exactamente `closing` (que debe ser una fecha de cierre válida
 * para `closingDay`, es decir el día clampeado de su mes). */
function cycleClosingAt(closingDay: number, closing: Date): CardCycle {
  const prevClosing = utcDateClamped(closing.getUTCFullYear(), closing.getUTCMonth() - 1, closingDay);
  return { start: addDays(prevClosing, 1), closing, end: addDays(closing, 1) };
}

/**
 * Ciclo vigente en `ref`: cierra en la primera fecha de cierre >= el día de `ref`
 * (el día del cierre todavía pertenece al ciclo que cierra; los consumos del día
 * siguiente caen al próximo).
 */
export function currentCycle(closingDay: number, ref: Date): CardCycle {
  const refDay = dayOf(ref);
  let closing = utcDateClamped(refDay.getUTCFullYear(), refDay.getUTCMonth(), closingDay);
  if (closing < refDay) {
    closing = utcDateClamped(refDay.getUTCFullYear(), refDay.getUTCMonth() + 1, closingDay);
  }
  return cycleClosingAt(closingDay, closing);
}

/** Último ciclo cerrado antes de `ref` (el anterior al vigente). */
export function previousCycle(closingDay: number, ref: Date): CardCycle {
  const current = currentCycle(closingDay, ref);
  // El cierre anterior es, por construcción, el día previo al inicio del ciclo vigente.
  return cycleClosingAt(closingDay, addDays(current.start, -1));
}

/**
 * Vencimiento del resumen que cierra en `closing`: el `paymentDay` del mismo mes si
 * paymentDay > closingDay, o del mes siguiente si paymentDay <= closingDay (el pago
 * siempre es posterior al cierre). Clamp a fin de mes en ambos casos. Se compara
 * contra el `closingDay` configurado, no contra el día clampeado del cierre.
 */
export function paymentDateFor(closing: Date, closingDay: number, paymentDay: number): Date {
  const monthOffset = paymentDay > closingDay ? 0 : 1;
  return utcDateClamped(closing.getUTCFullYear(), closing.getUTCMonth() + monthOffset, paymentDay);
}

/**
 * Próximo vencimiento de pago >= el día de `ref`: el del último resumen cerrado si
 * todavía no pasó; si ya venció, el del ciclo vigente (que aún no cerró).
 */
export function nextPaymentDate(closingDay: number, paymentDay: number, ref: Date): Date {
  const refDay = dayOf(ref);
  const prevPayment = paymentDateFor(previousCycle(closingDay, ref).closing, closingDay, paymentDay);
  if (prevPayment >= refDay) return prevPayment;
  return paymentDateFor(currentCycle(closingDay, ref).closing, closingDay, paymentDay);
}

/**
 * Consumo neto del ciclo en la moneda de la cuenta: gastos menos ingresos
 * (reintegros/ajustes) del rango. Las transferencias (pagos del resumen) no son
 * transacciones, así que no restan consumo — cancelan deuda vía el balance.
 */
export async function cardCycleSpent(accountId: string, cycle: CardCycle): Promise<number> {
  const rows = await prisma.transaction.groupBy({
    by: ['type'],
    where: { accountId, date: { gte: cycle.start, lt: cycle.end } },
    _sum: { amount: true },
  });
  let total = 0;
  for (const row of rows) {
    const amount = row._sum.amount?.toNumber() ?? 0;
    total += row.type === 'EXPENSE' ? amount : -amount;
  }
  return round2(total);
}
