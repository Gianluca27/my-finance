import { utcDateClamped } from './dates';
import { round2 } from './debts';

/**
 * Deudas en cuotas (spec 17). El cronograma se DERIVA de tres campos persistidos
 * (`installmentCount`, `installmentAmount`, `firstDueDate`) más la suma de pagos:
 * nunca se persiste. Editar esos campos regenera el cronograma completo — las cuotas
 * pagadas se recalculan contra los pagos ya registrados (documentado en la spec).
 */

/** Plan de cuotas ya normalizado a números (los routes convierten los Decimal de Prisma). */
export interface InstallmentPlan {
  totalAmount: number;
  installmentCount: number;
  /** Monto por cuota; null = derivar `totalAmount / installmentCount`. */
  installmentAmount: number | null;
  firstDueDate: Date;
}

/** Una cuota del cronograma derivado. */
export interface InstallmentScheduleItem {
  n: number;
  dueDate: Date;
  amount: number;
  paid: boolean;
}

/** Forma estructural de un `Debt` de Prisma (Decimal con `toNumber()`), sin importar el cliente. */
interface DebtLike {
  totalAmount: { toNumber(): number };
  installmentCount: number | null;
  installmentAmount: { toNumber(): number } | null;
  firstDueDate: Date | null;
}

/** Plan de cuotas de una deuda, o null si es una deuda simple (campos en null). */
export function planFromDebt(debt: DebtLike): InstallmentPlan | null {
  if (debt.installmentCount == null || debt.firstDueDate == null) return null;
  return {
    totalAmount: debt.totalAmount.toNumber(),
    installmentCount: debt.installmentCount,
    installmentAmount: debt.installmentAmount?.toNumber() ?? null,
    firstDueDate: debt.firstDueDate,
  };
}

/** Monto de referencia por cuota: el explícito o `totalAmount / count` redondeado a 2. */
export function perInstallmentAmount(plan: InstallmentPlan): number {
  return plan.installmentAmount ?? round2(plan.totalAmount / plan.installmentCount);
}

/** Monto de la cuota `n`: todas iguales salvo la última, que ajusta contra el total. */
export function installmentAmountAt(plan: InstallmentPlan, n: number): number {
  const per = perInstallmentAmount(plan);
  if (n < plan.installmentCount) return per;
  return round2(plan.totalAmount - per * (plan.installmentCount - 1));
}

/** Vencimiento de la cuota `n`: `firstDueDate + (n−1)` meses, mismo día con clamp a fin de
 * mes — siempre relativo al día original (31 → 28/30 solo en meses cortos, no se arrastra). */
export function installmentDueDate(firstDueDate: Date, n: number): Date {
  return utcDateClamped(
    firstDueDate.getUTCFullYear(),
    firstDueDate.getUTCMonth() + (n - 1),
    firstDueDate.getUTCDate(),
  );
}

/**
 * Cuotas completamente cubiertas por lo pagado: `floor(Σ pagos / monto por cuota)`.
 * Un pago parcial no avanza el contador hasta completar el monto de la cuota. La última cuota
 * ajusta contra el total (puede ser mayor o menor que `per`), así que solo cuenta como pagada
 * cuando lo pagado cubre el total completo — nunca por el floor sobre `per`.
 */
export function paidInstallmentsCount(plan: InstallmentPlan, paid: number): number {
  const paidRounded = round2(paid);
  if (paidRounded >= round2(plan.totalAmount)) return plan.installmentCount;
  const per = perInstallmentAmount(plan);
  if (per <= 0) return 0;
  // Épsilon contra ruido de punto flotante en la suma de pagos (299.999…94 cuenta como 3 cuotas).
  return Math.min(plan.installmentCount - 1, Math.floor(paidRounded / per + 1e-9));
}

/** Cronograma derivado completo dado lo ya pagado. */
export function buildSchedule(plan: InstallmentPlan, paid: number): InstallmentScheduleItem[] {
  const paidCount = paidInstallmentsCount(plan, paid);
  return Array.from({ length: plan.installmentCount }, (_, i) => {
    const n = i + 1;
    return {
      n,
      dueDate: installmentDueDate(plan.firstDueDate, n),
      amount: installmentAmountAt(plan, n),
      paid: n <= paidCount,
    };
  });
}

/** Próxima cuota impaga del cronograma, o null si están todas pagas. */
export function nextInstallment(schedule: InstallmentScheduleItem[]): InstallmentScheduleItem | null {
  return schedule.find((item) => !item.paid) ?? null;
}

/**
 * Valida la coherencia de los campos de cuotas ya mergeados (create, o update sobre lo
 * existente). Devuelve el mensaje de error o null si es válido. Reglas:
 * - Los tres en null = deuda simple, válida.
 * - Si hay alguno, count y firstDueDate son obligatorios (amount es opcional: default total/count).
 * - `amount × count` no tiene que igualar el total (la última cuota ajusta), pero las primeras
 *   `count − 1` cuotas no pueden cubrir ya el total: la última quedaría en cero o negativa.
 */
export function installmentPlanError(fields: {
  totalAmount: number;
  installmentCount: number | null;
  installmentAmount: number | null;
  firstDueDate: Date | null;
}): string | null {
  const { totalAmount, installmentCount: count, installmentAmount: amount, firstDueDate } = fields;
  if (count == null && amount == null && firstDueDate == null) return null;
  if (count == null || firstDueDate == null) {
    return 'Una deuda en cuotas requiere cantidad de cuotas y primer vencimiento';
  }
  if (amount != null && round2(amount * (count - 1)) >= totalAmount) {
    return 'El monto por cuota no es coherente con el total: la última cuota quedaría en cero o negativa';
  }
  return null;
}
