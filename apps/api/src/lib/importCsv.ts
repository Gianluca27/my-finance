import type { TransactionType } from '@prisma/client';
import { matchRuleDetailed, type LoadedRule } from './categoryRules';

/** Recorte de una categoría existente, lo mínimo que necesita el matching por nombre+tipo. */
export interface ImportCategoryRef {
  id: string;
  name: string;
  type: TransactionType;
}

/**
 * Cómo se resuelve la categoría de una fila del CSV, en orden de prioridad:
 * 1. El CSV trae un nombre de categoría que ya existe (`existing`).
 * 2. El CSV trae un nombre que no existe: se creará una categoría nueva (`toCreate`); `key`
 *    identifica la categoría a crear (agrupa filas repetidas del mismo nombre+tipo).
 * 3. El CSV no trae categoría (o dice "Sin categoría") pero la nota matchea una regla del
 *    usuario (`rule`).
 * 4. Ninguna de las anteriores (`none`): el movimiento se importa sin categoría.
 */
export type ImportCategoryResolution =
  | { kind: 'existing'; categoryId: string; label: string }
  | { kind: 'toCreate'; key: string; label: string }
  | { kind: 'rule'; categoryId: string; label: string }
  | { kind: 'none'; label: string };

export interface ParsedImportRow {
  /** Línea del archivo, 1-indexada (incluye encabezado si lo hay). */
  line: number;
  type: TransactionType;
  amount: number;
  date: Date;
  note: string | null;
  category: ImportCategoryResolution;
}

export interface CategoryToCreate {
  /** `${type}:${name en minúsculas}` — misma clave que agrupa las filas que la referencian. */
  key: string;
  name: string;
  type: TransactionType;
}

export interface ParsedImportResult {
  /** Filas de datos procesadas (válidas + con error). No cuenta encabezado ni líneas vacías. */
  total: number;
  /** Filas válidas, listas para insertar (o para mostrar en el preview). */
  rows: ParsedImportRow[];
  /** Detalle de errores por fila (línea 1-indexada + motivo). Lista completa, sin límite. */
  errors: Array<{ line: number; reason: string }>;
  /** Líneas ignoradas: encabezado y líneas en blanco. */
  skipped: number;
  /** Categorías nuevas a crear (una entrada por nombre+tipo distinto, sin duplicados). */
  categoriesToCreate: CategoryToCreate[];
}

/** Parsea una línea CSV (comillas dobles, comas y comillas escapadas ""). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parsea y valida el CSV de importación de movimientos, sin tocar la base. Pura: la usan tanto
 * el `dryRun` (preview, solo lee el resultado) como el import real (que además crea las
 * `categoriesToCreate` y persiste `rows`). Mismo formato que exporta la app —
 * `fecha,tipo,monto,categoria,nota,meta`; la columna `meta` se ignora y las columnas se leen por
 * posición, así que un CSV viejo de 5 columnas (sin `meta`) también es válido.
 *
 * Prioridad de resolución de categoría (ver `ImportCategoryResolution`): un nombre explícito en
 * el CSV siempre gana, aunque la nota también matchee una regla — las reglas solo entran en
 * juego cuando la columna categoría viene vacía o dice "Sin categoría".
 */
export function parseImportCsv(
  csv: string,
  existingCategories: ImportCategoryRef[],
  rules: LoadedRule[],
): ParsedImportResult {
  const categoryByKey = new Map<string, ImportCategoryRef>(
    existingCategories.map((c) => [`${c.type}:${c.name.trim().toLowerCase()}`, c]),
  );
  const toCreateByKey = new Map<string, CategoryToCreate>();

  const rawLines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const errors: Array<{ line: number; reason: string }> = [];
  const rows: ParsedImportRow[] = [];
  let skipped = 0;

  rawLines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    if (rawLine.trim() === '') {
      skipped++;
      return;
    }
    const cols = parseCsvLine(rawLine).map((c) => c.trim());
    // Encabezado (mismo formato que la exportación)
    if (index === 0 && cols[0]?.toLowerCase() === 'fecha') {
      skipped++;
      return;
    }
    const [fechaStr, tipoStr, montoStr, categoriaStr, notaStr] = cols;

    const date = new Date(fechaStr);
    if (!fechaStr || Number.isNaN(date.getTime())) {
      errors.push({ line: lineNo, reason: 'Fecha inválida' });
      return;
    }
    const tipoNorm = (tipoStr ?? '').toLowerCase();
    const type: TransactionType | null =
      tipoNorm === 'ingreso' ? 'INCOME' : tipoNorm === 'gasto' ? 'EXPENSE' : null;
    if (!type) {
      errors.push({ line: lineNo, reason: 'Tipo debe ser "ingreso" o "gasto"' });
      return;
    }
    const amount = Number((montoStr ?? '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ line: lineNo, reason: 'Monto inválido' });
      return;
    }
    const note = notaStr ? notaStr.slice(0, 500) : null;

    const categoryName = categoriaStr?.trim();
    let category: ImportCategoryResolution;
    if (categoryName && categoryName.toLowerCase() !== 'sin categoría') {
      const key = `${type}:${categoryName.toLowerCase()}`;
      const existing = categoryByKey.get(key);
      if (existing) {
        category = { kind: 'existing', categoryId: existing.id, label: existing.name };
      } else {
        if (!toCreateByKey.has(key)) toCreateByKey.set(key, { key, name: categoryName, type });
        category = { kind: 'toCreate', key, label: 'se creará' };
      }
    } else {
      const rule = matchRuleDetailed(rules, note, type);
      category = rule
        ? { kind: 'rule', categoryId: rule.categoryId, label: 'regla aplicada' }
        : { kind: 'none', label: 'Sin categoría' };
    }

    rows.push({ line: lineNo, type, amount, date, note, category });
  });

  return {
    total: rows.length + errors.length,
    rows,
    errors,
    skipped,
    categoriesToCreate: [...toCreateByKey.values()],
  };
}
