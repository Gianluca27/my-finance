import { Router } from 'express';
import { z } from 'zod';
import { currentMonth, isValidMonth, monthRange } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const budgetSchema = z.object({
  categoryId: z.string(),
  amount: z.number().positive().max(999_999_999),
  alertThreshold: z.number().int().min(1).max(100).default(80),
});

/** Lista presupuestos con el gasto acumulado del mes indicado (?month=YYYY-MM, default actual). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' && isValidMonth(req.query.month)
      ? req.query.month
      : currentMonth();
    const { start, end } = monthRange(month);

    const budgets = await prisma.budget.findMany({
      where: { userId: req.auth!.userId },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    });

    const spentByCategory = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId: req.auth!.userId,
        type: 'EXPENSE',
        date: { gte: start, lt: end },
        categoryId: { in: budgets.map((b) => b.categoryId) },
        // Los aportes a metas no tienen categoría hoy, pero se blinda igual: no son gasto real.
        goalId: null,
      },
      _sum: { amount: true },
    });
    const spentMap = new Map(
      spentByCategory.map((row) => [row.categoryId, row._sum.amount?.toNumber() ?? 0]),
    );

    const result = budgets.map((budget) => {
      const spent = spentMap.get(budget.categoryId) ?? 0;
      const limit = budget.amount.toNumber();
      return {
        ...(serialize(budget) as Record<string, unknown>),
        spent,
        percentUsed: limit > 0 ? Math.round((spent / limit) * 100) : 0,
        month,
      };
    });
    res.json(result);
  }),
);

/** Crea o actualiza el presupuesto de una categoría (upsert por categoría). */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const input = budgetSchema.parse(req.body);
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId: req.auth!.userId },
    });
    if (!category) throw new HttpError(400, 'Categoría inválida');
    if (category.type !== 'EXPENSE') {
      throw new HttpError(400, 'Solo se pueden presupuestar categorías de gasto');
    }

    const budget = await prisma.budget.upsert({
      where: { userId_categoryId: { userId: req.auth!.userId, categoryId: input.categoryId } },
      update: { amount: input.amount, alertThreshold: input.alertThreshold, lastAlertMonth: null },
      create: { ...input, userId: req.auth!.userId },
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
