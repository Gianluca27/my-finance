import { Router } from 'express';
import { z } from 'zod';
import { budgetCarryOver, budgetPercentUsed, effectiveStartMonth } from '../lib/budgets';
import { consolidateToBase, sumInBase, type ConsolidatedTotals } from '../lib/currency';
import { currentMonth, isValidMonth, monthKeyOf, monthRange } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const budgetSchema = z.object({
  // null = presupuesto global (techo total del mes).
  categoryId: z.string().nullable(),
  amount: z.number().positive().max(999_999_999),
  alertThreshold: z.number().int().min(1).max(100).default(80),
  // Opcional a propósito: si el cliente lo omite (p. ej. el mobile sólo manda
  // monto/umbral) NO se toca el arrastre, para no borrar la base acumulada.
  rollover: z.boolean().optional(),
});

/**
 * Gasto real (excluye aportes a metas) por mes y por moneda de cuenta de una serie
 * de transacciones: mes "YYYY-MM" -> (moneda -> suma nominal). La conversión a
 * moneda base se hace después, por mes (spec 19, fase C).
 */
function bucketSpentByMonthCurrency(
  txs: Array<{ date: Date; amount: { toNumber(): number }; accountId: string }>,
  currencyOf: (accountId: string) => string,
): Map<string, Map<string, number>> {
  const byMonth = new Map<string, Map<string, number>>();
  for (const t of txs) {
    const k = monthKeyOf(t.date);
    const byCurrency = byMonth.get(k) ?? new Map<string, number>();
    const currency = currencyOf(t.accountId);
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + t.amount.toNumber());
    byMonth.set(k, byCurrency);
  }
  return byMonth;
}

/**
 * Lista presupuestos con el gasto acumulado del mes indicado (?month=YYYY-MM, default actual).
 *
 * Multi-moneda (spec 19, fase C): los presupuestos están SIEMPRE en la moneda base del
 * usuario. El `spent` agrupa los gastos por moneda de cuenta y los convierte a base con la
 * cotización VIGENTE — aproximación documentada en la spec: no hay historial de rates, así
 * que un gasto USD de hace semanas se valúa al TC de hoy (igual criterio en el arrastre del
 * rollover). Las monedas sin cotización quedan fuera de `spent` y se reportan por presupuesto
 * en `missingRates` para que la UI avise.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const month =
      typeof req.query.month === 'string' && isValidMonth(req.query.month)
        ? req.query.month
        : currentMonth();
    const { start, end } = monthRange(month);
    const userId = req.auth!.userId;

    const [budgets, accountRows, rateRows, userRow] = await Promise.all([
      prisma.budget.findMany({
        where: { userId },
        include: { category: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.account.findMany({ where: { userId }, select: { id: true, currency: true } }),
      prisma.exchangeRate.findMany({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
    ]);

    const baseCurrency = userRow?.baseCurrency ?? 'ARS';
    const rateMap = new Map(rateRows.map((r) => [r.currency, r.rate.toNumber()]));
    const currencyByAccount = new Map(accountRows.map((a) => [a.id, a.currency]));
    const currencyOf = (accountId: string) => currencyByAccount.get(accountId) ?? 'ARS';

    const categoryBudgets = budgets.filter(
      (b): b is (typeof b) & { categoryId: string } => b.categoryId !== null,
    );
    const globalBudget = budgets.find((b) => b.categoryId === null) ?? null;

    // Gasto del mes por categoría presupuestada y cuenta (la cuenta aporta la moneda).
    // Los aportes a metas no son gasto real.
    const spentByCategory = await prisma.transaction.groupBy({
      by: ['categoryId', 'accountId'],
      where: {
        userId,
        type: 'EXPENSE',
        date: { gte: start, lt: end },
        categoryId: { in: categoryBudgets.map((b) => b.categoryId) },
        goalId: null,
      },
      _sum: { amount: true },
    });
    const spentRowsByCategory = new Map<string, Array<{ currency: string; amount: number }>>();
    for (const row of spentByCategory) {
      if (!row.categoryId) continue;
      const list = spentRowsByCategory.get(row.categoryId) ?? [];
      list.push({ currency: currencyOf(row.accountId), amount: row._sum.amount?.toNumber() ?? 0 });
      spentRowsByCategory.set(row.categoryId, list);
    }
    const spentMap = new Map<string, ConsolidatedTotals>();
    for (const [catId, rows] of spentRowsByCategory) {
      spentMap.set(catId, sumInBase(rows, baseCurrency, rateMap));
    }

    // Gasto total del mes (todas las categorías) para el presupuesto global.
    let globalSpentC: ConsolidatedTotals = { total: 0, converted: false, missingRates: [] };
    if (globalBudget) {
      const rows = await prisma.transaction.groupBy({
        by: ['accountId'],
        where: {
          userId,
          type: 'EXPENSE',
          date: { gte: start, lt: end },
          goalId: null,
        },
        _sum: { amount: true },
      });
      globalSpentC = sumInBase(
        rows.map((r) => ({ currency: currencyOf(r.accountId), amount: r._sum.amount?.toNumber() ?? 0 })),
        baseCurrency,
        rateMap,
      );
    }

    // Para los presupuestos con rollover hace falta el gasto de los meses previos
    // (hasta 12 atrás). Se trae una sola vez y se agrupa en memoria por (categoría, mes, moneda).
    const rolloverCategoryIds = categoryBudgets.filter((b) => b.rollover).map((b) => b.categoryId);
    const globalRollover = !!globalBudget?.rollover;
    const carryWindowStart = monthRange(effectiveStartMonth(month, null)).start; // 12 meses atrás
    const spentByCategoryMonth = new Map<string, Map<string, Map<string, number>>>();
    let globalSpentByMonth = new Map<string, Map<string, number>>();

    if (globalRollover || rolloverCategoryIds.length > 0) {
      const priorTxs = await prisma.transaction.findMany({
        where: {
          userId,
          type: 'EXPENSE',
          goalId: null,
          date: { gte: carryWindowStart, lt: start },
          // Si el global acumula, hace falta todo el gasto; si no, solo las categorías con rollover.
          ...(globalRollover ? {} : { categoryId: { in: rolloverCategoryIds } }),
        },
        select: { date: true, amount: true, categoryId: true, accountId: true },
      });
      if (globalRollover) globalSpentByMonth = bucketSpentByMonthCurrency(priorTxs, currencyOf);
      for (const catId of rolloverCategoryIds) {
        spentByCategoryMonth.set(
          catId,
          bucketSpentByMonthCurrency(priorTxs.filter((t) => t.categoryId === catId), currencyOf),
        );
      }
    }

    function statusFor(
      budget: (typeof budgets)[number],
      spentC: ConsolidatedTotals,
      monthBucket: (m: string) => ReadonlyMap<string, number> | undefined,
    ) {
      const amount = budget.amount.toNumber();
      // Unión de monedas sin cotización (mes visible + meses del arrastre) por presupuesto.
      const missing = new Set(spentC.missingRates);
      let converted = spentC.converted;
      let carryOver = 0;
      if (budget.rollover) {
        const startMonth = effectiveStartMonth(
          month,
          budget.rolloverStartMonth ? monthKeyOf(budget.rolloverStartMonth) : null,
        );
        carryOver = budgetCarryOver({
          amount,
          targetMonth: month,
          startMonth,
          // El gasto de cada mes previo también se consolida a base al TC vigente
          // (misma aproximación que el mes visible).
          spentByMonth: (m) => {
            const bucket = monthBucket(m);
            if (!bucket) return 0;
            const totals = consolidateToBase(bucket, baseCurrency, rateMap);
            for (const c of totals.missingRates) missing.add(c);
            converted = converted || totals.converted;
            return totals.total;
          },
        });
      }
      const effectiveLimit = amount + carryOver;
      return {
        ...(serialize(budget) as Record<string, unknown>),
        spent: spentC.total,
        carryOver,
        effectiveLimit,
        percentUsed: budgetPercentUsed(spentC.total, effectiveLimit),
        month,
        baseCurrency,
        converted,
        missingRates: Array.from(missing).sort(),
      };
    }

    const emptySpent: ConsolidatedTotals = { total: 0, converted: false, missingRates: [] };
    const result = [
      ...(globalBudget
        ? [statusFor(globalBudget, globalSpentC, (m) => globalSpentByMonth.get(m))]
        : []),
      ...categoryBudgets.map((budget) =>
        statusFor(budget, spentMap.get(budget.categoryId) ?? emptySpent, (m) =>
          spentByCategoryMonth.get(budget.categoryId)?.get(m),
        ),
      ),
    ];
    res.json(result);
  }),
);

/**
 * Crea o actualiza un presupuesto (upsert por categoría, o el único global si
 * categoryId es null). Al activar el rollover se registra el mes de arranque para
 * arrastrar sólo desde ahí; al desactivarlo se limpia.
 */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const input = budgetSchema.parse(req.body);

    if (input.categoryId !== null) {
      const category = await prisma.category.findFirst({
        where: { id: input.categoryId, userId: req.auth!.userId },
      });
      if (!category) throw new HttpError(400, 'Categoría inválida');
      if (category.type !== 'EXPENSE') {
        throw new HttpError(400, 'Solo se pueden presupuestar categorías de gasto');
      }
    }

    // Presupuesto vigente (para saber si el rollover cambia de estado).
    const existing =
      input.categoryId === null
        ? await prisma.budget.findFirst({
            where: { userId: req.auth!.userId, categoryId: null },
          })
        : await prisma.budget.findUnique({
            where: {
              userId_categoryId: { userId: req.auth!.userId, categoryId: input.categoryId },
            },
          });

    // El rollover sólo se modifica cuando el cliente lo envía; si se omite, no se
    // pisa (ni el flag ni el mes de arranque) para no destruir la base de arrastre.
    // El mes de arranque se fija al pasar false→true y se limpia al desactivar.
    let rolloverData: { rollover: boolean; rolloverStartMonth: Date | null } | null = null;
    if (input.rollover !== undefined) {
      let rolloverStartMonth: Date | null;
      if (!input.rollover) {
        rolloverStartMonth = null;
      } else if (existing?.rollover) {
        rolloverStartMonth = existing.rolloverStartMonth; // ya estaba activo: se respeta el arranque
      } else {
        rolloverStartMonth = monthRange(currentMonth()).start;
      }
      rolloverData = { rollover: input.rollover, rolloverStartMonth };
    }

    const baseData = {
      amount: input.amount,
      alertThreshold: input.alertThreshold,
      lastAlertMonth: null,
    };
    // Update: sólo incluye rollover si el cliente lo mandó (si no, se conserva).
    const updateData = { ...baseData, ...(rolloverData ?? {}) };
    // Create: si no llegó rollover, arranca desactivado.
    const createData = {
      ...baseData,
      ...(rolloverData ?? { rollover: false, rolloverStartMonth: null }),
    };

    // Categoría: upsert atómico por el unique compuesto (evita duplicados en doble submit).
    // Global: no se puede filtrar por null en un unique compuesto, así que va find-or-create
    // (el índice único parcial garantiza uno solo).
    const budget =
      input.categoryId !== null
        ? await prisma.budget.upsert({
            where: {
              userId_categoryId: { userId: req.auth!.userId, categoryId: input.categoryId },
            },
            update: updateData,
            create: { ...createData, userId: req.auth!.userId, categoryId: input.categoryId },
            include: { category: true },
          })
        : existing
          ? await prisma.budget.update({
              where: { id: existing.id },
              data: updateData,
              include: { category: true },
            })
          : await prisma.budget.create({
              data: { ...createData, userId: req.auth!.userId, categoryId: null },
              include: { category: true },
            });
    res.json(serialize(budget));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.budget.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Presupuesto no encontrado');
    await prisma.budget.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
