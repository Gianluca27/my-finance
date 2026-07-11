import { describe, expect, it } from 'vitest';
import {
  closestPriceMatch,
  investmentMetrics,
  positionAsOf,
  xirr,
  type CashFlow,
  type DatedPositionOp,
  type PositionOp,
  type PricePoint,
} from './investments';

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

describe('closestPriceMatch', () => {
  const points: PricePoint[] = [
    { date: new Date('2026-06-01T00:00:00.000Z'), price: 100 },
    { date: new Date('2026-06-10T00:00:00.000Z'), price: 110 },
  ];

  it('encuentra el match exacto', () => {
    const match = closestPriceMatch(points, new Date('2026-06-10T00:00:00.000Z'));
    expect(match?.price).toBe(110);
  });

  it('dentro de la tolerancia agarra el más cercano', () => {
    const match = closestPriceMatch(points, new Date('2026-06-03T00:00:00.000Z'));
    expect(match?.price).toBe(100);
  });

  it('fuera de la tolerancia devuelve null', () => {
    const match = closestPriceMatch(points, new Date('2026-06-20T00:00:00.000Z'));
    expect(match).toBeNull();
  });

  it('sin puntos devuelve null', () => {
    expect(closestPriceMatch([], new Date('2026-06-10T00:00:00.000Z'))).toBeNull();
  });

  it('ante un empate de distancia, gana el punto anterior', () => {
    const tied: PricePoint[] = [
      { date: new Date('2026-06-05T00:00:00.000Z'), price: 90 },
      { date: new Date('2026-06-15T00:00:00.000Z'), price: 120 },
    ];
    const match = closestPriceMatch(tied, new Date('2026-06-10T00:00:00.000Z'));
    expect(match?.price).toBe(90);
  });
});

function flow(date: string, amount: number): CashFlow {
  return { date: new Date(`${date}T00:00:00.000Z`), amount };
}

describe('xirr', () => {
  it('recupera una TIR conocida del 10% anual (365 días exactos)', () => {
    // -1000 hoy, +1100 un año después: 1100/1.1 = 1000 → TIR 10%.
    const rate = xirr([flow('2023-01-01', -1000), flow('2024-01-01', 1100)]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 6);
  });

  it('duplicar el capital en un año da 100%', () => {
    const rate = xirr([flow('2023-01-01', -1000), flow('2024-01-01', 2000)]);
    expect(rate!).toBeCloseTo(1, 6);
  });

  it('venta total con compras intercaladas converge a la TIR esperada', () => {
    // Dos compras y una venta que cierra la posición (sin valor final).
    const rate = xirr([
      flow('2023-01-01', -600),
      flow('2023-07-01', -600),
      flow('2024-01-01', 1500),
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.34, 2);
  });

  it('devuelve null con menos de dos flujos', () => {
    expect(xirr([flow('2023-01-01', -1000)])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('devuelve null si el rango es menor a 30 días', () => {
    expect(xirr([flow('2024-01-01', -1000), flow('2024-01-10', 1100)])).toBeNull();
  });

  it('devuelve null si no hay cambio de signo (no converge)', () => {
    // Dos compras sin venta ni valuación: la ecuación no tiene raíz.
    expect(xirr([flow('2023-01-01', -1000), flow('2023-06-01', -1000)])).toBeNull();
  });

  it('no depende del orden de los flujos', () => {
    const ordered = xirr([flow('2023-01-01', -1000), flow('2024-01-01', 1100)]);
    const shuffled = xirr([flow('2024-01-01', 1100), flow('2023-01-01', -1000)]);
    expect(shuffled!).toBeCloseTo(ordered!, 10);
  });
});

describe('positionAsOf', () => {
  const ops: DatedPositionOp[] = [
    { type: 'COMPRA', quantity: 10, unitPrice: 100, date: new Date('2024-01-01T00:00:00.000Z') },
    { type: 'VENTA', quantity: 4, unitPrice: 120, date: new Date('2024-03-01T00:00:00.000Z') },
    { type: 'COMPRA', quantity: 6, unitPrice: 150, date: new Date('2024-06-01T00:00:00.000Z') },
  ];

  it('antes de la primera operación la tenencia es cero', () => {
    const pos = positionAsOf(ops, new Date('2023-12-31T00:00:00.000Z'));
    expect(pos).toEqual({ quantity: 0, investedCost: 0, avgCost: 0 });
  });

  it('incluye la operación de la fecha de corte (<=)', () => {
    const pos = positionAsOf(ops, new Date('2024-01-01T00:00:00.000Z'));
    expect(pos).toEqual({ quantity: 10, investedCost: 1000, avgCost: 100 });
  });

  it('tras una venta parcial conserva el costo promedio', () => {
    const pos = positionAsOf(ops, new Date('2024-04-01T00:00:00.000Z'));
    expect(pos).toEqual({ quantity: 6, investedCost: 600, avgCost: 100 });
  });

  it('ignora operaciones futuras a la fecha de corte', () => {
    const pos = positionAsOf(ops, new Date('2024-05-01T00:00:00.000Z'));
    expect(pos?.quantity).toBe(6);
  });

  it('suma compras posteriores al costo promedio ponderado', () => {
    const pos = positionAsOf(ops, new Date('2024-07-01T00:00:00.000Z'));
    expect(pos?.quantity).toBe(12);
    expect(pos?.investedCost).toBe(1500); // 600 + 6×150
    expect(pos?.avgCost).toBe(125);
  });

  it('ordena las operaciones desordenadas antes de acumular', () => {
    const unsorted: DatedPositionOp[] = [ops[2], ops[0], ops[1]];
    const pos = positionAsOf(unsorted, new Date('2024-07-01T00:00:00.000Z'));
    expect(pos?.quantity).toBe(12);
    expect(pos?.avgCost).toBe(125);
  });
});
