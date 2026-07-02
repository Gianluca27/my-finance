import type { Frequency } from '@prisma/client';

/** Devuelve la fecha (UTC, medianoche) de hoy. */
export function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Fecha UTC con el día clampeado a la longitud del mes (ej: 31 → 30/28). */
function utcDateClamped(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))));
}

/**
 * Calcula el próximo vencimiento >= `from` según frecuencia.
 * - WEEKLY: dueDay = día de semana 0-6 (0 = domingo)
 * - MONTHLY: dueDay = día del mes 1-31 (se clampea)
 * - YEARLY: dueDay + dueMonth (1-12)
 */
export function nextDueDate(
  frequency: Frequency,
  dueDay: number,
  dueMonth: number | null,
  from: Date = startOfTodayUTC(),
): Date {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

  if (frequency === 'WEEKLY') {
    const diff = (dueDay - base.getUTCDay() + 7) % 7;
    const result = new Date(base);
    result.setUTCDate(base.getUTCDate() + diff);
    return result;
  }

  if (frequency === 'MONTHLY') {
    const thisMonth = utcDateClamped(base.getUTCFullYear(), base.getUTCMonth(), dueDay);
    if (thisMonth >= base) return thisMonth;
    return utcDateClamped(base.getUTCFullYear(), base.getUTCMonth() + 1, dueDay);
  }

  // YEARLY
  const monthIndex = (dueMonth ?? 1) - 1;
  const thisYear = utcDateClamped(base.getUTCFullYear(), monthIndex, dueDay);
  if (thisYear >= base) return thisYear;
  return utcDateClamped(base.getUTCFullYear() + 1, monthIndex, dueDay);
}

/** Próximo vencimiento estrictamente posterior al actual (para avanzar tras un pago). */
export function advanceDueDate(
  frequency: Frequency,
  dueDay: number,
  dueMonth: number | null,
  current: Date,
): Date {
  const dayAfter = new Date(current);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return nextDueDate(frequency, dueDay, dueMonth, dayAfter);
}

/** Rango [inicio, fin) de un mes "YYYY-MM" en UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/** Resta `n` meses a un "YYYY-MM". */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
