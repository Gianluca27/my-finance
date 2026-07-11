import { describe, expect, it } from 'vitest';
import { budgetCarryOver, budgetPercentUsed, effectiveStartMonth } from './budgets';

/** Gasto por mes como función pura (0 si el mes no está en el mapa). */
function spent(map: Record<string, number>): (month: string) => number {
  return (month) => map[month] ?? 0;
}

describe('budgetCarryOver', () => {
  it('arrastra el sobrante de un mes al siguiente (spec: $100, mes1 gasta $60 → $140)', () => {
    const carry = budgetCarryOver({
      amount: 100,
      targetMonth: '2026-02',
      startMonth: '2026-01',
      spentByMonth: spent({ '2026-01': 60 }),
    });
    expect(carry).toBe(40);
    expect(100 + carry).toBe(140); // effectiveLimit(mes2)
  });

  it('acumula el exceso como arrastre negativo (spec: mes2 gasta $150 → $90)', () => {
    const carry = budgetCarryOver({
      amount: 100,
      targetMonth: '2026-03',
      startMonth: '2026-01',
      spentByMonth: spent({ '2026-01': 60, '2026-02': 150 }),
    });
    expect(carry).toBe(-10);
    expect(100 + carry).toBe(90); // effectiveLimit(mes3)
  });

  it('sin meses previos (rollover recién activado) el arrastre es 0', () => {
    const carry = budgetCarryOver({
      amount: 100,
      targetMonth: '2026-01',
      startMonth: '2026-01',
      spentByMonth: spent({ '2026-01': 999 }),
    });
    expect(carry).toBe(0);
  });

  it('encadena varios meses de sobrante', () => {
    const carry = budgetCarryOver({
      amount: 100,
      targetMonth: '2026-04',
      startMonth: '2026-01',
      spentByMonth: spent({ '2026-01': 80, '2026-02': 50, '2026-03': 100 }),
    });
    // ene: 100-80=20; feb: 120-50=70; mar: 170-100=70
    expect(carry).toBe(70);
  });
});

describe('effectiveStartMonth', () => {
  it('tope de 12 meses hacia atrás cuando no hay mes de activación', () => {
    expect(effectiveStartMonth('2026-07', null)).toBe('2025-07');
  });

  it('usa el mes de activación si es más reciente que el tope', () => {
    expect(effectiveStartMonth('2026-07', '2026-03')).toBe('2026-03');
  });

  it('nunca va más de 12 meses atrás aunque el rollover sea más viejo', () => {
    expect(effectiveStartMonth('2026-07', '2024-01')).toBe('2025-07');
  });
});

describe('budgetPercentUsed', () => {
  it('redondea el porcentaje sobre el límite efectivo', () => {
    expect(budgetPercentUsed(70, 140)).toBe(50);
  });

  it('límite efectivo <= 0 con gasto se considera superado (100%)', () => {
    expect(budgetPercentUsed(50, -10)).toBe(100);
    expect(budgetPercentUsed(50, 0)).toBe(100);
  });

  it('límite efectivo <= 0 sin gasto es 0%', () => {
    expect(budgetPercentUsed(0, 0)).toBe(0);
  });
});
