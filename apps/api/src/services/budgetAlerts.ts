import type { Budget, Category } from '@prisma/client';
import { budgetCarryOver, budgetPercentUsed, effectiveStartMonth } from '../lib/budgets';
import { currentMonth, monthKeyOf, monthRange } from '../lib/dates';
import { prisma } from '../prisma';
import { notifyUser } from './notifications';

type BudgetWithCategory = Budget & { category: Category | null };

/**
 * Tras registrar un gasto, revisa si el presupuesto de su categoría y/o el
 * presupuesto global (techo total del mes) superaron su umbral de alerta este
 * mes. Envía como máximo una alerta por mes por presupuesto. Un gasto sin
 * categoría igual puede disparar la alerta global.
 */
export async function checkBudgetAlert(userId: string, categoryId: string | null): Promise<void> {
  const budgets = await prisma.budget.findMany({
    where: {
      userId,
      // El presupuesto de la categoría del gasto (si tiene) + el global (categoryId null).
      OR: [...(categoryId ? [{ categoryId }] : []), { categoryId: null }],
    },
    include: { category: true },
  });
  const month = currentMonth();
  await Promise.all(budgets.map((budget) => evaluateBudget(userId, budget, month)));
}

async function evaluateBudget(
  userId: string,
  budget: BudgetWithCategory,
  month: string,
): Promise<void> {
  if (budget.lastAlertMonth === month) return;

  const isGlobal = budget.categoryId === null;
  const { start, end } = monthRange(month);
  // goalId: null — los aportes a metas no cuentan como gasto (mismo criterio que budgets.ts).
  const agg = await prisma.transaction.aggregate({
    where: {
      userId,
      type: 'EXPENSE',
      date: { gte: start, lt: end },
      goalId: null,
      ...(isGlobal ? {} : { categoryId: budget.categoryId }),
    },
    _sum: { amount: true },
  });
  const spent = agg._sum.amount?.toNumber() ?? 0;
  const amount = budget.amount.toNumber();

  let effectiveLimit = amount;
  if (budget.rollover) {
    effectiveLimit = amount + (await computeCarry(userId, budget, month));
  }

  const percent = budgetPercentUsed(spent, effectiveLimit);
  if (percent < budget.alertThreshold) return;

  await prisma.budget.update({ where: { id: budget.id }, data: { lastAlertMonth: month } });

  const label = isGlobal ? 'Presupuesto total del mes' : `Presupuesto de ${budget.category?.name}`;
  const where = isGlobal ? 'este mes' : `en ${budget.category?.name} este mes`;
  const title = `${label} al ${percent}%`;
  const body = `Llevás gastados $${spent.toFixed(2)} de $${effectiveLimit.toFixed(2)} ${where} (umbral: ${budget.alertThreshold}%).`;
  await notifyUser(userId, {
    title,
    body,
    emailHtml: `<h2>${title}</h2><p>${body}</p>`,
  });
}

/** Arrastre entrante del mes para un presupuesto con rollover (gasto de meses previos). */
async function computeCarry(
  userId: string,
  budget: BudgetWithCategory,
  month: string,
): Promise<number> {
  const startMonth = effectiveStartMonth(
    month,
    budget.rolloverStartMonth ? monthKeyOf(budget.rolloverStartMonth) : null,
  );
  if (startMonth >= month) return 0; // rollover recién activado: nada que arrastrar

  const windowStart = monthRange(startMonth).start;
  const windowEnd = monthRange(month).start; // exclusivo: hasta el mes actual
  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      type: 'EXPENSE',
      goalId: null,
      date: { gte: windowStart, lt: windowEnd },
      ...(budget.categoryId === null ? {} : { categoryId: budget.categoryId }),
    },
    select: { date: true, amount: true },
  });
  const byMonth = new Map<string, number>();
  for (const t of txs) {
    const k = monthKeyOf(t.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount.toNumber());
  }
  return budgetCarryOver({
    amount: budget.amount.toNumber(),
    targetMonth: month,
    startMonth,
    spentByMonth: (m) => byMonth.get(m) ?? 0,
  });
}
