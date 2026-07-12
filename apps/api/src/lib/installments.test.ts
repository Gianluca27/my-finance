import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  installmentAmountAt,
  installmentDueDate,
  installmentPlanError,
  nextInstallment,
  paidInstallmentsCount,
  planFromDebt,
  perInstallmentAmount,
  type InstallmentPlan,
} from './installments';

/** $1200 en 12 cuotas de $100 desde el 10/8 (escenario de la spec 17). */
const PLAN_1200: InstallmentPlan = {
  totalAmount: 1200,
  installmentCount: 12,
  installmentAmount: null,
  firstDueDate: new Date(Date.UTC(2026, 7, 10)),
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('buildSchedule', () => {
  it('deriva 12 vencimientos mensuales el día 10 con monto total/count', () => {
    const schedule = buildSchedule(PLAN_1200, 0);
    expect(schedule).toHaveLength(12);
    expect(schedule.every((c) => c.amount === 100)).toBe(true);
    expect(schedule.every((c) => c.dueDate.getUTCDate() === 10)).toBe(true);
    expect(iso(schedule[0].dueDate)).toBe('2026-08-10');
    expect(iso(schedule[4].dueDate)).toBe('2026-12-10');
    // Cruce de año: cuota 6 en enero del año siguiente.
    expect(iso(schedule[5].dueDate)).toBe('2027-01-10');
    expect(iso(schedule[11].dueDate)).toBe('2027-07-10');
  });

  it('con 2 cuotas pagadas marca 1 y 2 como pagas y la próxima es la 3', () => {
    const schedule = buildSchedule(PLAN_1200, 200);
    expect(schedule.filter((c) => c.paid).map((c) => c.n)).toEqual([1, 2]);
    const next = nextInstallment(schedule);
    expect(next?.n).toBe(3);
    expect(iso(next!.dueDate)).toBe('2026-10-10');
    expect(next?.amount).toBe(100);
  });

  it('con todas pagas no hay próxima cuota', () => {
    expect(nextInstallment(buildSchedule(PLAN_1200, 1200))).toBeNull();
  });
});

describe('paidInstallmentsCount', () => {
  it('un pago parcial de $50 no avanza el contador hasta completar los $100', () => {
    expect(paidInstallmentsCount(PLAN_1200, 50)).toBe(0);
    // Al acumular $110 se completa la primera cuota (el resto queda a cuenta de la 2).
    expect(paidInstallmentsCount(PLAN_1200, 110)).toBe(1);
    expect(paidInstallmentsCount(PLAN_1200, 200)).toBe(2);
  });

  it('tolera ruido de punto flotante en la suma de pagos', () => {
    // 0.1 + 0.2 !== 0.3: una suma de pagos que "casi" llega a 300 debe contar 3 cuotas.
    expect(paidInstallmentsCount(PLAN_1200, 299.99999999999994)).toBe(3);
  });

  it('pagado el total, todas las cuotas cuentan aunque la última sea menor', () => {
    // Última cuota ajustada a $50: floor(1150/100) daría 11, pero la deuda está completa.
    const plan: InstallmentPlan = { ...PLAN_1200, totalAmount: 1150, installmentAmount: 100 };
    expect(paidInstallmentsCount(plan, 1150)).toBe(12);
    expect(paidInstallmentsCount(plan, 1100)).toBe(11);
  });

  it('nunca supera la cantidad de cuotas', () => {
    const plan: InstallmentPlan = { ...PLAN_1200, installmentAmount: 50 };
    expect(paidInstallmentsCount(plan, 1000)).toBe(12);
  });
});

describe('installmentDueDate (clamp de fin de mes)', () => {
  const jan31 = new Date(Date.UTC(2026, 0, 31));

  it('primer vencimiento el 31 clampea en meses cortos sin arrastrar el día', () => {
    expect(iso(installmentDueDate(jan31, 1))).toBe('2026-01-31');
    expect(iso(installmentDueDate(jan31, 2))).toBe('2026-02-28');
    // Marzo vuelve al 31: el clamp es por mes, no se arrastra el 28 de febrero.
    expect(iso(installmentDueDate(jan31, 3))).toBe('2026-03-31');
    expect(iso(installmentDueDate(jan31, 4))).toBe('2026-04-30');
  });

  it('respeta el 29 de febrero en año bisiesto', () => {
    expect(iso(installmentDueDate(new Date(Date.UTC(2027, 11, 31)), 3))).toBe('2028-02-29');
  });
});

describe('montos por cuota', () => {
  it('la última cuota ajusta la diferencia contra el total', () => {
    // $1000 en 3: 333.33 + 333.33 + 333.34.
    const plan: InstallmentPlan = {
      totalAmount: 1000,
      installmentCount: 3,
      installmentAmount: null,
      firstDueDate: new Date(Date.UTC(2026, 7, 10)),
    };
    expect(perInstallmentAmount(plan)).toBe(333.33);
    expect(installmentAmountAt(plan, 1)).toBe(333.33);
    expect(installmentAmountAt(plan, 3)).toBe(333.34);
    expect(buildSchedule(plan, 0).reduce((sum, c) => sum + c.amount, 0)).toBeCloseTo(1000, 2);
  });

  it('con monto explícito menor, la última cuota absorbe el resto', () => {
    const plan: InstallmentPlan = { ...PLAN_1200, installmentAmount: 90 };
    expect(installmentAmountAt(plan, 12)).toBe(210);
  });
});

describe('planFromDebt', () => {
  const decimal = (n: number) => ({ toNumber: () => n });

  it('campos en null = deuda simple sin plan (comportamiento legacy intacto)', () => {
    expect(
      planFromDebt({ totalAmount: decimal(500), installmentCount: null, installmentAmount: null, firstDueDate: null }),
    ).toBeNull();
  });

  it('convierte los Decimal de Prisma a números', () => {
    const plan = planFromDebt({
      totalAmount: decimal(1200),
      installmentCount: 12,
      installmentAmount: decimal(100),
      firstDueDate: new Date(Date.UTC(2026, 7, 10)),
    });
    expect(plan).toEqual({
      totalAmount: 1200,
      installmentCount: 12,
      installmentAmount: 100,
      firstDueDate: new Date(Date.UTC(2026, 7, 10)),
    });
  });
});

describe('installmentPlanError', () => {
  const base = { totalAmount: 1200, installmentCount: null, installmentAmount: null, firstDueDate: null };
  const first = new Date(Date.UTC(2026, 7, 10));

  it('todos null (deuda simple) es válido', () => {
    expect(installmentPlanError(base)).toBeNull();
  });

  it('count sin firstDueDate (o al revés) es incoherente', () => {
    expect(installmentPlanError({ ...base, installmentCount: 12 })).toMatch(/primer vencimiento/);
    expect(installmentPlanError({ ...base, firstDueDate: first })).toMatch(/cantidad de cuotas/);
    expect(installmentPlanError({ ...base, installmentAmount: 100 })).toMatch(/cantidad de cuotas/);
  });

  it('amount × count no necesita igualar el total, pero la última cuota debe quedar positiva', () => {
    const valid = { ...base, installmentCount: 12, firstDueDate: first };
    expect(installmentPlanError(valid)).toBeNull();
    expect(installmentPlanError({ ...valid, installmentAmount: 90 })).toBeNull();
    expect(installmentPlanError({ ...valid, installmentAmount: 105 })).toBeNull();
    // 12 × 110: las primeras 11 ya cubren $1210 > $1200.
    expect(installmentPlanError({ ...valid, installmentAmount: 110 })).toMatch(/última cuota/);
  });
});
