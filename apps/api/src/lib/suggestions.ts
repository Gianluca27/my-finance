import type { Frequency, TransactionType } from '@prisma/client';

/** Forma mínima de una transacción para el análisis de sugerencias (sin Prisma). */
export interface TxnLike {
  note: string | null;
  amount: number;
  date: Date;
  type: TransactionType;
  categoryId: string | null;
}

export interface RecurringCandidate {
  /** Clave estable del patrón (tipo + tokens ordenados). */
  fingerprint: string;
  name: string;
  type: TransactionType;
  amount: number;
  frequency: Frequency;
  dueDay: number;
  dueMonth: number | null;
  categoryId: string | null;
  occurrences: number;
  lastDate: Date;
}

export interface RuleCandidate {
  fingerprint: string;
  keyword: string;
  categoryId: string;
  occurrences: number;
}

/** Palabras sin valor para identificar un comercio/concepto. */
const STOPWORDS = new Set([
  'de', 'la', 'el', 'en', 'y', 'a', 'del', 'los', 'las', 'con', 'para', 'por',
  'un', 'una', 'unos', 'unas', 'al', 'lo', 'mi', 'su', 'se', 'que',
]);

/** Mínimo de ocurrencias de un patrón para sugerir un recurrente. */
const MIN_RECURRING_OCCURRENCES = 3;
/** Tolerancia de variación del monto respecto de la mediana (±15%). */
const AMOUNT_TOLERANCE = 0.15;
/** Mínimo de transacciones con un token para sugerir una regla. */
const MIN_RULE_OCCURRENCES = 4;
/** Proporción mínima de la categoría dominante para sugerir una regla. */
const MIN_RULE_DOMINANCE = 0.9;
/** Peso y confianza mínimos para sugerir categoría desde el historial. */
const MIN_CATEGORY_WEIGHT = 2;
const MIN_CATEGORY_CONFIDENCE = 0.6;

/**
 * Tokeniza una nota: minúsculas, sin acentos, sin números ni símbolos,
 * sin stopwords ni tokens de menos de 3 letras. Sin duplicados.
 */
export function normalizeNote(note: string | null | undefined): string[] {
  if (!note) return [];
  const clean = note
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ');
  const seen = new Set<string>();
  for (const token of clean.split(' ')) {
    if (token.length < 3 || STOPWORDS.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/** Clave de agrupación: tokens ordenados, para que el orden de palabras no importe. */
export function noteKey(note: string | null | undefined): string {
  return normalizeNote(note).sort().join(' ');
}

/**
 * Sugiere categoría para una nota según el historial: cada transacción pasada
 * del mismo tipo vota por su categoría con peso = tokens compartidos.
 * Devuelve null si la evidencia es débil o ambigua.
 */
export function suggestCategoryFromHistory(
  note: string,
  type: TransactionType,
  history: TxnLike[],
): { categoryId: string; confidence: number } | null {
  const tokens = new Set(normalizeNote(note));
  if (tokens.size === 0) return null;

  const weights = new Map<string, number>();
  for (const past of history) {
    if (past.type !== type || !past.categoryId) continue;
    const shared = normalizeNote(past.note).filter((t) => tokens.has(t)).length;
    if (shared === 0) continue;
    weights.set(past.categoryId, (weights.get(past.categoryId) ?? 0) + shared);
  }
  if (weights.size === 0) return null;

  let topCategory = '';
  let topWeight = 0;
  let total = 0;
  for (const [categoryId, weight] of weights) {
    total += weight;
    if (weight > topWeight) {
      topWeight = weight;
      topCategory = categoryId;
    }
  }
  if (topWeight < MIN_CATEGORY_WEIGHT) return null;
  const confidence = topWeight / total;
  if (confidence < MIN_CATEGORY_CONFIDENCE) return null;
  return { categoryId: topCategory, confidence: Math.round(confidence * 100) / 100 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rangos de intervalo (en días) aceptados por frecuencia. */
const FREQUENCY_RANGES: Array<{ frequency: Frequency; min: number; max: number }> = [
  { frequency: 'WEEKLY', min: 6, max: 8 },
  { frequency: 'MONTHLY', min: 26, max: 35 },
  { frequency: 'YEARLY', min: 330, max: 400 },
];

/**
 * Detecta patrones recurrentes: misma nota normalizada, mismo tipo,
 * >= 3 ocurrencias con intervalos regulares y monto estable (±15% de la mediana).
 */
export function detectRecurringCandidates(txns: TxnLike[]): RecurringCandidate[] {
  const groups = new Map<string, TxnLike[]>();
  for (const t of txns) {
    const key = noteKey(t.note);
    if (!key) continue;
    const fingerprint = `${t.type}:${key}`;
    const group = groups.get(fingerprint);
    if (group) group.push(t);
    else groups.set(fingerprint, [t]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [fingerprint, group] of groups) {
    if (group.length < MIN_RECURRING_OCCURRENCES) continue;
    group.sort((a, b) => a.date.getTime() - b.date.getTime());

    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      intervals.push((group[i].date.getTime() - group[i - 1].date.getTime()) / 86_400_000);
    }
    const medianInterval = median(intervals);
    const range = FREQUENCY_RANGES.find((r) => medianInterval >= r.min && medianInterval <= r.max);
    if (!range) continue;
    if (!intervals.every((d) => d >= range.min && d <= range.max)) continue;

    const amounts = group.map((t) => t.amount);
    const medianAmount = median(amounts);
    if (medianAmount <= 0) continue;
    if (!amounts.every((a) => Math.abs(a - medianAmount) / medianAmount <= AMOUNT_TOLERANCE)) continue;

    const last = group[group.length - 1];
    const dueDay =
      range.frequency === 'WEEKLY'
        ? last.date.getUTCDay()
        : Math.round(median(group.map((t) => t.date.getUTCDate())));

    const categoryCounts = new Map<string, number>();
    for (const t of group) {
      if (t.categoryId) categoryCounts.set(t.categoryId, (categoryCounts.get(t.categoryId) ?? 0) + 1);
    }
    let categoryId: string | null = null;
    let topCount = 0;
    for (const [id, count] of categoryCounts) {
      if (count > topCount) {
        topCount = count;
        categoryId = id;
      }
    }

    candidates.push({
      fingerprint,
      name: (last.note ?? '').trim(),
      type: last.type,
      amount: last.amount,
      frequency: range.frequency,
      dueDay,
      dueMonth: range.frequency === 'YEARLY' ? last.date.getUTCMonth() + 1 : null,
      categoryId,
      occurrences: group.length,
      lastDate: last.date,
    });
  }
  return candidates;
}

/**
 * Detecta tokens categorizados consistentemente (>= 4 usos, >= 90% misma categoría)
 * que todavía no están cubiertos por una regla existente. Cuando varios tokens
 * aparecen siempre en las mismas transacciones, gana el más largo.
 */
export function detectRuleCandidates(
  txns: TxnLike[],
  existingRules: Array<{ keyword: string }>,
): RuleCandidate[] {
  const existing = existingRules
    .map((r) => r.keyword.trim().toLowerCase())
    .filter((k) => k.length > 0);

  const tokenStats = new Map<string, { txnIndices: number[]; categories: Map<string, number> }>();
  txns.forEach((t, index) => {
    if (!t.categoryId) return;
    for (const token of normalizeNote(t.note)) {
      let stats = tokenStats.get(token);
      if (!stats) {
        stats = { txnIndices: [], categories: new Map() };
        tokenStats.set(token, stats);
      }
      stats.txnIndices.push(index);
      stats.categories.set(t.categoryId, (stats.categories.get(t.categoryId) ?? 0) + 1);
    }
  });

  // Agrupados por conjunto de transacciones: tokens que siempre co-ocurren compiten entre sí.
  const bySignature = new Map<string, RuleCandidate & { keywordLength: number }>();
  for (const [token, stats] of tokenStats) {
    const total = stats.txnIndices.length;
    if (total < MIN_RULE_OCCURRENCES) continue;
    let topCategory = '';
    let topCount = 0;
    for (const [categoryId, count] of stats.categories) {
      if (count > topCount) {
        topCount = count;
        topCategory = categoryId;
      }
    }
    if (topCount / total < MIN_RULE_DOMINANCE) continue;
    if (existing.some((kw) => token.includes(kw) || kw.includes(token))) continue;

    const signature = stats.txnIndices.join(',');
    const current = bySignature.get(signature);
    if (!current || token.length > current.keywordLength) {
      bySignature.set(signature, {
        fingerprint: token,
        keyword: token,
        categoryId: topCategory,
        occurrences: total,
        keywordLength: token.length,
      });
    }
  }
  return [...bySignature.values()].map(({ keywordLength: _len, ...candidate }) => candidate);
}

/**
 * Un candidato coincide con un recurrente existente si los tokens de un nombre
 * están contenidos en los del otro (evita sugerir duplicados). El monto no se
 * compara: el importe de un recurrente suele quedar desactualizado.
 */
export function matchesExistingRecurring(
  candidateName: string,
  existing: Array<{ name: string }>,
): boolean {
  const candidateTokens = new Set(normalizeNote(candidateName));
  if (candidateTokens.size === 0) return false;
  return existing.some((e) => {
    const existingTokens = new Set(normalizeNote(e.name));
    if (existingTokens.size === 0) return false;
    const [small, big] =
      candidateTokens.size <= existingTokens.size
        ? [candidateTokens, existingTokens]
        : [existingTokens, candidateTokens];
    return [...small].every((t) => big.has(t));
  });
}
