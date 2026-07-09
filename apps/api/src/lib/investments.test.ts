import { describe, expect, it } from 'vitest';
import { investmentMetrics, type PositionOp } from './investments';

/** 10.000 nominales de AL30 comprados a 85.600 (precio cada 100 VN). */
const BOND_OPS: PositionOp[] = [{ type: 'COMPRA', quantity: 10_000, unitPrice: 85_600 }];

describe('investmentMetrics con priceFactor', () => {
  it('escala los importes de renta fija sin tocar el costo promedio', () => {
    const m = investmentMetrics(90_000, BOND_OPS, 100);
    // avgCost queda en precio cotizado: comparable con currentPrice, no dividido.
    expect(m.avgCost).toBe(85_600);
    expect(m.investedCost).toBe(8_560_000);
    expect(m.currentValue).toBe(9_000_000);
    expect(m.pnl).toBe(440_000);
  });

  it('sin factor valúa cantidad × precio, como cualquier acción', () => {
    const m = investmentMetrics(90_000, BOND_OPS);
    expect(m.investedCost).toBe(856_000_000);
    expect(m.currentValue).toBe(900_000_000);
  });

  it('el factor se cancela en pnlPercent', () => {
    expect(investmentMetrics(90_000, BOND_OPS, 100).pnlPercent).toBe(
      investmentMetrics(90_000, BOND_OPS, 1).pnlPercent,
    );
    expect(investmentMetrics(90_000, BOND_OPS, 100).pnlPercent).toBe(5.14);
  });

  it('sin precio actual valúa al costo promedio: P&L cero, ya escalado', () => {
    const m = investmentMetrics(null, BOND_OPS, 100);
    expect(m.currentValue).toBe(8_560_000);
    expect(m.investedCost).toBe(8_560_000);
    expect(m.pnl).toBe(0);
    expect(m.pnlPercent).toBe(0);
  });

  it('un factor inválido cae a 1 en vez de dividir por cero', () => {
    expect(investmentMetrics(90_000, BOND_OPS, 0).currentValue).toBe(900_000_000);
  });

  it('las ventas no alteran el costo promedio ni el escalado', () => {
    const ops: PositionOp[] = [
      { type: 'COMPRA', quantity: 10_000, unitPrice: 85_600 },
      { type: 'VENTA', quantity: 4_000, unitPrice: 90_000 },
    ];
    const m = investmentMetrics(90_000, ops, 100);
    expect(m.quantity).toBe(6_000);
    expect(m.avgCost).toBe(85_600);
    expect(m.investedCost).toBe(5_136_000); // 6.000 × 85.600 / 100
    expect(m.currentValue).toBe(5_400_000); // 6.000 × 90.000 / 100
  });
});
