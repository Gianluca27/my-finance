import { describe, expect, it } from 'vitest';
import { consolidateToBase, convertToBase, PERSONAL_USD_RATE } from './currency';

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
