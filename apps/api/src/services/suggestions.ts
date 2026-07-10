import type { Prisma } from '@prisma/client';
import {
  detectRecurringCandidates,
  detectRuleCandidates,
  matchesExistingRecurring,
  type TxnLike,
} from '../lib/suggestions';
import { prisma } from '../prisma';

/** Ventana de historial analizada. Anual queda fuera de alcance (necesitaría >2 años). */
const HISTORY_MONTHS = 6;

/**
 * Corre la detección de patrones para un usuario y sincroniza la tabla Suggestion:
 * - crea las sugerencias nuevas (fingerprint inexistente),
 * - actualiza el payload de las pendientes (los montos cambian con el tiempo),
 * - borra las pendientes cuyo patrón ya no se detecta (ej: el usuario creó el
 *   recurrente/regla a mano). ACCEPTED y DISMISSED nunca se tocan: son la memoria
 *   de qué no volver a sugerir.
 * Devuelve cuántas sugerencias nuevas se crearon.
 */
export async function refreshSuggestionsForUser(userId: string): Promise<number> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - HISTORY_MONTHS);

  const [txns, existingRecurring, existingRules, categories] = await Promise.all([
    // Pagos de deudas y aportes a metas quedan afuera: ya tienen su propia entidad.
    prisma.transaction.findMany({
      where: { userId, date: { gte: since }, debtId: null, goalId: null },
      select: { note: true, amount: true, date: true, type: true, categoryId: true },
      orderBy: { date: 'asc' },
    }),
    prisma.recurringExpense.findMany({ where: { userId }, select: { name: true } }),
    prisma.categoryRule.findMany({ where: { userId }, select: { keyword: true } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);

  const history: TxnLike[] = txns.map((t) => ({ ...t, amount: t.amount.toNumber() }));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const nameOf = (id: string | null) => (id ? (categoryNames.get(id) ?? null) : null);

  const recurring = detectRecurringCandidates(history).filter(
    (c) => !matchesExistingRecurring(c.name, existingRecurring),
  );
  const rules = detectRuleCandidates(history, existingRules);

  const detected: Array<{ type: 'RECURRING' | 'RULE'; fingerprint: string; payload: Prisma.InputJsonValue }> = [
    ...recurring.map((c) => ({
      type: 'RECURRING' as const,
      fingerprint: c.fingerprint,
      payload: {
        name: c.name,
        type: c.type,
        amount: c.amount,
        frequency: c.frequency,
        dueDay: c.dueDay,
        dueMonth: c.dueMonth,
        categoryId: c.categoryId,
        categoryName: nameOf(c.categoryId),
        occurrences: c.occurrences,
        lastDate: c.lastDate.toISOString(),
      },
    })),
    ...rules.map((c) => ({
      type: 'RULE' as const,
      fingerprint: c.fingerprint,
      payload: {
        keyword: c.keyword,
        categoryId: c.categoryId,
        categoryName: nameOf(c.categoryId),
        occurrences: c.occurrences,
      },
    })),
  ];

  let created = 0;
  for (const item of detected) {
    const existing = await prisma.suggestion.findUnique({
      where: { userId_type_fingerprint: { userId, type: item.type, fingerprint: item.fingerprint } },
    });
    if (!existing) {
      await prisma.suggestion.create({ data: { ...item, userId } });
      created++;
    } else if (existing.status === 'PENDING') {
      await prisma.suggestion.update({ where: { id: existing.id }, data: { payload: item.payload } });
    }
  }

  // Pendientes cuyo patrón desapareció del análisis: ya no aplican.
  for (const type of ['RECURRING', 'RULE'] as const) {
    const keep = detected.filter((d) => d.type === type).map((d) => d.fingerprint);
    await prisma.suggestion.deleteMany({
      where: { userId, status: 'PENDING', type, fingerprint: { notIn: keep } },
    });
  }

  return created;
}

/** Corre la detección para todos los usuarios (job nocturno). */
export async function runSuggestionsForAllUsers(): Promise<{ users: number; created: number }> {
  const users = await prisma.user.findMany({ select: { id: true } });
  let created = 0;
  for (const user of users) {
    created += await refreshSuggestionsForUser(user.id);
  }
  return { users: users.length, created };
}
