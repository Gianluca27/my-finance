import type { TransactionType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { LoadedRule } from './categoryRules';
import { parseImportCsv, type ImportCategoryRef } from './importCsv';

const CATEGORIES: ImportCategoryRef[] = [
  { id: 'cat-super', name: 'Supermercado', type: 'EXPENSE' },
  { id: 'cat-sueldo', name: 'Sueldo', type: 'INCOME' },
];

const RULES: LoadedRule[] = [{ keyword: 'spotify', categoryId: 'cat-suscripciones', type: 'EXPENSE' }];

const HEADER = 'fecha,tipo,monto,categoria,nota,meta';

describe('parseImportCsv', () => {
  it('parsea filas válidas con categoría existente (case-insensitive)', () => {
    const csv = [HEADER, '2026-01-05,gasto,1500.50,supermercado,Compra semanal,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.skipped).toBe(1); // encabezado
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.type).toBe('EXPENSE');
    expect(row.amount).toBe(1500.5);
    expect(row.note).toBe('Compra semanal');
    expect(row.category).toEqual({ kind: 'existing', categoryId: 'cat-super', label: 'Supermercado' });
    expect(result.categoriesToCreate).toEqual([]);
    expect(result.total).toBe(1);
  });

  it('categoría del CSV que no existe: se marca para crear, deduplicada entre filas repetidas', () => {
    const csv = [
      HEADER,
      '2026-01-05,gasto,100,Mascotas,Alimento,',
      '2026-01-06,gasto,200,mascotas,Veterinario,',
      '2026-01-07,gasto,300,Mascotas,Juguete,',
    ].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.category.kind).toBe('toCreate');
      if (row.category.kind === 'toCreate') {
        expect(row.category.label).toBe('se creará');
        expect(row.category.key).toBe('EXPENSE:mascotas');
      }
    }
    // Una sola entrada a crear pese a las 3 filas repitiendo el mismo nombre+tipo.
    expect(result.categoriesToCreate).toEqual([{ key: 'EXPENSE:mascotas', name: 'Mascotas', type: 'EXPENSE' }]);
  });

  it('sin categoría en el CSV pero nota matchea una regla', () => {
    const csv = [HEADER, '2026-01-05,gasto,999,,Pago Spotify mensual,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, RULES);
    expect(result.rows[0].category).toEqual({
      kind: 'rule',
      categoryId: 'cat-suscripciones',
      label: 'regla aplicada',
    });
  });

  it('"Sin categoría" (texto de la propia exportación) se trata como blanco y cae a reglas', () => {
    const csv = [HEADER, '2026-01-05,gasto,999,Sin categoría,Pago Spotify mensual,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, RULES);
    expect(result.rows[0].category.kind).toBe('rule');
  });

  it('sin categoría explícita y sin regla que matchee: kind none', () => {
    const csv = [HEADER, '2026-01-05,gasto,999,,Sin relación,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, RULES);
    expect(result.rows[0].category).toEqual({ kind: 'none', label: 'Sin categoría' });
  });

  it('la categoría explícita del CSV tiene prioridad sobre una regla que también matchearía', () => {
    // La nota contiene "spotify" (matchea la regla) pero el CSV pide una categoría propia
    // que no existe: debe priorizar "toCreate", no caer en la regla.
    const csv = [HEADER, '2026-01-05,gasto,999,Entretenimiento,Pago Spotify mensual,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, RULES);
    expect(result.rows[0].category.kind).toBe('toCreate');
  });

  it('reporta errores con el número de línea 1-indexado y no los cuenta como filas válidas', () => {
    const csv = [
      HEADER,
      '2026-01-05,gasto,100,,nota1,',
      'fecha-invalida,gasto,100,,nota2,',
      '2026-01-06,tipo-invalido,100,,nota3,',
      '2026-01-07,gasto,-5,,nota4,',
    ].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      { line: 3, reason: 'Fecha inválida' },
      { line: 4, reason: 'Tipo debe ser "ingreso" o "gasto"' },
      { line: 5, reason: 'Monto inválido' },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(4); // 1 válida + 3 con error (el encabezado no cuenta)
  });

  it('ignora líneas vacías (cuentan como skipped, no como error ni fila válida)', () => {
    const csv = [HEADER, '2026-01-05,gasto,100,,nota1,', '', '   ', '2026-01-06,gasto,200,,nota2,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(3); // encabezado + 2 líneas vacías
    expect(result.errors).toEqual([]);
  });

  it('quita el BOM inicial si está presente', () => {
    const csv = '﻿' + [HEADER, '2026-01-05,gasto,100,,nota1,'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('la columna meta (6ta, de la exportación) se ignora al importar', () => {
    const csv = [HEADER, '2026-01-05,gasto,100,,una nota,aporte_meta'].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows[0].note).toBe('una nota');
  });

  it('sin encabezado (CSV viejo de solo datos) igual funciona: la primera fila se procesa', () => {
    const csv = '2026-01-05,gasto,100,,una nota';
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it('categoriesToCreate respeta el tipo: mismo nombre en INCOME y EXPENSE son entradas distintas', () => {
    const csv = [
      HEADER,
      '2026-01-05,gasto,100,Ajuste,nota1,',
      '2026-01-05,ingreso,100,Ajuste,nota2,',
    ].join('\n');
    const result = parseImportCsv(csv, CATEGORIES, []);
    expect(result.categoriesToCreate).toEqual([
      { key: 'EXPENSE:ajuste', name: 'Ajuste', type: 'EXPENSE' as TransactionType },
      { key: 'INCOME:ajuste', name: 'Ajuste', type: 'INCOME' as TransactionType },
    ]);
  });
});
