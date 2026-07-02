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

    // Balance histórico (todos los ingresos - todos los gastos)
    const totals = await prisma.transaction.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { amount: true },
    });
    const totalIncome = totals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const totalExpense = totals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;

    // Totales del mes seleccionado
    const monthTotals = await prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, date: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    const monthIncome = monthTotals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
    const monthExpense = monthTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;

    // Gastos por categoría del mes
    const byCategory = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', date: { gte: start, lt: end } },
      _sum: { amount: true },
    });
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

    // Comparativa de los últimos 6 meses (incluido el seleccionado)
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const rangeStart = monthRange(months[0]).start;
    const rangeEnd = monthRange(months[months.length - 1]).end;
    const inRange = await prisma.transaction.findMany({
      where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
      select: { type: true, amount: true, date: true },
    });
    const monthlyComparison = months.map((m) => {
      const { start: mStart, end: mEnd } = monthRange(m);
      let income = 0;
      let expense = 0;
      for (const tx of inRange) {
        if (tx.date >= mStart && tx.date < mEnd) {
          if (tx.type === 'INCOME') income += tx.amount.toNumber();
          else expense += tx.amount.toNumber();
        }
      }
      return { month: m, income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 };
    });

    // Próximos pagos (14 días)
    const today = startOfTodayUTC();
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 14);
    const upcomingPayments = await prisma.recurringExpense.findMany({
      where: { userId, active: true, nextDueDate: { gte: today, lte: horizon } },
      include: { category: true },
      orderBy: { nextDueDate: 'asc' },
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
