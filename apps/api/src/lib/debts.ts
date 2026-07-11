import type { DebtDirection } from '@prisma/client';
import { prisma } from '../prisma';

/** Redondeo a 2 decimales (evita arrastre de errores de punto flotante en sumas de pagos). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Saldo restante de una deuda: total menos lo ya pagado (nunca negativo). */
export function remainingBalance(totalAmount: number, paid: number): number {
  return Math.max(0, round2(totalAmount - paid));
}

/** Suma de los pagos (transacciones) vinculados a una deuda. */
export async function getPaidAmount(debtId: string): Promise<number> {
  const result = await prisma.transaction.aggregate({ where: { debtId }, _sum: { amount: true } });
  return result._sum.amount?.toNumber() ?? 0;
}

/** Ventana de recordatorio de vencimiento de deudas (días antes), constante global — ver spec 09.
 * A diferencia de RecurringExpense, en esta fase no es configurable por deuda (viene con cuotas). */
export const DEBT_REMINDER_DAYS_BEFORE = 3;

/** Días enteros entre `today` y `dueDate` (positivo = todavía falta, negativo = ya vencida). */
export function daysUntil(dueDate: Date, today: Date): number {
  return Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Corresponde recordatorio si el vencimiento está a <= `thresholdDays` — incluye deudas ya
 * vencidas, porque a diferencia de un recurrente la deuda no tiene un próximo período que la
 * reemplace — y todavía no se avisó para este vencimiento exacto. Si el usuario edita `dueDate`,
 * el valor guardado en `lastRemindedFor` deja de coincidir y el recordatorio se vuelve a habilitar.
 */
export function isDebtReminderDue(
  dueDate: Date,
  lastRemindedFor: Date | null,
  today: Date,
  thresholdDays: number = DEBT_REMINDER_DAYS_BEFORE,
): boolean {
  if (daysUntil(dueDate, today) > thresholdDays) return false;
  if (lastRemindedFor && lastRemindedFor.getTime() === dueDate.getTime()) return false;
  return true;
}

/**
 * Texto del recordatorio según la dirección: I_OWE avisa que hay que pagar la deuda propia;
 * OWED_TO_ME avisa que vence lo que le deben al usuario (cobrar).
 */
export function debtReminderContent(debt: {
  direction: DebtDirection;
  counterparty: string;
  dueDate: Date;
  remainingBalance: number;
}): { title: string; body: string } {
  const dueStr = debt.dueDate.toISOString().slice(0, 10);
  const amount = debt.remainingBalance.toFixed(2);
  if (debt.direction === 'I_OWE') {
    return {
      title: `Deuda por vencer: ${debt.counterparty}`,
      body: `Tu deuda con ${debt.counterparty} vence el ${dueStr}, restan $${amount}.`,
    };
  }
  return {
    title: `Cobro por vencer: ${debt.counterparty}`,
    body: `${debt.counterparty} te debe y vence el ${dueStr}, restan $${amount} por cobrar.`,
  };
}
