import { HttpError } from '../middleware/error';
import { prisma } from '../prisma';

/** Cuenta por defecto del usuario (isDefault, o la más antigua). Lanza si no tiene ninguna. */
export async function getDefaultAccountId(userId: string): Promise<string> {
  const def =
    (await prisma.account.findFirst({ where: { userId, isDefault: true } })) ??
    (await prisma.account.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }));
  if (!def) throw new HttpError(400, 'No tenés ninguna cuenta. Creá una primero.');
  return def.id;
}

/** Resuelve el accountId a usar: el pedido (validando propiedad) o la cuenta por defecto. */
export async function resolveAccountId(userId: string, requested?: string | null): Promise<string> {
  if (requested) {
    const acc = await prisma.account.findFirst({ where: { id: requested, userId } });
    if (!acc) throw new HttpError(400, 'Cuenta inválida');
    return acc.id;
  }
  return getDefaultAccountId(userId);
}
