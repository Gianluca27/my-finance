import { Router } from 'express';
import { consolidateToBase, sumEntityAmounts } from '../lib/currency';
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
      accountRows,
      activeInvestments,
      investmentOps,
      exchangeRates,
      deltaBeforeRows,
      nwMonthlyRows,
      userRow,
      transferOutSums,
      transferInSums,
    ] = await Promise.all([
      // Balance histórico (todos los ingresos - todos los gastos), por cuenta para poder
      // agrupar por moneda. No excluye goalId: el balance real de la cuenta sí baja con
      // los aportes y sube con los retiros, eso es correcto.
      prisma.transaction.groupBy({
        by: ['type', 'accountId'],
        where: { userId },
        _sum: { amount: true },
      }),
      // Totales del mes seleccionado, por cuenta para agrupar por moneda
      // (excluye aportes/retiros de metas: no son gasto/ingreso real)
      prisma.transaction.groupBy({
        by: ['type', 'accountId'],
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
      // Aportes y retiros de metas del mes, por cuenta para agrupar por moneda
      // ("Ahorro en metas" se consolida a moneda base como flujo de caja del mes)
      prisma.transaction.groupBy({
        by: ['type', 'accountId'],
        where: { userId, date: { gte: start, lt: end }, goalId: { not: null } },
        _sum: { amount: true },
      }),
      // Deudas activas (no saldadas) para el resumen "Debés / Te deben", con su moneda
      prisma.debt.findMany({
        where: { userId, settledAt: null },
        select: { id: true, direction: true, totalAmount: true, currency: true },
      }),
      // Pagos vinculados a deudas: los cross-currency cuentan por su entityAmount (moneda
      // de la deuda), por eso se suman en memoria en vez de con groupBy.
      prisma.transaction.findMany({
        where: { userId, debtId: { not: null } },
        select: { debtId: true, amount: true, entityAmount: true },
      }),
      // Todas las categorías del usuario (pocas filas): evita una segunda tanda
      // dependiente de los categoryId que aparecen en los agregados.
      prisma.category.findMany({ where: { userId } }),
      // Gastos fijos comprometidos hasta fin del mes seleccionado (safe-to-spend)
      prisma.recurringExpense.aggregate({
        where: { userId, active: true, type: 'EXPENSE', nextDueDate: { gte: today, lt: end } },
        _sum: { amount: true },
      }),
      // Cuentas con su moneda y saldo inicial: base de todos los agregados por moneda
      prisma.account.findMany({ where: { userId }, select: { id: true, currency: true, initialBalance: true } }),
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
      // Delta acumulado previo a la ventana de patrimonio neto, por moneda de cuenta.
      // Incluye las patas de transferencias: entre monedas distintas NO se cancelan
      // (mueven valor de una moneda a otra); dentro de la misma moneda sí.
      prisma.$queryRaw<Array<{ currency: string; delta: number }>>`
        SELECT d.currency AS currency, SUM(d.delta)::float8 AS delta
        FROM (
          SELECT a."currency" AS currency, t."date" AS date,
                 CASE WHEN t."type" = 'INCOME' THEN t."amount" ELSE -t."amount" END AS delta
          FROM "Transaction" t JOIN "Account" a ON a."id" = t."accountId"
          WHERE t."userId" = ${userId}
          UNION ALL
          SELECT a."currency", tr."date", tr."amountTo"
          FROM "Transfer" tr JOIN "Account" a ON a."id" = tr."toAccountId"
          WHERE tr."userId" = ${userId}
          UNION ALL
          SELECT a."currency", tr."date", -tr."amount"
          FROM "Transfer" tr JOIN "Account" a ON a."id" = tr."fromAccountId"
          WHERE tr."userId" = ${userId}
        ) d
        WHERE d.date < ${nwWindowStart}
        GROUP BY 1
      `,
      // Delta mensual dentro de la ventana de patrimonio neto, por moneda de cuenta
      // (misma unión de movimientos + patas de transferencias que la query anterior).
      prisma.$queryRaw<Array<{ month: string; currency: string; delta: number }>>`
        SELECT to_char(d.date, 'YYYY-MM') AS month, d.currency AS currency, SUM(d.delta)::float8 AS delta
        FROM (
          SELECT a."currency" AS currency, t."date" AS date,
                 CASE WHEN t."type" = 'INCOME' THEN t."amount" ELSE -t."amount" END AS delta
          FROM "Transaction" t JOIN "Account" a ON a."id" = t."accountId"
          WHERE t."userId" = ${userId}
          UNION ALL
          SELECT a."currency", tr."date", tr."amountTo"
          FROM "Transfer" tr JOIN "Account" a ON a."id" = tr."toAccountId"
          WHERE tr."userId" = ${userId}
          UNION ALL
          SELECT a."currency", tr."date", -tr."amount"
          FROM "Transfer" tr JOIN "Account" a ON a."id" = tr."fromAccountId"
          WHERE tr."userId" = ${userId}
        ) d
        WHERE d.date >= ${nwWindowStart} AND d.date < ${nwWindowEnd}
        GROUP BY 1, 2
      `,
      // Moneda base del usuario para consolidar los totales
      prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
      // Transferencias enviadas/recibidas por cuenta: entran al balance por moneda
      prisma.transfer.groupBy({ by: ['fromAccountId'], where: { userId }, _sum: { amount: true } }),
      prisma.transfer.groupBy({ by: ['toAccountId'], where: { userId }, _sum: { amountTo: true } }),
    ]);

    // --- Consolidación multi-moneda (spec 19, fases A y B) ---
    // Balance, ingresos/gastos del mes, netWorthTrend, safe-to-spend, ahorro en metas y
    // resumen de deudas se agrupan por moneda y se convierten a la moneda base del usuario.
    // Las monedas sin cotización quedan fuera de los totales y se reportan en
    // `currency.missingRates` (deudas reportan las suyas en `debtsSummary.missingRates`).
    // El resto de los agregados (categorías, comparativas, anomalías) sigue sumando
    // nominales sin convertir: se consolidan en fase C.
    const baseCurrency = userRow?.baseCurrency ?? 'ARS';
    const rateMap = new Map(exchangeRates.map((r) => [r.currency, r.rate.toNumber()]));
    const currencyByAccount = new Map(accountRows.map((a) => [a.id, a.currency]));
    const addTo = (map: Map<string, number>, currency: string, value: number) =>
      map.set(currency, (map.get(currency) ?? 0) + value);
    const toCurrencyAmounts = (map: Map<string, number>) =>
      Array.from(map, ([currency, amount]) => ({ currency, amount: round2(amount) }));

    // Balance histórico por moneda: inicial + ingresos - gastos + transferencias
    // recibidas - enviadas (cada pata en la moneda de su cuenta).
    const balanceByCurrency = new Map<string, number>();
    for (const a of accountRows) addTo(balanceByCurrency, a.currency, a.initialBalance.toNumber());
    for (const row of totals) {
      const sign = row.type === 'INCOME' ? 1 : -1;
      addTo(balanceByCurrency, currencyByAccount.get(row.accountId) ?? 'ARS', sign * (row._sum.amount?.toNumber() ?? 0));
    }
    for (const row of transferInSums) {
      addTo(balanceByCurrency, currencyByAccount.get(row.toAccountId) ?? 'ARS', row._sum.amountTo?.toNumber() ?? 0);
    }
    for (const row of transferOutSums) {
      addTo(balanceByCurrency, currencyByAccount.get(row.fromAccountId) ?? 'ARS', -(row._sum.amount?.toNumber() ?? 0));
    }
    const balanceC = consolidateToBase(balanceByCurrency, baseCurrency, rateMap);
    const balance = balanceC.total;

    // Ingresos/gastos del mes por moneda, consolidados a base.
    const monthIncomeByCurrency = new Map<string, number>();
    const monthExpenseByCurrency = new Map<string, number>();
    for (const row of monthTotals) {
      const target = row.type === 'INCOME' ? monthIncomeByCurrency : monthExpenseByCurrency;
      addTo(target, currencyByAccount.get(row.accountId) ?? 'ARS', row._sum.amount?.toNumber() ?? 0);
    }
    const monthIncomeC = consolidateToBase(monthIncomeByCurrency, baseCurrency, rateMap);
    const monthExpenseC = consolidateToBase(monthExpenseByCurrency, baseCurrency, rateMap);
    const monthIncome = monthIncomeC.total;
    const monthExpense = monthExpenseC.total;

    // Ahorro neto en metas del mes: aportes (EXPENSE con goalId) menos retiros (INCOME con
    // goalId), por moneda de cuenta y consolidado a base (spec 19, fase B). Se muestra como
    // línea propia ("Ahorro en metas") en vez de contarse como gasto o ingreso.
    const goalNetByCurrency = new Map<string, number>();
    for (const row of goalMonthTotals) {
      const sign = row.type === 'EXPENSE' ? 1 : -1;
      addTo(goalNetByCurrency, currencyByAccount.get(row.accountId) ?? 'ARS', sign * (row._sum.amount?.toNumber() ?? 0));
    }
    const goalContributionsC = consolidateToBase(goalNetByCurrency, baseCurrency, rateMap);
    const goalContributions = goalContributionsC.total;

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
    // Saldo por deuda en su propia moneda (los pagos cross-currency cuentan por su
    // entityAmount), agrupado por moneda y consolidado a base (spec 19, fase B).
    const debtPaymentsByDebt = new Map<string, Array<(typeof debtPaymentSums)[number]>>();
    for (const row of debtPaymentSums) {
      if (!row.debtId) continue;
      const list = debtPaymentsByDebt.get(row.debtId) ?? [];
      list.push(row);
      debtPaymentsByDebt.set(row.debtId, list);
    }
    const iOweByCurrency = new Map<string, number>();
    const owedToMeByCurrency = new Map<string, number>();
    for (const debt of activeDebts) {
      const paid = sumEntityAmounts(debtPaymentsByDebt.get(debt.id) ?? []);
      const remaining = Math.max(0, round2(debt.totalAmount.toNumber() - paid));
      addTo(debt.direction === 'I_OWE' ? iOweByCurrency : owedToMeByCurrency, debt.currency, remaining);
    }
    const iOweC = consolidateToBase(iOweByCurrency, baseCurrency, rateMap);
    const owedToMeC = consolidateToBase(owedToMeByCurrency, baseCurrency, rateMap);
    const debtsSummary = {
      totalIOwe: iOweC.total,
      totalOwedToMe: owedToMeC.total,
      baseCurrency,
      converted: iOweC.converted || owedToMeC.converted,
      missingRates: Array.from(new Set([...iOweC.missingRates, ...owedToMeC.missingRates])).sort(),
      iOweByCurrency: toCurrencyAmounts(iOweByCurrency),
      owedToMeByCurrency: toCurrencyAmounts(owedToMeByCurrency),
    };

    // --- Disponible para gastar (Safe-to-spend) ---
    // Balance consolidado a moneda base menos gastos fijos activos que todavía vencen antes
    // de fin del mes seleccionado. Los recurrentes no tienen moneda propia: sus montos se
    // asumen en moneda base (deuda de fase A, ver spec 19).
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
    // Se reconstruye por moneda: saldos iniciales + deltas acumulados (movimientos y
    // patas de transferencias, cada una en la moneda de su cuenta). Cada punto se
    // consolida a moneda base al TC vigente — aproximación: no hay historial de
    // cotizaciones (fuera de alcance de spec 19; ver nota en spec 14).
    const runningByCurrency = new Map<string, number>();
    for (const a of accountRows) addTo(runningByCurrency, a.currency, a.initialBalance.toNumber());
    for (const row of deltaBeforeRows) addTo(runningByCurrency, row.currency, row.delta);
    const nwDeltasByMonth = new Map<string, Array<{ currency: string; delta: number }>>();
    for (const row of nwMonthlyRows) {
      const list = nwDeltasByMonth.get(row.month) ?? [];
      list.push(row);
      nwDeltasByMonth.set(row.month, list);
    }
    let nwConverted = false;
    const nwMissing = new Set<string>();
    const netWorthTrend = nwMonths.map((m) => {
      for (const row of nwDeltasByMonth.get(m) ?? []) addTo(runningByCurrency, row.currency, row.delta);
      const point = consolidateToBase(runningByCurrency, baseCurrency, rateMap);
      nwConverted = nwConverted || point.converted;
      for (const c of point.missingRates) nwMissing.add(c);
      return { month: m, netWorth: point.total };
    });

    // Unión de faltantes/conversiones de todos los totales consolidados.
    const missingRates = new Set([
      ...balanceC.missingRates,
      ...monthIncomeC.missingRates,
      ...monthExpenseC.missingRates,
      ...goalContributionsC.missingRates,
      ...nwMissing,
    ]);
    const converted =
      balanceC.converted ||
      monthIncomeC.converted ||
      monthExpenseC.converted ||
      goalContributionsC.converted ||
      nwConverted;

    res.json({
      balance,
      month,
      monthIncome,
      monthExpense,
      currency: {
        baseCurrency,
        converted,
        missingRates: Array.from(missingRates).sort(),
        balanceByCurrency: toCurrencyAmounts(balanceByCurrency),
        monthIncomeByCurrency: toCurrencyAmounts(monthIncomeByCurrency),
        monthExpenseByCurrency: toCurrencyAmounts(monthExpenseByCurrency),
      },
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
