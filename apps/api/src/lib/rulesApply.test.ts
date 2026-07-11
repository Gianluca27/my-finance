import { describe, expect, it } from 'vitest';
import type { LoadedRule } from './categoryRules';
import { computeRuleMatches, type UncategorizedTx } from './rulesApply';

const RULES: LoadedRule[] = [
  { keyword: 'spotify', categoryId: 'cat-suscripciones', type: 'EXPENSE' },
  { keyword: 'sueldo', categoryId: 'cat-salario', type: 'INCOME' },
  { keyword: 'super', categoryId: 'cat-super', type: 'EXPENSE' },
];

function tx(partial: Partial<UncategorizedTx> & { id: string }): UncategorizedTx {
  return { note: null, type: 'EXPENSE', ...partial };
}

describe('computeRuleMatches', () => {
  it('cuenta los movimientos que matchean por regla (byRule) y el total', () => {
    const txs = [
      tx({ id: '1', note: 'Pago Spotify mensual' }),
      tx({ id: '2', note: 'Spotify familiar' }),
      tx({ id: '3', note: 'Super Coto' }),
      tx({ id: '4', note: 'Sin relación' }),
    ];
    const result = computeRuleMatches(RULES, txs);
    expect(result.total).toBe(3);
    expect(result.byRule).toEqual([
      { keyword: 'spotify', count: 2 },
      { keyword: 'super', count: 1 },
    ]);
    expect(result.matches).toEqual([
      { transactionId: '1', categoryId: 'cat-suscripciones', keyword: 'spotify' },
      { transactionId: '2', categoryId: 'cat-suscripciones', keyword: 'spotify' },
      { transactionId: '3', categoryId: 'cat-super', keyword: 'super' },
    ]);
  });

  it('no matchea si el tipo de la regla no coincide con el de la transacción', () => {
    // "sueldo" es una regla de INCOME; una transacción EXPENSE con esa nota no debe matchear.
    const txs = [tx({ id: '1', note: 'Adelanto de sueldo', type: 'EXPENSE' })];
    expect(computeRuleMatches(RULES, txs)).toEqual({ total: 0, byRule: [], matches: [] });
  });

  it('nota null o vacía no matchea ninguna regla', () => {
    const txs = [tx({ id: '1', note: null }), tx({ id: '2', note: '' })];
    expect(computeRuleMatches(RULES, txs).total).toBe(0);
  });

  it('sin reglas o sin transacciones devuelve vacío', () => {
    expect(computeRuleMatches([], [tx({ id: '1', note: 'spotify' })])).toEqual({
      total: 0,
      byRule: [],
      matches: [],
    });
    expect(computeRuleMatches(RULES, [])).toEqual({ total: 0, byRule: [], matches: [] });
  });
});
