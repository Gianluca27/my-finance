import { describe, expect, it } from 'vitest';
import {
  detectRecurringCandidates,
  detectRuleCandidates,
  matchesExistingRecurring,
  normalizeNote,
  noteKey,
  suggestCategoryFromHistory,
  type TxnLike,
} from './suggestions';

/** Helper para armar transacciones de prueba con defaults razonables. */
function txn(partial: Partial<TxnLike> & { note: string | null; date: string }): TxnLike {
  return {
    type: 'EXPENSE',
    amount: 1000,
    categoryId: null,
    ...partial,
    note: partial.note,
    date: new Date(partial.date),
  };
}

describe('normalizeNote', () => {
  it('baja a minúsculas, quita acentos, números y símbolos', () => {
    expect(normalizeNote('Café Martínez 05/06 $4.500')).toEqual(['cafe', 'martinez']);
  });

  it('descarta stopwords y tokens de menos de 3 letras', () => {
    expect(normalizeNote('Pago de la luz en mi casa')).toEqual(['pago', 'luz', 'casa']);
  });

  it('devuelve vacío para notas nulas o sin contenido útil', () => {
    expect(normalizeNote(null)).toEqual([]);
    expect(normalizeNote('  12/34 $$ ')).toEqual([]);
  });
});

describe('noteKey', () => {
  it('ordena tokens para que el orden de palabras no importe', () => {
    expect(noteKey('Netflix pago mensual')).toBe(noteKey('Pago mensual NETFLIX'));
  });

  it('es vacío cuando no hay tokens', () => {
    expect(noteKey('123')).toBe('');
  });
});

describe('suggestCategoryFromHistory', () => {
  const history: TxnLike[] = [
    txn({ note: 'Supermercado Dia', date: '2026-06-01', categoryId: 'c-super' }),
    txn({ note: 'Supermercado Dia', date: '2026-06-10', categoryId: 'c-super' }),
    txn({ note: 'Supermercado Coto', date: '2026-06-20', categoryId: 'c-super' }),
    txn({ note: 'Sueldo empresa', date: '2026-06-05', categoryId: 'c-sueldo', type: 'INCOME', amount: 900000 }),
  ];

  it('sugiere la categoría dominante entre notas similares', () => {
    const s = suggestCategoryFromHistory('supermercado dia express', 'EXPENSE', history);
    expect(s?.categoryId).toBe('c-super');
    expect(s!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('no cruza tipos: un gasto no se sugiere desde ingresos', () => {
    expect(suggestCategoryFromHistory('sueldo empresa', 'EXPENSE', history)).toBeNull();
  });

  it('devuelve null sin solapamiento de tokens', () => {
    expect(suggestCategoryFromHistory('farmacia', 'EXPENSE', history)).toBeNull();
  });

  it('devuelve null con evidencia débil (un solo token compartido una sola vez)', () => {
    const weak = [txn({ note: 'Kiosco esquina', date: '2026-06-01', categoryId: 'c-kiosco' })];
    expect(suggestCategoryFromHistory('kiosco', 'EXPENSE', weak)).toBeNull();
  });

  it('devuelve null cuando las categorías empatan (ambigüedad)', () => {
    const split = [
      txn({ note: 'Farmacia', date: '2026-06-01', categoryId: 'c-salud' }),
      txn({ note: 'Farmacia', date: '2026-06-02', categoryId: 'c-salud' }),
      txn({ note: 'Farmacia', date: '2026-06-03', categoryId: 'c-otros' }),
      txn({ note: 'Farmacia', date: '2026-06-04', categoryId: 'c-otros' }),
    ];
    expect(suggestCategoryFromHistory('farmacia', 'EXPENSE', split)).toBeNull();
  });

  it('ignora transacciones sin categoría', () => {
    const uncategorized = [
      txn({ note: 'Verduleria', date: '2026-06-01' }),
      txn({ note: 'Verduleria', date: '2026-06-02' }),
    ];
    expect(suggestCategoryFromHistory('verduleria', 'EXPENSE', uncategorized)).toBeNull();
  });
});

describe('detectRecurringCandidates', () => {
  it('detecta un gasto mensual estable', () => {
    const txns = [
      txn({ note: 'Netflix', date: '2026-01-05', amount: 4000, categoryId: 'c-sub' }),
      txn({ note: 'Netflix', date: '2026-02-05', amount: 4000, categoryId: 'c-sub' }),
      txn({ note: 'Netflix', date: '2026-03-05', amount: 4200, categoryId: 'c-sub' }),
    ];
    const [c] = detectRecurringCandidates(txns);
    expect(c).toMatchObject({
      name: 'Netflix',
      type: 'EXPENSE',
      frequency: 'MONTHLY',
      dueDay: 5,
      dueMonth: null,
      amount: 4200, // último monto, no promedio
      categoryId: 'c-sub',
      occurrences: 3,
    });
    expect(c.fingerprint).toBe('EXPENSE:netflix');
  });

  it('detecta un patrón semanal y usa día de semana como dueDay', () => {
    // Lunes consecutivos (2026-06-01 es lunes)
    const txns = [
      txn({ note: 'Clase de tenis', date: '2026-06-01', amount: 5000 }),
      txn({ note: 'Clase de tenis', date: '2026-06-08', amount: 5000 }),
      txn({ note: 'Clase de tenis', date: '2026-06-15', amount: 5000 }),
      txn({ note: 'Clase de tenis', date: '2026-06-22', amount: 5000 }),
    ];
    const [c] = detectRecurringCandidates(txns);
    expect(c.frequency).toBe('WEEKLY');
    expect(c.dueDay).toBe(1);
  });

  it('ignora grupos con menos de 3 ocurrencias', () => {
    const txns = [
      txn({ note: 'Netflix', date: '2026-01-05', amount: 4000 }),
      txn({ note: 'Netflix', date: '2026-02-05', amount: 4000 }),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('descarta intervalos irregulares', () => {
    const txns = [
      txn({ note: 'Ferreteria', date: '2026-01-05', amount: 3000 }),
      txn({ note: 'Ferreteria', date: '2026-01-20', amount: 3000 }),
      txn({ note: 'Ferreteria', date: '2026-03-01', amount: 3000 }),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('descarta montos inestables', () => {
    const txns = [
      txn({ note: 'Comida', date: '2026-01-05', amount: 1000 }),
      txn({ note: 'Comida', date: '2026-02-05', amount: 5000 }),
      txn({ note: 'Comida', date: '2026-03-05', amount: 9000 }),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('ignora transacciones sin nota y no mezcla tipos', () => {
    const txns = [
      txn({ note: null, date: '2026-01-05' }),
      txn({ note: 'Alquiler', date: '2026-01-05', amount: 300000, type: 'INCOME' }),
      txn({ note: 'Alquiler', date: '2026-02-05', amount: 300000, type: 'INCOME' }),
      txn({ note: 'Alquiler', date: '2026-03-05', amount: 300000, type: 'INCOME' }),
      txn({ note: 'Alquiler', date: '2026-03-05', amount: 300000, type: 'EXPENSE' }),
    ];
    const candidates = detectRecurringCandidates(txns);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('INCOME');
  });
});

describe('detectRuleCandidates', () => {
  const pharmacy = [
    txn({ note: 'Farmacity centro', date: '2026-06-01', categoryId: 'c-salud' }),
    txn({ note: 'Farmacity once', date: '2026-06-05', categoryId: 'c-salud' }),
    txn({ note: 'Farmacity caballito', date: '2026-06-10', categoryId: 'c-salud' }),
    txn({ note: 'Farmacity flores', date: '2026-06-15', categoryId: 'c-salud' }),
  ];

  it('sugiere una regla cuando un token se categoriza consistentemente', () => {
    const [c] = detectRuleCandidates(pharmacy, []);
    expect(c).toMatchObject({ keyword: 'farmacity', categoryId: 'c-salud', occurrences: 4 });
    expect(c.fingerprint).toBe('farmacity');
  });

  it('no sugiere si ya existe una regla que cubre el token', () => {
    expect(detectRuleCandidates(pharmacy, [{ keyword: 'farmacity' }])).toEqual([]);
    expect(detectRuleCandidates(pharmacy, [{ keyword: 'Farma' }])).toEqual([]);
  });

  it('exige dominancia de categoría (>= 90%)', () => {
    const mixed = [
      ...pharmacy,
      txn({ note: 'Farmacity regalo', date: '2026-06-20', categoryId: 'c-otros' }),
    ];
    expect(detectRuleCandidates(mixed, [])).toEqual([]);
  });

  it('exige al menos 4 ocurrencias', () => {
    expect(detectRuleCandidates(pharmacy.slice(0, 3), [])).toEqual([]);
  });

  it('cuando dos tokens siempre aparecen juntos, prefiere el más largo', () => {
    const txns = [
      txn({ note: 'Supermercado Dia', date: '2026-06-01', categoryId: 'c-super' }),
      txn({ note: 'Supermercado Dia', date: '2026-06-05', categoryId: 'c-super' }),
      txn({ note: 'Supermercado Dia', date: '2026-06-10', categoryId: 'c-super' }),
      txn({ note: 'Supermercado Dia', date: '2026-06-15', categoryId: 'c-super' }),
    ];
    const candidates = detectRuleCandidates(txns, []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].keyword).toBe('supermercado');
  });
});

describe('matchesExistingRecurring', () => {
  const existing = [{ name: 'Netflix' }, { name: 'Expensas depto' }];

  it('matchea por igualdad de tokens normalizados', () => {
    expect(matchesExistingRecurring('Netflix', existing)).toBe(true);
  });

  it('matchea cuando los tokens de uno están contenidos en el otro', () => {
    expect(matchesExistingRecurring('Pago netflix mensual', existing)).toBe(true);
    expect(matchesExistingRecurring('Expensas', existing)).toBe(true);
  });

  it('no matchea nombres distintos', () => {
    expect(matchesExistingRecurring('Spotify', existing)).toBe(false);
  });
});
