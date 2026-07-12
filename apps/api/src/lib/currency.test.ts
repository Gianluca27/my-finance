import { describe, expect, it } from 'vitest';
import {
  consolidateToBase,
  convertPaymentAmount,
  convertToBase,
  effectiveEntityAmount,
  PERSONAL_USD_RATE,
  scaleEntityAmount,
  sumEntityAmounts,
} from './currency';

function rates(map: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(map));
}

describe('convertToBase', () => {
  it('misma moneda: devuelve el monto tal cual, sin necesitar cotización', () => {
    expect(convertToBase(150, 'ARS', 'ARS', rates({}))).toBe(150);
    expect(convertToBase(99.5, 'USD', 'USD', rates({}))).toBe(99.5);
  });

  it('USD → ARS multiplica por la cotización (pesos por dólar)', () => {
    expect(convertToBase(100, 'USD', 'ARS', rates({ USDMEP: 1200 }))).toBe(120_000);
  });

  it('ARS → USD (base USD) divide por la cotización', () => {
    expect(convertToBase(120_000, 'ARS', 'USD', rates({ USDMEP: 1200 }))).toBe(100);
  });

  it(`para USD prefiere ${PERSONAL_USD_RATE} (MEP) sobre el oficial`, () => {
    expect(convertToBase(1, 'USD', 'ARS', rates({ USD: 1000, USDMEP: 1200 }))).toBe(1200);
  });

  it('sin MEP cargado cae al USD oficial', () => {
    expect(convertToBase(1, 'USD', 'ARS', rates({ USD: 1000 }))).toBe(1000);
  });

  it('sin cotización de la moneda origen devuelve null', () => {
    expect(convertToBase(50, 'EUR', 'ARS', rates({ USDMEP: 1200 }))).toBeNull();
    expect(convertToBase(50, 'USD', 'ARS', rates({}))).toBeNull();
  });

  it('sin cotización de la moneda base devuelve null (no puede pivotear)', () => {
    expect(convertToBase(1000, 'ARS', 'USD', rates({}))).toBeNull();
    expect(convertToBase(10, 'EUR', 'USD', rates({ EUR: 1500 }))).toBeNull();
  });

  it('entre dos monedas no-ARS pivotea por ARS: monto × rate(origen) / rate(base)', () => {
    expect(convertToBase(10, 'EUR', 'USD', rates({ EUR: 1500, USDMEP: 1200 }))).toBeCloseTo(12.5, 10);
  });
});

describe('consolidateToBase', () => {
  it('suma las monedas convertibles y excluye/reporta las que no tienen cotización', () => {
    const result = consolidateToBase(
      new Map([
        ['ARS', 100_000],
        ['USD', 100],
        ['EUR', 50],
      ]),
      'ARS',
      rates({ USDMEP: 1200 }),
    );
    expect(result.total).toBe(220_000);
    expect(result.converted).toBe(true);
    expect(result.missingRates).toEqual(['EUR']);
  });

  it('todo en moneda base: sin conversión ni faltantes', () => {
    const result = consolidateToBase(new Map([['ARS', 1234.56]]), 'ARS', rates({}));
    expect(result).toEqual({ total: 1234.56, converted: false, missingRates: [] });
  });

  it('un monto extranjero en cero no marca converted (no habría "≈" que justificar)', () => {
    const result = consolidateToBase(
      new Map([
        ['ARS', 500],
        ['USD', 0],
      ]),
      'ARS',
      rates({ USDMEP: 1200 }),
    );
    expect(result.total).toBe(500);
    expect(result.converted).toBe(false);
  });

  it('redondea el total a 2 decimales', () => {
    const result = consolidateToBase(new Map([['USD', 0.335]]), 'ARS', rates({ USDMEP: 3 }));
    expect(result.total).toBe(1.01);
  });

  it('missingRates sale ordenado y sin duplicados', () => {
    const result = consolidateToBase(
      new Map([
        ['EUR', 1],
        ['BRL', 1],
      ]),
      'ARS',
      rates({}),
    );
    expect(result.missingRates).toEqual(['BRL', 'EUR']);
  });
});

describe('convertPaymentAmount', () => {
  it('pago ARS sobre deuda USD: divide por el MEP y redondea a centavos', () => {
    expect(convertPaymentAmount(100_000, 'ARS', 'USD', rates({ USDMEP: 1200 }))).toBe(83.33);
  });

  it('pago USD sobre deuda ARS: multiplica por el MEP', () => {
    expect(convertPaymentAmount(50, 'USD', 'ARS', rates({ USDMEP: 1200 }))).toBe(60_000);
  });

  it('misma moneda: devuelve el monto tal cual (sin necesitar cotización)', () => {
    expect(convertPaymentAmount(1234.56, 'USD', 'USD', rates({}))).toBe(1234.56);
  });

  it('sin cotización devuelve null: el caller rechaza en vez de adivinar el TC', () => {
    expect(convertPaymentAmount(100, 'ARS', 'USD', rates({}))).toBeNull();
    expect(convertPaymentAmount(100, 'EUR', 'USD', rates({ USDMEP: 1200 }))).toBeNull();
  });
});

describe('effectiveEntityAmount / sumEntityAmounts', () => {
  const dec = (n: number) => ({ toNumber: () => n });

  it('usa entityAmount cuando el pago cruzó monedas y amount cuando no', () => {
    expect(effectiveEntityAmount({ amount: 100_000, entityAmount: 83.33 })).toBe(83.33);
    expect(effectiveEntityAmount({ amount: 500, entityAmount: null })).toBe(500);
  });

  it('acepta Decimal de Prisma (toNumber) además de números planos', () => {
    expect(effectiveEntityAmount({ amount: dec(100), entityAmount: dec(83.33) })).toBe(83.33);
    expect(effectiveEntityAmount({ amount: dec(100), entityAmount: null })).toBe(100);
  });

  it('suma mezclando pagos nominales y cross-currency, redondeada a centavos', () => {
    const total = sumEntityAmounts([
      { amount: 100, entityAmount: null },
      { amount: 120_000, entityAmount: dec(83.33) },
      { amount: dec(50), entityAmount: null },
    ]);
    expect(total).toBe(233.33);
  });

  it('lista vacía suma 0', () => {
    expect(sumEntityAmounts([])).toBe(0);
  });
});

describe('scaleEntityAmount', () => {
  it('escala proporcionalmente manteniendo el TC implícito original', () => {
    // Pago de 120.000 ARS que descontó 100 USD; corregido a 60.000 ARS → 50 USD.
    expect(scaleEntityAmount(100, 120_000, 60_000)).toBe(50);
  });

  it('redondea a centavos', () => {
    expect(scaleEntityAmount(100, 3, 1)).toBe(33.33);
  });
});
