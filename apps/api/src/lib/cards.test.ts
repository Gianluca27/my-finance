import { describe, expect, it } from 'vitest';
import { currentCycle, nextPaymentDate, paymentDateFor, previousCycle } from './cards';

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('currentCycle', () => {
  it('con cierre día 28, el 28 todavía pertenece al ciclo que cierra ese día', () => {
    const cycle = currentCycle(28, utc('2026-07-28'));
    expect(cycle.closing).toEqual(utc('2026-07-28'));
    expect(cycle.start).toEqual(utc('2026-06-29'));
    // Límite superior half-open: incluye todo el día 28 aunque tenga hora intra-día.
    expect(cycle.end).toEqual(utc('2026-07-29'));
  });

  it('con cierre día 28, un consumo del 29 cae al ciclo siguiente', () => {
    const cycle = currentCycle(28, utc('2026-07-29'));
    expect(cycle.start).toEqual(utc('2026-07-29'));
    expect(cycle.closing).toEqual(utc('2026-08-28'));
  });

  it('día 31 clampea a fin de mes en meses cortos', () => {
    const cycle = currentCycle(31, utc('2026-04-15'));
    expect(cycle.closing).toEqual(utc('2026-04-30'));
    expect(cycle.start).toEqual(utc('2026-04-01'));
  });

  it('día 31 clampea al 28 en febrero no bisiesto', () => {
    const cycle = currentCycle(31, utc('2026-02-10'));
    expect(cycle.closing).toEqual(utc('2026-02-28'));
    expect(cycle.start).toEqual(utc('2026-02-01'));
  });

  it('día 31 clampea al 29 en febrero bisiesto', () => {
    const cycle = currentCycle(31, utc('2028-02-10'));
    expect(cycle.closing).toEqual(utc('2028-02-29'));
  });

  it('cierre 30 en marzo: el ciclo arranca justo después del 28 de febrero clampeado', () => {
    const cycle = currentCycle(30, utc('2026-03-15'));
    expect(cycle.start).toEqual(utc('2026-03-01'));
    expect(cycle.closing).toEqual(utc('2026-03-30'));
  });

  it('cruza el fin de año', () => {
    const cycle = currentCycle(10, utc('2026-12-20'));
    expect(cycle.closing).toEqual(utc('2027-01-10'));
    expect(cycle.start).toEqual(utc('2026-12-11'));
  });

  it('descarta la hora intra-día de la referencia', () => {
    const cycle = currentCycle(15, new Date('2026-07-15T23:59:00.000Z'));
    expect(cycle.closing).toEqual(utc('2026-07-15'));
  });
});

describe('previousCycle', () => {
  it('devuelve el ciclo cerrado anterior al vigente', () => {
    const cycle = previousCycle(28, utc('2026-07-12'));
    expect(cycle.start).toEqual(utc('2026-05-29'));
    expect(cycle.closing).toEqual(utc('2026-06-28'));
  });

  it('el mismo día del cierre, el "último cerrado" sigue siendo el del mes anterior', () => {
    // El 28 el ciclo vigente cierra ese día pero aún no terminó: el cerrado es el de junio.
    const cycle = previousCycle(28, utc('2026-07-28'));
    expect(cycle.closing).toEqual(utc('2026-06-28'));
  });

  it('con cierres clampeados no deja huecos ni superposiciones alrededor de febrero', () => {
    const feb = previousCycle(31, utc('2026-03-05'));
    expect(feb.start).toEqual(utc('2026-02-01'));
    expect(feb.closing).toEqual(utc('2026-02-28'));
    const mar = currentCycle(31, utc('2026-03-05'));
    expect(mar.start).toEqual(utc('2026-03-01'));
    expect(mar.closing).toEqual(utc('2026-03-31'));
  });
});

describe('paymentDateFor', () => {
  it('paymentDay > closingDay: vence el mismo mes del cierre', () => {
    expect(paymentDateFor(utc('2026-07-15'), 15, 25)).toEqual(utc('2026-07-25'));
  });

  it('paymentDay <= closingDay: vence al mes siguiente', () => {
    expect(paymentDateFor(utc('2026-07-28'), 28, 5)).toEqual(utc('2026-08-05'));
    expect(paymentDateFor(utc('2026-07-15'), 15, 15)).toEqual(utc('2026-08-15'));
  });

  it('compara contra el closingDay configurado aunque el cierre esté clampeado', () => {
    // Cierre día 31 clampeado al 30/4: el vencimiento día 10 cae en mayo, no en abril.
    expect(paymentDateFor(utc('2026-04-30'), 31, 10)).toEqual(utc('2026-05-10'));
  });

  it('clampea el día de vencimiento en meses cortos', () => {
    expect(paymentDateFor(utc('2026-02-15'), 15, 31)).toEqual(utc('2026-02-28'));
  });

  it('el wrap al mes siguiente cruza el fin de año', () => {
    expect(paymentDateFor(utc('2026-12-28'), 28, 5)).toEqual(utc('2027-01-05'));
  });

  it('si el clamp iguala vencimiento y cierre, el pago pasa al día siguiente del cierre', () => {
    // Cierre 30 / vencimiento 31: en abril ambos clampearían al 30 — el pago nunca puede
    // caer en el propio día de cierre (el recordatorio del resumen no dispararía jamás).
    expect(paymentDateFor(utc('2026-04-30'), 30, 31)).toEqual(utc('2026-05-01'));
    // Febrero: cierre día 30 (clampeado al 28) y vencimiento 31 → 1 de marzo.
    expect(paymentDateFor(utc('2026-02-28'), 30, 31)).toEqual(utc('2026-03-01'));
    // En meses largos no cambia nada: vence el día configurado.
    expect(paymentDateFor(utc('2026-07-30'), 30, 31)).toEqual(utc('2026-07-31'));
  });
});

describe('nextPaymentDate', () => {
  it('si el vencimiento del último resumen no pasó, es el próximo', () => {
    // Cierre 10, vencimiento 20: el 12/07 el resumen cerrado el 10/07 vence el 20/07.
    expect(nextPaymentDate(10, 20, utc('2026-07-12'))).toEqual(utc('2026-07-20'));
  });

  it('el mismo día del vencimiento todavía cuenta como próximo', () => {
    expect(nextPaymentDate(10, 20, utc('2026-07-20'))).toEqual(utc('2026-07-20'));
  });

  it('si el vencimiento ya pasó, salta al del ciclo vigente', () => {
    // El 25/07 el vencimiento del 20/07 ya pasó: el próximo es el del cierre 10/08.
    expect(nextPaymentDate(10, 20, utc('2026-07-25'))).toEqual(utc('2026-08-20'));
  });

  it('vencimiento con wrap al mes siguiente del cierre', () => {
    // Cierre 28, vencimiento 5: el 12/07 el resumen cerrado el 28/06 vence el 05/07 (ya pasó);
    // el próximo es el del cierre 28/07 → 05/08.
    expect(nextPaymentDate(28, 5, utc('2026-07-12'))).toEqual(utc('2026-08-05'));
    // El 03/07 aún no venció el del cierre de junio.
    expect(nextPaymentDate(28, 5, utc('2026-07-03'))).toEqual(utc('2026-07-05'));
  });

  it('con cierre y vencimiento clampeados al mismo día, el próximo pago queda después del cierre', () => {
    // Cierre 30 / vencimiento 31 el mismo 30/4: el pago del ciclo que cierra ese día es el 1/5.
    expect(nextPaymentDate(30, 31, utc('2026-04-30'))).toEqual(utc('2026-05-01'));
  });
});
