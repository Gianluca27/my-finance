import type { TransactionType } from '@prisma/client';
import { prisma } from '../prisma';

export interface LoadedRule {
  keyword: string;
  categoryId: string;
  type: TransactionType;
}

/**
 * Carga las reglas de categorización del usuario junto con el tipo de su categoría,
 * ordenadas por keyword más específica (más larga) primero para un match determinista.
 */
export async function loadRules(userId: string): Promise<LoadedRule[]> {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    include: { category: { select: { type: true } } },
  });
  return rules
    .map((r) => ({ keyword: r.keyword.trim().toLowerCase(), categoryId: r.categoryId, type: r.category.type }))
    .filter((r) => r.keyword.length > 0)
    .sort((a, b) => b.keyword.length - a.keyword.length);
}

/** Primera regla cuyo keyword aparezca en la nota y cuyo tipo coincida con el del movimiento. */
export function matchRule(
  rules: LoadedRule[],
  note: string | null | undefined,
  type: TransactionType,
): string | null {
  if (!note) return null;
  const haystack = note.toLowerCase();
  for (const rule of rules) {
    if (rule.type === type && haystack.includes(rule.keyword)) return rule.categoryId;
  }
  return null;
}
