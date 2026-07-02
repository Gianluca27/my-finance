import { Router } from 'express';
import { currentMonth, isValidMonth, monthRange, shiftMonth, startOfTodayUTC } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { prisma } from '../prisma';

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

    const [totals, monthTotals, byCategory, monthlyRows, upcomingPayments] = await Promise.all([
      // Balance histórico (todos los ingresos - todos los gastos)
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId },
        _sum: { amount: true },
      }),
      // Totales del mes seleccionado
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      // Gastos por categoría del mes
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: 'EXPENSE', date: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      // Comparativa de los últimos 6 meses, agregada en la base
      prisma.$queryRaw<Array<{ month: string; type: string; total: number }>>`
        SELECT to_char("date", 'YYYY-MM') AS month, "type"::text AS type, SUM("amount")::float8 AS total
        FROM "Transaction"
        WHERE "userId" = ${userId} AND "date" >= ${rangeStart} AND "date" < ${rangeEnd}
        GROUP BY 1, 2
      `,
      // Próximos pagos (14 días)
      prisma.recurringExpense.findMany({
        where: { userId, active: true, nextDueDate: { gte: today, lte: horizon } },
        include: { category: true },
        orderBy: { nextDueDate: 'asc' },
      }),
    ]);

    const totalIncome = totals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const totalExpense = totals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;
    const monthIncome = monthTotals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const monthExpense = monthTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;

    const categoryIds = byCategory.map((row) => row.categoryId).filter((id): id is string => id !== null);
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
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

    res.json({
      balance: Math.round((totalIncome - totalExpense) * 100) / 100,
      month,
      monthIncome,
      monthExpense,
      expensesByCategory,
      monthlyComparison,
      upcomingPayments: serialize(upcomingPayments),
    });
  }),
);

export default router;
