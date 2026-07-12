import cron from 'node-cron';
import { config } from '../config';
import { moneyLabel } from '../lib/currency';
import { advanceDueDate, startOfTodayUTC } from '../lib/dates';
import { debtReminderContent, getPaidAmount, isDebtReminderDue, remainingBalance } from '../lib/debts';
import { buildSchedule, nextInstallment, planFromDebt } from '../lib/installments';
import { prisma } from '../prisma';
import { notifyUser } from '../services/notifications';

/**
 * Job diario de recordatorios de pagos:
 * 1. Avanza los vencimientos ya pasados de recurrentes (si el usuario no registró el pago).
 * 2. Envía recordatorio de recurrentes cuando faltan <= reminderDaysBefore días para el
 *    vencimiento, una sola vez por vencimiento (lastRemindedFor).
 * 3. Envía recordatorio de deudas por vencer (bloque propio, ver más abajo).
 */
export async function runRemindersJob(): Promise<{ rolled: number; reminded: number; debtsReminded: number }> {
  const today = startOfTodayUTC();
  let rolled = 0;
  let reminded = 0;
  let debtsReminded = 0;

  // 1. Vencimientos pasados → avanzar al próximo período
  const overdue = await prisma.recurringExpense.findMany({
    where: { active: true, nextDueDate: { lt: today } },
  });
  for (const item of overdue) {
    await prisma.recurringExpense.update({
      where: { id: item.id },
      data: { nextDueDate: advanceDueDate(item.frequency, item.dueDay, item.dueMonth, item.nextDueDate) },
    });
    rolled++;
  }

  // 2. Recordatorios de próximos vencimientos
  const upcoming = await prisma.recurringExpense.findMany({
    where: { active: true, nextDueDate: { gte: today } },
    include: { category: true, user: { select: { baseCurrency: true } } },
  });
  for (const item of upcoming) {
    const msUntilDue = item.nextDueDate.getTime() - today.getTime();
    const daysUntilDue = Math.round(msUntilDue / 86_400_000);
    if (daysUntilDue > item.reminderDaysBefore) continue;
    if (item.lastRemindedFor && item.lastRemindedFor.getTime() === item.nextDueDate.getTime()) continue;

    const dueStr = item.nextDueDate.toISOString().slice(0, 10);
    const isIncome = item.type === 'INCOME';
    const verb = isIncome ? 'se cobra' : 'vence';
    const when = daysUntilDue === 0 ? `${verb} hoy` : `${verb} en ${daysUntilDue} día${daysUntilDue === 1 ? '' : 's'} (${dueStr})`;
    const title = `${isIncome ? 'Cobro' : 'Pago'} próximo: ${item.name}`;
    // Los recurrentes no tienen moneda propia: sus montos se interpretan en la moneda base
    // del usuario (spec 19, fase C) — el símbolo del copy sale de ella, no de un "$" fijo.
    const body = `${item.name} por ${moneyLabel(item.amount.toNumber(), item.user.baseCurrency)} ${when}.`;

    await notifyUser(item.userId, {
      title,
      body,
      emailHtml: `<h2>${title}</h2><p>${body}</p><p>Categoría: ${item.category?.name ?? 'Sin categoría'}</p>`,
    });
    await prisma.recurringExpense.update({
      where: { id: item.id },
      data: { lastRemindedFor: item.nextDueDate },
    });
    reminded++;
  }

  // 3. Recordatorios de deudas por vencer. Bloque aislado (mismo patrón que runPricesJob): si
  //    falla, no debe perderse lo ya procesado arriba para los recurrentes.
  //    Para deudas en cuotas (spec 17) el vencimiento efectivo es el de la próxima cuota impaga
  //    y `lastRemindedFor` guarda esa fecha: al pagarse una cuota la fecha efectiva cambia y el
  //    recordatorio se rearma solo para la siguiente.
  try {
    const debts = await prisma.debt.findMany({
      where: { settledAt: null, OR: [{ dueDate: { not: null } }, { firstDueDate: { not: null } }] },
    });
    for (const debt of debts) {
      const plan = planFromDebt(debt);
      let effectiveDueDate = debt.dueDate;
      let paid: number | null = null;
      let installment: { n: number; count: number; amount: number } | undefined;
      if (plan) {
        paid = await getPaidAmount(debt.id);
        const next = nextInstallment(buildSchedule(plan, paid));
        if (!next) continue; // todas las cuotas pagas (deuda a punto de saldarse): nada que recordar
        effectiveDueDate = next.dueDate;
        installment = { n: next.n, count: plan.installmentCount, amount: next.amount };
      }
      if (!effectiveDueDate) continue;
      if (!isDebtReminderDue(effectiveDueDate, debt.lastRemindedFor, today)) continue;

      paid ??= await getPaidAmount(debt.id);
      const balance = remainingBalance(debt.totalAmount.toNumber(), paid);
      const { title, body } = debtReminderContent({
        direction: debt.direction,
        counterparty: debt.counterparty,
        dueDate: effectiveDueDate,
        remainingBalance: balance,
        currency: debt.currency,
        installment,
      });

      await notifyUser(debt.userId, { title, body, emailHtml: `<h2>${title}</h2><p>${body}</p>` });
      await prisma.debt.update({ where: { id: debt.id }, data: { lastRemindedFor: effectiveDueDate } });
      debtsReminded++;
    }
  } catch (err) {
    console.error('[reminders] Error en recordatorios de deudas:', err);
  }

  return { rolled, reminded, debtsReminded };
}

export function scheduleRemindersJob(): void {
  cron.schedule(config.remindersCron, async () => {
    try {
      const result = await runRemindersJob();
      console.log(
        `[reminders] rolled=${result.rolled} reminded=${result.reminded} debtsReminded=${result.debtsReminded}`,
      );
    } catch (err) {
      console.error('[reminders] Error en job de recordatorios:', err);
    }
  });
  console.log(`[reminders] Job programado: ${config.remindersCron}`);
}
