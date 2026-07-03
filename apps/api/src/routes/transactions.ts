import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';

const router = Router();
router.use(requireAuth);

const transactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().positive().max(999_999_999),
  date: z.coerce.date(),
  note: z.string().max(500).nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

const filtersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function assertCategoryOwned(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new HttpError(400, 'Categoría inválida');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = filtersSchema.parse(req.query);
    const searchTerm = filters.search?.trim();
    const searchOr: Prisma.TransactionWhereInput[] = [];
    if (searchTerm) {
      searchOr.push({ note: { contains: searchTerm, mode: 'insensitive' } });
      const parsedAmount = Number(searchTerm);
      if (Number.isFinite(parsedAmount)) searchOr.push({ amount: parsedAmount });
    }
    const where: Prisma.TransactionWhereInput = {
      userId: req.auth!.userId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.from || filters.to
        ? { date: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { category: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);
    res.json({ items: serialize(items), total, page: filters.page, pageSize: filters.pageSize });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = transactionSchema.parse(req.body);
    await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const transaction = await prisma.transaction.create({
      data: { ...input, userId: req.auth!.userId },
      include: { category: true },
    });
    if (transaction.type === 'EXPENSE') {
      // No bloquea la respuesta; las alertas de presupuesto se evalúan en segundo plano
      checkBudgetAlert(req.auth!.userId, transaction.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
    }
    res.status(201).json(serialize(transaction));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = transactionSchema.partial().parse(req.body);
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    if (input.categoryId !== undefined) await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const transaction = await prisma.transaction.update({
      where: { id: existing.id },
      data: input,
      include: { category: true },
    });
    if (transaction.type === 'EXPENSE') {
      checkBudgetAlert(req.auth!.userId, transaction.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
    }
    res.json(serialize(transaction));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    await prisma.transaction.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
