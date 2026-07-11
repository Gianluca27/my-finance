import { currentMonth, monthRange } from '../lib/dates';
import { prisma } from '../prisma';
import { notifyUser } from './notifications';

/**
 * Tras registrar un gasto, revisa si el presupuesto de la categoría superó su
 * umbral de alerta este mes. Envía como máximo una alerta por mes por presupuesto.
 */
export async function checkBudgetAlert(userId: string, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const budget = await prisma.budget.findUnique({
    where: { userId_categoryId: { userId, categoryId } },
    include: { category: true },
  });
  if (!budget) return;

  const month = currentMonth();
  if (budget.lastAlertMonth === month) return;

  const { start, end } = monthRange(month);
  // goalId: null — los aportes a metas no cuentan como gasto (mismo criterio que budgets.ts).
  const agg = await prisma.transaction.aggregate({
    where: { userId, categoryId, type: 'EXPENSE', date: { gte: start, lt: end }, goalId: null },
    _sum: { amount: true },
  });
  const spent = agg._sum.amount?.toNumber() ?? 0;
  const limit = budget.amount.toNumber();
  if (limit <= 0) return;

  const percent = Math.round((spent / limit) * 100);
  if (percent < budget.alertThreshold) return;

  await prisma.budget.update({
    where: { id: budget.id },
    data: { lastAlertMonth: month },
  });

  const title = `Presupuesto de ${budget.category.name} al ${percent}%`;
  const body = `Llevás gastados $${spent.toFixed(2)} de $${limit.toFixed(2)} en ${budget.category.name} este mes (umbral: ${budget.alertThreshold}%).`;
  await notifyUser(userId, {
    title,
    body,
    emailHtml: `<h2>${title}</h2><p>${body}</p>`,
  });
}
