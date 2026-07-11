import { describe, expect, it } from 'vitest';
import { debtReminderContent, isDebtReminderDue, remainingBalance } from './debts';

describe('remainingBalance', () => {
  it('resta lo pagado del total', () => {
    expect(remainingBalance(1000, 300)).toBe(700);
  });

  it('nunca es negativo aunque se pague de más', () => {
    expect(remainingBalance(1000, 1200)).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    expect(remainingBalance(100.1, 33.33)).toBe(66.77);
  });
});

describe('isDebtReminderDue', () => {
  const today = new Date('2026-07-11T00:00:00.000Z');

  it('avisa si el vencimiento está dentro de la ventana (3 días)', () => {
    const dueDate = new Date('2026-07-14T00:00:00.000Z');
    expect(isDebtReminderDue(dueDate, null, today)).toBe(true);
  });

  it('no avisa si el vencimiento está más allá de la ventana', () => {
    const dueDate = new Date('2026-07-20T00:00:00.000Z');
    expect(isDebtReminderDue(dueDate, null, today)).toBe(false);
  });

  it('avisa el mismo día del vencimiento', () => {
    expect(isDebtReminderDue(today, null, today)).toBe(true);
  });

  it('avisa si la deuda ya está vencida (no tiene próximo período que la reemplace)', () => {
    const dueDate = new Date('2026-07-05T00:00:00.000Z');
    expect(isDebtReminderDue(dueDate, null, today)).toBe(true);
  });

  it('no duplica el aviso si ya se recordó para este vencimiento exacto', () => {
    const dueDate = new Date('2026-07-14T00:00:00.000Z');
    expect(isDebtReminderDue(dueDate, dueDate, today)).toBe(false);
  });

  it('vuelve a avisar si el usuario edita el vencimiento (lastRemindedFor queda desactualizado)', () => {
    const oldDueDate = new Date('2026-07-12T00:00:00.000Z');
    const newDueDate = new Date('2026-07-13T00:00:00.000Z');
    expect(isDebtReminderDue(newDueDate, oldDueDate, today)).toBe(true);
  });

  it('respeta un umbral custom', () => {
    const dueDate = new Date('2026-07-16T00:00:00.000Z');
    expect(isDebtReminderDue(dueDate, null, today, 5)).toBe(true);
    expect(isDebtReminderDue(dueDate, null, today, 2)).toBe(false);
  });
});

describe('debtReminderContent', () => {
  const dueDate = new Date('2026-07-14T00:00:00.000Z');

  it('para I_OWE avisa que hay que pagar', () => {
    const { title, body } = debtReminderContent({
      direction: 'I_OWE',
      counterparty: 'Juan',
      dueDate,
      remainingBalance: 1500,
    });
    expect(title).toContain('Deuda por vencer');
    expect(body).toContain('Tu deuda con Juan vence el 2026-07-14');
    expect(body).toContain('1500.00');
  });

  it('para OWED_TO_ME avisa que hay que cobrar', () => {
    const { title, body } = debtReminderContent({
      direction: 'OWED_TO_ME',
      counterparty: 'María',
      dueDate,
      remainingBalance: 800,
    });
    expect(title).toContain('Cobro por vencer');
    expect(body).toContain('María te debe');
    expect(body).toContain('por cobrar');
    expect(body).toContain('800.00');
  });
});
