import { Router } from 'express';
import { currentMonth, isValidMonth, monthLength, monthRange, shiftMonth, startOfTodayUTC } from '../lib/dates';
import { buildInvestmentsSummary, investmentMetrics, type PositionOp } from '../lib/investments';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { prisma } from '../prisma';

/** Ratio sobre el promedio histórico que dispara una alerta de anomalía por categoría. */
const ANOMALY_THRESHOLD = 1.5;
/** Cantidad de meses completos anteriores usados para el promedio de anomalías. */
const ANOMALY_WINDOW_MONTHS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deltaPercent(current: number, previous: number): number {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const month = typeof req.query.month === 'string' && isValidMonth(req.query.month)
      ? req.query.month
      : currentMonth();
    const { start, end } = monthRange(month);

    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const rangeStart = monthRange(months[0]).start;
    const rangeEnd = monthRange(months[months.length - 1]).end;
    const today = startOfTodayUTC();
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 14);

    // Días transcurridos del mes seleccionado: día de hoy si está en curso, mes completo si ya
    // terminó, 0 si todavía no empezó (evita dividir por cero al proyectar).
    const daysElapsed = today >= end ? monthLength(month) : today < start ? 0 : today.getUTCDate();

    const prevMonth = shiftMonth(month, -1);
    const prevRange = monthRange(prevMonth);
    // Ventana alineada por día para la comparación vs mes anterior, capeada a la duración del mes anterior.
    const alignedDays = daysElapsed === 0 ? 0 : Math.min(daysElapsed, monthLength(prevMonth));
    const currentWindowEnd = new Date(start);
    currentWindowEnd.setUTCDate(currentWindowEnd.getUTCDate() + alignedDays);
    const prevWindowEnd = new Date(prevRange.start);
    prevWindowEnd.setUTCDate(prevWindowEnd.getUTCDate() + alignedDays);

    const anomalyRangeStart = monthRange(shiftMonth(month, -ANOMALY_WINDOW_MONTHS)).start;

    // Ventana de la tendencia de patrimonio neto (12 meses), calculada acá para
    // poder despachar sus queries junto con el resto en una sola tanda.
    const nwMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
    const nwWindowStart = monthRange(nwMonths[0]).start;
    const nwWindowEnd = monthRange(nwMonths[nwMonths.length - 1]).end;

    // Todas las consultas salen en una sola tanda: ninguna depende del resultado
    // de otra, así la latencia total es ~1 ida y vuelta a la base en vez de varias.
    const [
      totals,
      monthTotals,
      monthTransactionCount,
      byCategory,
      monthlyRows,
      upcomingPayments,
      earliestTransaction,
      currentWindowByCategory,
      prevWindowByCategory,
      earliestExpenseByCategory,
      anomalyWindowRows,
      goalMonthTotals,
      activeDebts,
      debtPaymentSums,
      categories,
      committedAgg,
      initialBalancesAgg,
      activeInvestments,
      investmentOps,
      exchangeRates,
      deltaBeforeRows,
      nwMonthlyRows,
    ] = await Promise.all([
      // Balance histórico (todos los ingresos - todos los gastos). No excluye goalId: el balance
      // real de la cuenta sí baja con los aportes y sube con los retiros, eso es correcto.
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId },
        _sum: { amount: true },
      }),
      // Totales del mes seleccionado (excluye aportes/retiros de metas: no son gasto/ingreso real)
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: start, lt: end }, goalId: null },
        _sum: { amount: true },
      }),
      // Conteo de TODOS los movimientos del mes (sí incluye aportes/retiros de metas): alimenta
      // el footnote de Reportes sin que el cliente tenga que pedir un listado aparte (pageSize:1).
      prisma.transaction.count({ where: { userId, date: { gte: start, lt: end } } }),
      // Gastos por categoría del mes
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: 'EXPENSE', date: { gte: start, lt: end }, goalId: null },
        _sum: { amount: true },
      }),
      // Comparativa de los últimos 6 meses, agregada en la base
      prisma.$queryRaw<Array<{ month: string; type: string; total: number }>>`
        SELECT to_char("date", 'YYYY-MM') AS month, "type"::text AS type, SUM("amount")::float8 AS total
        FROM "Transaction"
        WHERE "userId" = ${userId} AND "date" >= ${rangeStart} AND "date" < ${rangeEnd} AND "goalId" IS NULL
        GROUP BY 1, 2
      `,
      // Próximos pagos (14 días)
      prisma.recurringExpense.findMany({
        where: { userId, active: true, nextDueDate: { gte: today, lte: horizon } },
        include: { category: true },
        orderBy: { nextDueDate: 'asc' },
      }),
      // Fecha de la transacción más antigua del usuario (elegibilidad de la proyección)
      prisma.transaction.aggregate({ where: { userId }, _min: { date: true } }),
      // Gasto por categoría en la ventana alineada del mes seleccionado
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: 'EXPENSE', date: { gte: start, lt: currentWindowEnd }, goalId: null },
        _sum: { amount: true },
      }),
      // Gasto por categoría en la misma ventana del mes anterior
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: 'EXPENSE', date: { gte: prevRange.start, lt: prevWindowEnd }, goalId: null },
        _sum: { amount: true },
      }),
      // Fecha del gasto más antiguo por categoría (elegibilidad de anomalías). Los aportes no
      // tienen categoría hoy, pero se blinda igual con goalId: null por si eso cambia.
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: 'EXPENSE', categoryId: { not: null }, goalId: null },
        _min: { date: true },
      }),
      // Gasto por categoría y mes en los últimos N meses completos (promedio de anomalías)
      prisma.$queryRaw<Array<{ categoryId: string | null; month: string; total: number }>>`
        SELECT "categoryId", to_char("date", 'YYYY-MM') AS month, SUM("amount")::float8 AS total
        FROM "Transaction"
        WHERE "userId" = ${userId} AND "type" = 'EXPENSE' AND "categoryId" IS NOT NULL
          AND "date" >= ${anomalyRangeStart} AND "date" < ${start} AND "goalId" IS NULL
        GROUP BY 1, 2
      `,
      // Aportes y retiros de metas del mes, para la línea "Ahorro en metas" (no son gasto/ingreso)
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: start, lt: end }, goalId: { not: null } },
        _sum: { amount: true },
      }),
      // Deudas activas (no saldadas) para el resumen "Debés / Te deben"
      prisma.debt.findMany({
        where: { userId, settledAt: null },
        select: { id: true, direction: true, totalAmount: true },
      }),
      // Pagos acumulados por deuda, para descontar del total original
      prisma.transaction.groupBy({
        by: ['debtId'],
        where: { userId, debtId: { not: null } },
        _sum: { amount: true },
      }),
      // Todas las categorías del usuario (pocas filas): evita una segunda tanda
      // dependiente de los categoryId que aparecen en los agregados.
      prisma.category.findMany({ where: { userId } }),
      // Gastos fijos comprometidos hasta fin del mes seleccionado (safe-to-spend)
      prisma.recurringExpense.aggregate({
        where: { userId, active: true, type: 'EXPENSE', nextDueDate: { gte: today, lt: end } },
        _sum: { amount: true },
      }),
      // Saldos iniciales de todas las cuentas
      prisma.account.aggregate({ where: { userId }, _sum: { initialBalance: true } }),
      // Inversiones activas para el resumen del portafolio
      prisma.investment.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, currency: true, currentPrice: true },
      }),
      // Operaciones solo de inversiones activas (las archivadas no entran al resumen)
      prisma.investmentOperation.findMany({
        where: { userId, investment: { archivedAt: null } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: { investmentId: true, type: true, quantity: true, unitPrice: true },
      }),
      prisma.exchangeRate.findMany({ where: { userId } }),
      // Delta acumulado (ingresos - gastos) previo a la ventana de patrimonio neto
      prisma.$queryRaw<Array<{ delta: number }>>`
        SELECT COALESCE(SUM(CASE WHEN "type" = 'INCOME' THEN "amount" ELSE -"amount" END), 0)::float8 AS delta
        FROM "Transaction"
        WHERE "userId" = ${userId} AND "date" < ${nwWindowStart}
      `,
      // Delta mensual dentro de la ventana de patrimonio neto
      prisma.$queryRaw<Array<{ month: string; delta: number }>>`
        SELECT to_char("date", 'YYYY-MM') AS month,
               SUM(CASE WHEN "type" = 'INCOME' THEN "amount" ELSE -"amount" END)::float8 AS delta
        FROM "Transaction"
        WHERE "userId" = ${userId} AND "date" >= ${nwWindowStart} AND "date" < ${nwWindowEnd}
        GROUP BY 1
      `,
    ]);

    const totalIncome = totals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const totalExpense = totals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;
    const monthIncome = monthTotals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const monthExpense = monthTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;

    // Ahorro neto en metas del mes: aportes (EXPENSE con goalId) menos retiros (INCOME con goalId).
    // Se muestra como línea propia ("Ahorro en metas") en vez de contarse como gasto o ingreso.
    const monthGoalContributed = goalMonthTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;
    const monthGoalWithdrawn = goalMonthTotals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const goalContributions = round2(monthGoalContributed - monthGoalWithdrawn);

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const expensesByCategory = byCategory
      .map((row) => {
        const category = row.categoryId ? categoryMap.get(row.categoryId) : undefined;
        return {
          categoryId: row.categoryId,
          categoryName: category?.name ?? 'Sin categoría',
          color: category?.color ?? '#9ca3af',
          total: row._sum.amount?.toNumber() ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    const totalsByMonth = new Map<string, { income: number; expense: number }>();
    for (const row of monthlyRows) {
      const entry = totalsByMonth.get(row.month) ?? { income: 0, expense: 0 };
      if (row.type === 'INCOME') entry.income = row.total;
      else entry.expense = row.total;
      totalsByMonth.set(row.month, entry);
    }
    const monthlyComparison = months.map((m) => {
      const entry = totalsByMonth.get(m);
      return {
        month: m,
        income: Math.round((entry?.income ?? 0) * 100) / 100,
        expense: Math.round((entry?.expense ?? 0) * 100) / 100,
      };
    });

    // --- Proyección fin de mes ---
    const hasEnoughHistoryForProjection =
      earliestTransaction._min.date !== null && earliestTransaction._min.date <= prevRange.start;
    const projectedMonthTotal =
      daysElapsed > 0 && hasEnoughHistoryForProjection
        ? round2((monthExpense / daysElapsed) * monthLength(month))
        : null;

    // --- Comparación vs mes anterior (alineada por día) ---
    const currentWindowByCategoryMap = new Map(
      currentWindowByCategory.map((row) => [row.categoryId, row._sum.amount?.toNumber() ?? 0]),
    );
    const prevWindowByCategoryMap = new Map(
      prevWindowByCategory.map((row) => [row.categoryId, row._sum.amount?.toNumber() ?? 0]),
    );
    const currentWindowTotal = round2(
      [...currentWindowByCategoryMap.values()].reduce((sum, v) => sum + v, 0),
    );
    const prevWindowTotal = round2([...prevWindowByCategoryMap.values()].reduce((sum, v) => sum + v, 0));

    let previousMonthComparison = null as null | {
      total: { current: number; previous: number; deltaPercent: number };
      byCategory: Array<{ categoryId: string; name: string; current: number; previous: number; deltaPercent: number }>;
    };
    if (prevWindowTotal > 0) {
      const comparedCategoryIds = new Set(
        [...currentWindowByCategoryMap.keys(), ...prevWindowByCategoryMap.keys()].filter(
          (id): id is string => id !== null,
        ),
      );
      const byCategoryDelta = Array.from(comparedCategoryIds)
        .map((id) => {
          const current = round2(currentWindowByCategoryMap.get(id) ?? 0);
          const previous = round2(prevWindowByCategoryMap.get(id) ?? 0);
          return {
            categoryId: id,
            name: categoryMap.get(id)?.name ?? 'Sin categoría',
            current,
            previous,
            deltaPercent: deltaPercent(current, previous),
          };
        })
        .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent));
      previousMonthComparison = {
        total: {
          current: currentWindowTotal,
          previous: prevWindowTotal,
          deltaPercent: deltaPercent(currentWindowTotal, prevWindowTotal),
        },
        byCategory: byCategoryDelta,
      };
    }

    // --- Alertas de anomalía por categoría ---
    const eligibleAnomalyCategoryIds = new Set(
      earliestExpenseByCategory
        .filter(
          (row): row is typeof row & { categoryId: string } =>
            row.categoryId !== null && row._min.date !== null && row._min.date <= anomalyRangeStart,
        )
        .map((row) => row.categoryId),
    );
    const anomalyMonthlyTotals = new Map<string, number>();
    for (const row of anomalyWindowRows) {
      if (!row.categoryId) continue;
      anomalyMonthlyTotals.set(row.categoryId, (anomalyMonthlyTotals.get(row.categoryId) ?? 0) + row.total);
    }
    const anomalies = expensesByCategory
      .filter((c): c is typeof c & { categoryId: string } => c.categoryId !== null && eligibleAnomalyCategoryIds.has(c.categoryId))
      .map((c) => {
        const avgAmount = round2((anomalyMonthlyTotals.get(c.categoryId) ?? 0) / ANOMALY_WINDOW_MONTHS);
        const percentOfAvg = avgAmount > 0 ? Math.round((c.total / avgAmount) * 100) : 0;
        return { categoryId: c.categoryId, name: c.categoryName, currentAmount: c.total, avgAmount, percentOfAvg };
      })
      .filter((a) => a.avgAmount > 0 && a.currentAmount > a.avgAmount * ANOMALY_THRESHOLD)
      .sort((a, b) => b.percentOfAvg - a.percentOfAvg);

    // --- Resumen de deudas activas (Debés / Te deben) ---
    const debtPaidMap = new Map(
      debtPaymentSums
        .filter((row): row is typeof row & { debtId: string } => row.debtId !== null)
        .map((row) => [row.debtId, row._sum.amount?.toNumber() ?? 0]),
    );
    const debtsSummary = activeDebts.reduce(
      (acc, debt) => {
        const remaining = Math.max(0, round2(debt.totalAmount.toNumber() - (debtPaidMap.get(debt.id) ?? 0)));
        if (debt.direction === 'I_OWE') acc.totalIOwe = round2(acc.totalIOwe + remaining);
        else acc.totalOwedToMe = round2(acc.totalOwedToMe + remaining);
        return acc;
      },
      { totalIOwe: 0, totalOwedToMe: 0 },
    );

    // --- Disponible para gastar (Safe-to-spend) ---
    // Balance real menos gastos fijos activos que todavía vencen antes de fin del mes seleccionado.
    // Patrimonio neto = saldos iniciales + ingresos - gastos (las transferencias se cancelan globalmente).
    const initialBalances = initialBalancesAgg._sum.initialBalance?.toNumber() ?? 0;
    const balance = round2(initialBalances + totalIncome - totalExpense);
    const committedExpenses = round2(committedAgg._sum.amount?.toNumber() ?? 0);
    const safeToSpend = {
      balance,
      committedExpenses,
      available: round2(balance - committedExpenses),
    };

    // --- Resumen de inversiones (portafolio en moneda base, al TC vigente) ---
    const invOpsById = new Map<string, PositionOp[]>();
    for (const op of investmentOps) {
      const list = invOpsById.get(op.investmentId) ?? [];
      list.push({ type: op.type, quantity: op.quantity.toNumber(), unitPrice: op.unitPrice.toNumber() });
      invOpsById.set(op.investmentId, list);
    }
    const investmentsSummary = buildInvestmentsSummary(
      activeInvestments.map((inv) => {
        const metrics = investmentMetrics(inv.currentPrice?.toNumber() ?? null, invOpsById.get(inv.id) ?? []);
        return { currency: inv.currency, investedCost: metrics.investedCost, currentValue: metrics.currentValue };
      }),
      new Map(exchangeRates.map((r) => [r.currency, r.rate.toNumber()])),
    );

    // --- Tendencia de patrimonio neto (12 meses) ---
    // Se reconstruye desde el historial: patrimonio a fin de mes = saldos iniciales
    // + (ingresos - gastos) acumulados hasta ese mes. Las transferencias se cancelan globalmente.
    const nwDeltaByMonth = new Map(nwMonthlyRows.map((r) => [r.month, r.delta]));
    let runningNetWorth = initialBalances + (deltaBeforeRows[0]?.delta ?? 0);
    const netWorthTrend = nwMonths.map((m) => {
      runningNetWorth += nwDeltaByMonth.get(m) ?? 0;
      return { month: m, netWorth: round2(runningNetWorth) };
    });

    res.json({
      balance,
      month,
      monthIncome,
      monthExpense,
      monthTransactionCount,
      goalContributions,
      expensesByCategory,
      monthlyComparison,
      netWorthTrend,
      upcomingPayments: serialize(upcomingPayments),
      insights: {
        projectedMonthTotal,
        previousMonthComparison,
        anomalies,
      },
      debtsSummary,
      safeToSpend,
      investmentsSummary,
    });
  }),
);

export default router;
