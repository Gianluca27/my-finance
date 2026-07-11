import { shiftMonth } from './dates';

export interface BudgetCarryParams {
  /** Límite mensual fijo del presupuesto. */
  amount: number;
  /** Mes objetivo "YYYY-MM" para el cual se calcula el arrastre entrante. */
  targetMonth: string;
  /**
   * Primer mes "YYYY-MM" a considerar (inclusive): el mayor entre el mes en que
   * se activó el rollover y el tope de 12 meses hacia atrás (ver effectiveStartMonth).
   */
  startMonth: string;
  /** Gasto real (excluye aportes a metas) de un mes "YYYY-MM". */
  spentByMonth: (month: string) => number;
}

/**
 * Arrastre (carry) que entra a `targetMonth` para un presupuesto con rollover.
 *
 * Modelo (spec 16): disponibleEfectivo(m) = amount + carry(m − 1);
 * carry(m) = disponibleEfectivo(m) − gastado(m). El carry puede ser negativo:
 * un exceso descuenta del mes siguiente. Se itera desde `startMonth` hasta el mes
 * anterior a `targetMonth`; si no hay meses previos, el arrastre es 0.
 *
 * Nota: usa el `amount` actual para todos los meses pasados, así que cambiar el
 * límite reescribe la historia del arrastre (semántica conocida y aceptada: todo
 * se deriva de las transacciones, sin snapshots por mes).
 */
export function budgetCarryOver(params: BudgetCarryParams): number {
  const { amount, targetMonth, startMonth, spentByMonth } = params;
  let carry = 0;
  let m = startMonth;
  while (m < targetMonth) {
    const disponible = amount + carry;
    carry = disponible - spentByMonth(m);
    m = shiftMonth(m, 1);
  }
  return carry;
}

/**
 * Primer mes a considerar para el arrastre: el mayor entre el mes en que se
 * activó el rollover (`rolloverStartMonth`) y el tope de 12 meses hacia atrás
 * desde `targetMonth`. El tope acota el costo del cálculo y el peso de datos viejos.
 */
export function effectiveStartMonth(targetMonth: string, rolloverStartMonth: string | null): string {
  const cap = shiftMonth(targetMonth, -12);
  if (!rolloverStartMonth) return cap;
  return rolloverStartMonth > cap ? rolloverStartMonth : cap;
}

/**
 * Porcentaje de uso (0-100+) sobre el límite efectivo. Si el límite efectivo es
 * <= 0 (el exceso arrastrado se comió el mes), cualquier gasto se considera
 * superado (100%).
 */
export function budgetPercentUsed(spent: number, effectiveLimit: number): number {
  if (effectiveLimit > 0) return Math.round((spent / effectiveLimit) * 100);
  return spent > 0 ? 100 : 0;
}
