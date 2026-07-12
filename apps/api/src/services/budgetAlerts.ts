import type { Budget, Category } from '@prisma/client';
import { budgetCarryOver, budgetPercentUsed, effectiveStartMonth } from '../lib/budgets';
import { consolidateToBase, moneyLabel, sumInBase } from '../lib/currency';
import { currentMonth, monthKeyOf, monthRange } from '../lib/dates';
import { prisma } from '../prisma';
import { notifyUser } from './notifications';

type BudgetWithCategory = Budget & { category: Category | null };

/** Moneda base + cotizaciones + moneda por cuenta: contexto para consolidar el gasto. */
interface CurrencyContext {
  baseCurrency: string;
  rateMap: Map<string, number>;
  currencyOf: (accountId: string) => string;
}

/**
 * Tras registrar un gasto, revisa si el presupuesto de su categoría y/o el
 * presupuesto global (techo total del mes) superaron su umbral de alerta este
 * mes. Envía como máximo una alerta por mes por presupuesto. Un gasto sin
 * categoría igual puede disparar la alerta global.
 *
 * Multi-moneda (spec 19, fase C): el gasto se consolida a la moneda base del
 * usuario al TC vigente, igual que en `routes/budgets.ts` — el umbral se evalúa
 * sobre el mismo `spent` que muestra la UI. Los gastos en monedas sin cotización
 * quedan fuera (la página de Presupuestos es la que avisa de eso).
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
  if (budgets.length === 0) return;

  const [accountRows, rateRows, userRow] = await Promise.all([
    prisma.account.findMany({ where: { userId }, select: { id: true, currency: true } }),
    prisma.exchangeRate.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
  ]);
  const currencyByAccount = new Map(accountRows.map((a) => [a.id, a.currency]));
  const ctx: CurrencyContext = {
    baseCurrency: userRow?.baseCurrency ?? 'ARS',
    rateMap: new Map(rateRows.map((r) => [r.currency, r.rate.toNumber()])),
    currencyOf: (accountId) => currencyByAccount.get(accountId) ?? 'ARS',
  };

  const month = currentMonth();
  await Promise.all(budgets.map((budget) => evaluateBudget(userId, budget, month, ctx)));
}

async function evaluateBudget(
  userId: string,
  budget: BudgetWithCategory,
  month: string,
  ctx: CurrencyContext,
): Promise<void> {
  if (budget.lastAlertMonth === month) return;

  const isGlobal = budget.categoryId === null;
  const { start, end } = monthRange(month);
  // goalId: null — los aportes a metas no cuentan como gasto (mismo criterio que budgets.ts).
  // Agrupado por cuenta para consolidar cada moneda a base al TC vigente.
  const rows = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: {
      userId,
      type: 'EXPENSE',
      date: { gte: start, lt: end },
      goalId: null,
      ...(isGlobal ? {} : { categoryId: budget.categoryId }),
    },
    _sum: { amount: true },
  });
  const spent = sumInBase(
    rows.map((r) => ({ currency: ctx.currencyOf(r.accountId), amount: r._sum.amount?.toNumber() ?? 0 })),
    ctx.baseCurrency,
    ctx.rateMap,
  ).total;
  const amount = budget.amount.toNumber();

  let effectiveLimit = amount;
  if (budget.rollover) {
    effectiveLimit = amount + (await computeCarry(userId, budget, month, ctx));
  }

  const percent = budgetPercentUsed(spent, effectiveLimit);
  if (percent < budget.alertThreshold) return;

  await prisma.budget.update({ where: { id: budget.id }, data: { lastAlertMonth: month } });

  const label = isGlobal ? 'Presupuesto total del mes' : `Presupuesto de ${budget.category?.name}`;
  const where = isGlobal ? 'este mes' : `en ${budget.category?.name} este mes`;
  const title = `${label} al ${percent}%`;
  const body = `Llevás gastados ${moneyLabel(spent, ctx.baseCurrency)} de ${moneyLabel(effectiveLimit, ctx.baseCurrency)} ${where} (umbral: ${budget.alertThreshold}%).`;
  await notifyUser(userId, {
    title,
    body,
    emailHtml: `<h2>${title}</h2><p>${body}</p>`,
  });
}

/** Arrastre entrante del mes para un presupuesto con rollover (gasto de meses previos,
 * consolidado a moneda base por mes, mismo criterio que `routes/budgets.ts`). */
async function computeCarry(
  userId: string,
  budget: BudgetWithCategory,
  month: string,
  ctx: CurrencyContext,
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
    select: { date: true, amount: true, accountId: true },
  });
  const byMonth = new Map<string, Map<string, number>>();
  for (const t of txs) {
    const k = monthKeyOf(t.date);
    const byCurrency = byMonth.get(k) ?? new Map<string, number>();
    const currency = ctx.currencyOf(t.accountId);
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + t.amount.toNumber());
    byMonth.set(k, byCurrency);
  }
  return budgetCarryOver({
    amount: budget.amount.toNumber(),
    targetMonth: month,
    startMonth,
    spentByMonth: (m) => {
      const bucket = byMonth.get(m);
      return bucket ? consolidateToBase(bucket, ctx.baseCurrency, ctx.rateMap).total : 0;
    },
  });
}
