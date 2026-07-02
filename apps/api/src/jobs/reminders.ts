import cron from 'node-cron';
import { config } from '../config';
import { advanceDueDate, startOfTodayUTC } from '../lib/dates';
import { prisma } from '../prisma';
import { notifyUser } from '../services/notifications';

/**
 * Job diario de recordatorios de pagos:
 * 1. Avanza los vencimientos ya pasados (si el usuario no registró el pago).
 * 2. Envía recordatorio cuando faltan <= reminderDaysBefore días para el vencimiento,
 *    una sola vez por vencimiento (lastRemindedFor).
 */
export async function runRemindersJob(): Promise<{ rolled: number; reminded: number }> {
  const today = startOfTodayUTC();
  let rolled = 0;
  let reminded = 0;

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
    include: { category: true },
  });
  for (const item of upcoming) {
    const msUntilDue = item.nextDueDate.getTime() - today.getTime();
    const daysUntilDue = Math.round(msUntilDue / 86_400_000);
    if (daysUntilDue > item.reminderDaysBefore) continue;
    if (item.lastRemindedFor && item.lastRemindedFor.getTime() === item.nextDueDate.getTime()) continue;

    const dueStr = item.nextDueDate.toISOString().slice(0, 10);
    const when = daysUntilDue === 0 ? 'vence hoy' : `vence en ${daysUntilDue} día${daysUntilDue === 1 ? '' : 's'} (${dueStr})`;
    const title = `Pago próximo: ${item.name}`;
    const body = `${item.name} por $${item.amount.toNumber().toFixed(2)} ${when}.`;

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

  return { rolled, reminded };
}

export function scheduleRemindersJob(): void {
  cron.schedule(config.remindersCron, async () => {
    try {
      const result = await runRemindersJob();
      console.log(`[reminders] rolled=${result.rolled} reminded=${result.reminded}`);
    } catch (err) {
      console.error('[reminders] Error en job de recordatorios:', err);
    }
  });
  console.log(`[reminders] Job programado: ${config.remindersCron}`);
}
