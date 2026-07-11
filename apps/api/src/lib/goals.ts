function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ahorro neto de una meta: aportes (Transaction EXPENSE vinculada) menos retiros (Transaction
 * INCOME vinculada). Ambos tipos usan `goalId` para no ensuciar los agregados de gasto/ingreso
 * (ver spec 08 — "Metas: aportes que no ensucian reportes"); acá se recombinan para saber cuánto
 * queda efectivamente ahorrado.
 */
export function netSaved(contributed: number, withdrawn: number): number {
  return round2(contributed - withdrawn);
}

/**
 * Recalcula `achievedAt` según el ahorro y el objetivo vigentes: se marca lograda (conservando la
 * fecha si ya lo estaba, o con la fecha actual si es la primera vez) al alcanzar el objetivo, y se
 * limpia si el ahorro cae por debajo — tras subir el objetivo en una edición, o tras un retiro que
 * deja la meta bajo el objetivo otra vez.
 */
export function resolveAchievedAt(currentAchievedAt: Date | null, saved: number, target: number): Date | null {
  if (saved < target) return null;
  return currentAchievedAt ?? new Date();
}
