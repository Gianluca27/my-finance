import { describe, expect, it } from 'vitest';
import { transactionFilterSchema } from './transactionFilters';

describe('transactionFilterSchema', () => {
  it('un `to` de solo fecha cubre el día completo (inclusive con hora intra-día)', () => {
    // Las rutas filtran con `lte`: sin normalizar a fin de día, una transacción generada
    // por el server con hora (aporte de meta, pago sin fecha explícita) quedaría fuera del
    // listado aunque el total derivado del ciclo de tarjeta (spec 20) la cuente.
    const { to } = transactionFilterSchema.parse({ to: '2026-07-28' });
    expect(to).toEqual(new Date('2026-07-28T23:59:59.999Z'));
  });

  it('el fin de día de `to` queda antes de la medianoche del día siguiente', () => {
    // El primer instante del ciclo siguiente (medianoche del 29) NO debe entrar al rango:
    // equivale al half-open `date < cierre + 1 día` de cardCycleSpent.
    const { to } = transactionFilterSchema.parse({ to: '2026-07-28' });
    expect(to!.getTime()).toBeLessThan(new Date('2026-07-29T00:00:00.000Z').getTime());
  });

  it('un `to` con hora explícita se respeta tal cual', () => {
    const { to } = transactionFilterSchema.parse({ to: '2026-07-28T15:00:00.000Z' });
    expect(to).toEqual(new Date('2026-07-28T15:00:00.000Z'));
  });

  it('`from` sigue siendo la medianoche del día (límite inferior inclusivo)', () => {
    const { from } = transactionFilterSchema.parse({ from: '2026-06-29' });
    expect(from).toEqual(new Date('2026-06-29T00:00:00.000Z'));
  });

  it('sin filtros de fecha, from/to quedan undefined', () => {
    const parsed = transactionFilterSchema.parse({});
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });

  it('un `to` inválido sigue rechazándose', () => {
    expect(() => transactionFilterSchema.parse({ to: 'no-es-fecha' })).toThrow();
  });
});
