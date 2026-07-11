import { describe, expect, it } from 'vitest';
import { computeReconcileAdjustment } from './accounts';

describe('computeReconcileAdjustment', () => {
  it('saldo real por encima del calculado genera un ajuste INCOME por la diferencia', () => {
    const result = computeReconcileAdjustment(480, 500);
    expect(result).toEqual({ type: 'INCOME', amount: 20, adjustment: 20, newBalance: 500 });
  });

  it('saldo real por debajo del calculado genera un ajuste EXPENSE por la diferencia', () => {
    const result = computeReconcileAdjustment(500, 480);
    expect(result).toEqual({ type: 'EXPENSE', amount: 20, adjustment: -20, newBalance: 480 });
  });

  it('sin diferencia no genera ajuste', () => {
    expect(computeReconcileAdjustment(500, 500)).toBeNull();
  });

  it('tolera arrastre de punto flotante por debajo del centavo', () => {
    expect(computeReconcileAdjustment(100, 100.001)).toBeNull();
  });

  it('funciona con balances negativos', () => {
    const result = computeReconcileAdjustment(-80, -50);
    expect(result).toEqual({ type: 'INCOME', amount: 30, adjustment: 30, newBalance: -50 });
  });

  it('redondea el nuevo balance a centavos', () => {
    const result = computeReconcileAdjustment(100, 133.335);
    expect(result?.newBalance).toBe(133.34);
  });
});
