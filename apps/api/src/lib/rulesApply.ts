import type { TransactionType } from '@prisma/client';
import { matchRuleDetailed, type LoadedRule } from './categoryRules';

/** Recorte de una transacción sin categoría, lo mínimo que necesita el matching. */
export interface UncategorizedTx {
  id: string;
  note: string | null;
  type: TransactionType;
}

/** Un movimiento que matcheó una regla, listo para persistir. */
export interface RuleApplyMatch {
  transactionId: string;
  categoryId: string;
  keyword: string;
}

export interface RuleApplyComputation {
  total: number;
  byRule: Array<{ keyword: string; count: number }>;
  matches: RuleApplyMatch[];
}

/**
 * Aplica las reglas del usuario a transacciones sin categoría y arma el resumen por regla.
 * Pura (sin DB): usada tanto para el `dryRun` (solo lee `total`/`byRule`) como para calcular
 * qué transacciones actualizar al confirmar. El orden de `byRule` sigue la primera aparición.
 * Se agrupa por (keyword, categoría): dos reglas con el mismo keyword pero categorías
 * distintas (una de ingreso y una de gasto) generan entradas separadas, no se mezclan.
 */
export function computeRuleMatches(rules: LoadedRule[], transactions: UncategorizedTx[]): RuleApplyComputation {
  const matches: RuleApplyMatch[] = [];
  const counts = new Map<string, { keyword: string; count: number }>();
  for (const tx of transactions) {
    const rule = matchRuleDetailed(rules, tx.note, tx.type);
    if (!rule) continue;
    matches.push({ transactionId: tx.id, categoryId: rule.categoryId, keyword: rule.keyword });
    // El id de categoría no puede contener "\0"; la clave compuesta no colisiona.
    const key = `${rule.categoryId}\0${rule.keyword}`;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { keyword: rule.keyword, count: 1 });
  }
  return { total: matches.length, byRule: [...counts.values()], matches };
}
