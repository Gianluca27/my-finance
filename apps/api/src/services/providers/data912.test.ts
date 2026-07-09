import { describe, expect, it } from 'vitest';
import {
  computeCcl,
  computeMep,
  median,
  pickPrice,
  rankSymbols,
  suggestCurrency,
  type CclRow,
  type MepRow,
} from './data912';

describe('pickPrice', () => {
  it('usa el último operado', () => {
    expect(pickPrice({ symbol: 'GGAL', c: 7910, px_bid: 7900, px_ask: 7920 })).toBe(7910);
  });

  it('cae al punto medio de las puntas si la especie no operó', () => {
    expect(pickPrice({ symbol: 'X', c: 0, px_bid: 98, px_ask: 102 })).toBe(100);
    expect(pickPrice({ symbol: 'X', c: null, px_bid: 98, px_ask: 102 })).toBe(100);
  });

  it('devuelve null sin precio ni puntas completas', () => {
    expect(pickPrice({ symbol: 'X' })).toBeNull();
    expect(pickPrice({ symbol: 'X', c: 0, px_bid: 98 })).toBeNull();
    expect(pickPrice({ symbol: 'X', c: -5, px_bid: 0, px_ask: 102 })).toBeNull();
  });
});

describe('median', () => {
  it('promedia los dos centrales cuando la muestra es par', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('descarta valores no finitos o no positivos', () => {
    expect(median([0, -1, 5, NaN, 7])).toBe(6);
  });

  it('devuelve null si no queda ningún valor válido', () => {
    expect(median([])).toBeNull();
    expect(median([0, -3, NaN])).toBeNull();
  });
});

describe('computeMep', () => {
  const bond = (ticker: string, close: number, v_ars: number): MepRow => ({
    ticker,
    close,
    mark: close,
    v_ars,
    panel: 'bonds',
  });

  it('ignora el panel de CEDEARs y promedia los bonos más operados', () => {
    const rows: MepRow[] = [
      bond('AL30', 1529.7, 1e13),
      bond('GD30', 1527.9, 1e12),
      { ticker: 'AAL', close: 999_999, mark: 999_999, v_ars: 1e15, panel: 'cedear' },
    ];
    expect(computeMep(rows)).toBeCloseTo(1528.8, 6);
  });

  it('cae a `mark` cuando la especie no tiene cierre', () => {
    expect(computeMep([{ ticker: 'AL30', close: null, mark: 1530, v_ars: 1e9, panel: 'bonds' }])).toBe(1530);
  });

  it('se queda con los 10 bonos de mayor volumen', () => {
    // Once bonos: el de menor volumen (valor 3000) queda afuera y no corre la mediana.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => bond(`B${i}`, 1500 + i, 1e12 - i)),
      bond('ILIQUIDO', 3000, 1),
    ];
    expect(computeMep(rows)).toBe(1504.5); // mediana de 1500..1509
  });

  it('devuelve null si no hay bonos', () => {
    expect(computeMep([{ ticker: 'AAL', close: 1500, v_ars: 1e9, panel: 'cedear' }])).toBeNull();
  });
});

describe('computeCcl', () => {
  const row = (ticker_ar: string, CCL_close: number, volume_rank: number): CclRow => ({
    ticker_ar,
    CCL_close,
    CCL_mark: CCL_close,
    volume_rank,
  });

  it('deduplica los tickers repetidos antes de cortar la muestra', () => {
    // MELI llega dos veces (una fila por especie). Sin deduplicar, el duplicado
    // ocupa un lugar del top 10 y empuja afuera al décimo ticker líquido.
    const rows = [
      ...Array.from({ length: 11 }, (_, i) => row(`T${i}`, 1500 + i, i + 1)),
      row('T0', 9999, 1.5), // duplicado peor rankeado que el original: se descarta
    ];
    // Top 10 únicos = T0..T9 (1500..1509). T10 y el duplicado quedan afuera.
    expect(computeCcl(rows)).toBe(1504.5);
  });

  it('ante un ticker repetido se queda con la fila más líquida', () => {
    const rows = [row('YPFD', 1580, 1), row('YPFD', 9999, 2)];
    expect(computeCcl(rows)).toBe(1580);
  });

  it('ordena por volumen aunque las filas lleguen desordenadas', () => {
    const rows = [row('C', 1600, 3), row('A', 1500, 1), row('B', 1550, 2)];
    expect(computeCcl(rows)).toBe(1550);
  });

  it('cae a `CCL_mark` y devuelve null sin datos', () => {
    expect(computeCcl([{ ticker_ar: 'YPFD', CCL_close: null, CCL_mark: 1580, volume_rank: 1 }])).toBe(1580);
    expect(computeCcl([])).toBeNull();
  });
});

describe('suggestCurrency', () => {
  // Precios reales de data912 (2026-07-08), con MEP ≈ 1528 y CCL ≈ 1577.
  const prices = (entries: Record<string, number | null>) => new Map(Object.entries(entries));

  it('reconoce la especie en dólares por el cociente contra su base', () => {
    const bonos = prices({ AL30: 85_600, AL30D: 55.96, AL30C: 54.4, AE38: 126_140 });
    expect(suggestCurrency('bonds', 'AL30', bonos)).toBe('ARS');
    expect(suggestCurrency('bonds', 'AL30D', bonos)).toBe('USD');
    expect(suggestCurrency('bonds', 'AL30C', bonos)).toBe('USD');
    expect(suggestCurrency('bonds', 'AE38', bonos)).toBe('ARS');
  });

  it('YPFD es una acción en pesos: su especie en dólares es YPFDD', () => {
    const acciones = prices({ YPFD: 75_775, YPFDD: 49.66, GGAL: 7_910, GGALD: 5.17 });
    expect(suggestCurrency('stocks', 'YPFD', acciones)).toBe('ARS');
    expect(suggestCurrency('stocks', 'YPFDD', acciones)).toBe('USD');
    expect(suggestCurrency('stocks', 'GGALD', acciones)).toBe('USD');
  });

  it('los CEDEARs de tickers que terminan en D o C siguen en pesos', () => {
    // AMD, C (Citigroup) y HSBC no tienen base: no son especies en dólares.
    // BBDC sí lo es: es la especie CCL de BBD.
    const cedears = prices({
      AMD: 81_625,
      C: 72_000,
      HSBC: 75_800,
      BBD: 5_340,
      BBDC: 3.38,
      AAPL: 24_710,
      AAPLD: 16.23,
      AAPLC: 15.67,
    });
    expect(suggestCurrency('cedears', 'AMD', cedears)).toBe('ARS');
    expect(suggestCurrency('cedears', 'C', cedears)).toBe('ARS');
    expect(suggestCurrency('cedears', 'HSBC', cedears)).toBe('ARS');
    expect(suggestCurrency('cedears', 'BBDC', cedears)).toBe('USD');
    expect(suggestCurrency('cedears', 'AAPLD', cedears)).toBe('USD');
    expect(suggestCurrency('cedears', 'AAPLC', cedears)).toBe('USD');
  });

  it('un bono en pesos que termina en D no se confunde con una especie en dólares', () => {
    // BA37D cotiza en pesos y no tiene base "BA37" publicada.
    const bonos = prices({ BA37D: 121_340, SA24D: 58_900 });
    expect(suggestCurrency('bonds', 'BA37D', bonos)).toBe('ARS');
    expect(suggestCurrency('bonds', 'SA24D', bonos)).toBe('ARS');
  });

  it('en letras y ONs manda el sufijo: la base no siempre está publicada', () => {
    const letras = prices({ BU3S6: 107, S2L6D: 0.07 });
    expect(suggestCurrency('notes', 'BU3S6', letras)).toBe('ARS');
    expect(suggestCurrency('notes', 'S2L6D', letras)).toBe('USD');

    const ons = prices({ AER9O: 49_900, AERBO: 154_090, AERBD: 101, ARC1C: 90 });
    expect(suggestCurrency('corp', 'AER9O', ons)).toBe('ARS');
    expect(suggestCurrency('corp', 'AERBO', ons)).toBe('ARS');
    expect(suggestCurrency('corp', 'AERBD', ons)).toBe('USD');
    expect(suggestCurrency('corp', 'ARC1C', ons)).toBe('USD');
  });

  it('sin precio de la base no arriesga: sugiere la moneda del mercado', () => {
    expect(suggestCurrency('stocks', 'TECOD', prices({ TECOD: 2.7 }))).toBe('ARS');
    expect(suggestCurrency('cedears', 'AAPLD', prices({ AAPLD: 16.23, AAPL: null }))).toBe('ARS');
  });
});

describe('rankSymbols', () => {
  it('pone primero los que empiezan con la consulta y después los que la contienen', () => {
    expect(rankSymbols(['GGAL', 'AL30', 'ALUA', 'META'], 'AL')).toEqual(['AL30', 'ALUA', 'GGAL']);
  });

  it('ignora mayúsculas y espacios', () => {
    expect(rankSymbols(['GGAL', 'AGRO'], ' gg ')).toEqual(['GGAL']);
  });
});
