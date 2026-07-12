import type { Account } from '@prisma/client';
import { HttpError } from '../middleware/error';
import { prisma } from '../prisma';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ReconcileAdjustment {
  /** Tipo de transacción de ajuste a crear. */
  type: 'INCOME' | 'EXPENSE';
  /** Monto (positivo) de la transacción de ajuste. */
  amount: number;
  /** actualBalance − calculatedBalance, con signo (lo que devuelve la API). */
  adjustment: number;
  /** Balance resultante tras aplicar el ajuste (== actualBalance, redondeado a centavos). */
  newBalance: number;
}

/**
 * Calcula el ajuste de saldo necesario para reconciliar el balance calculado (`balancesByAccount`)
 * con el saldo real informado por el usuario. Devuelve null si no hace falta ajustar — coinciden,
 * dentro de la tolerancia de redondeo a centavos — en cuyo caso la API no debe crear ninguna
 * transacción.
 */
export function computeReconcileAdjustment(
  calculatedBalance: number,
  actualBalance: number,
): ReconcileAdjustment | null {
  const diff = round2(actualBalance - calculatedBalance);
  if (diff === 0) return null;
  return {
    type: diff > 0 ? 'INCOME' : 'EXPENSE',
    amount: Math.abs(diff),
    adjustment: diff,
    newBalance: round2(actualBalance),
  };
}

/**
 * Resuelve la cuenta a usar (la pedida, validando propiedad, o la por defecto) y la
 * devuelve completa — los pagos de deuda/aportes de meta necesitan su `currency`
 * para decidir la conversión cross-currency (spec 19, fase B).
 */
export async function resolveAccount(userId: string, requested?: string | null): Promise<Account> {
  if (requested) {
    const acc = await prisma.account.findFirst({ where: { id: requested, userId } });
    if (!acc) throw new HttpError(400, 'Cuenta inválida');
    return acc;
  }
  const def =
    (await prisma.account.findFirst({ where: { userId, isDefault: true } })) ??
    (await prisma.account.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }));
  if (!def) throw new HttpError(400, 'No tenés ninguna cuenta. Creá una primero.');
  return def;
}

/** Resuelve el accountId a usar: el pedido (validando propiedad) o la cuenta por defecto. */
export async function resolveAccountId(userId: string, requested?: string | null): Promise<string> {
  return (await resolveAccount(userId, requested)).id;
}
