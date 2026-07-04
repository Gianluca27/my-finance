import { Router } from 'express';
import { z } from 'zod';
import { getDefaultAccountId } from '../lib/accounts';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';

const router = Router();
router.use(requireAuth);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const createSchema = z.object({
  direction: z.enum(['I_OWE', 'OWED_TO_ME']),
  counterparty: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  totalAmount: z.number().positive().max(999_999_999),
  categoryId: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

// Edición: `direction` es inmutable una vez creada la deuda (ver spec).
const updateSchema = createSchema.omit({ direction: true }).partial();

const paymentSchema = z.object({
  amount: z.number().positive().max(999_999_999),
});

async function assertCategoryOwned(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new HttpError(400, 'Categoría inválida');
}

async function getPaidAmount(debtId: string): Promise<number> {
  const result = await prisma.transaction.aggregate({ where: { debtId }, _sum: { amount: true } });
  return result._sum.amount?.toNumber() ?? 0;
}

function withRemainingBalance(debt: { totalAmount: { toNumber(): number } }, paid: number) {
  return { ...(serialize(debt) as Record<string, unknown>), remainingBalance: Math.max(0, round2(debt.totalAmount.toNumber() - paid)) };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const debts = await prisma.debt.findMany({
      where: { userId },
      include: { category: true },
      orderBy: [{ settledAt: 'asc' }, { createdAt: 'desc' }],
    });
    const paymentSums = await prisma.transaction.groupBy({
      by: ['debtId'],
      where: { userId, debtId: { in: debts.map((d) => d.id) } },
      _sum: { amount: true },
    });
    const paidMap = new Map(
      paymentSums
        .filter((p): p is typeof p & { debtId: string } => p.debtId !== null)
        .map((p) => [p.debtId, p._sum.amount?.toNumber() ?? 0]),
    );
    res.json(debts.map((debt) => withRemainingBalance(debt, paidMap.get(debt.id) ?? 0)));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const debt = await prisma.debt.create({
      data: { ...input, userId: req.auth!.userId },
      include: { category: true },
    });
    res.status(201).json(withRemainingBalance(debt, 0));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    if (input.categoryId !== undefined) await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const debt = await prisma.debt.update({
      where: { id: existing.id },
      data: input,
      include: { category: true },
    });
    const paid = await getPaidAmount(debt.id);
    res.json(withRemainingBalance(debt, paid));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    // Los pagos ya registrados quedan como transacciones sueltas (debtId -> null vía onDelete: SetNull).
    await prisma.debt.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

/** Registra un pago parcial: crea la Transaction vinculada y salda la deuda si el saldo llega a 0. */
router.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const { amount } = paymentSchema.parse(req.body);
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    if (existing.settledAt) throw new HttpError(400, 'La deuda ya está saldada');

    const paidSoFar = await getPaidAmount(existing.id);
    const remainingBalance = round2(existing.totalAmount.toNumber() - paidSoFar);
    if (amount > remainingBalance) throw new HttpError(400, 'El monto supera el saldo restante');

    const type = existing.direction === 'I_OWE' ? 'EXPENSE' : 'INCOME';
    const newRemaining = round2(remainingBalance - amount);
    const accountId = await getDefaultAccountId(req.auth!.userId);

    const [transaction, debt] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type,
          amount,
          date: new Date(),
          note: `Pago de deuda: ${existing.counterparty}`,
          categoryId: existing.categoryId,
          accountId,
          debtId: existing.id,
          userId: req.auth!.userId,
        },
        include: { category: true },
      }),
      prisma.debt.update({
        where: { id: existing.id },
        data: newRemaining <= 0 ? { settledAt: new Date() } : {},
        include: { category: true },
      }),
    ]);

    if (type === 'EXPENSE') {
      checkBudgetAlert(req.auth!.userId, existing.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
    }

    res.status(201).json({
      transaction: serialize(transaction),
      debt: withRemainingBalance(debt, Math.max(0, paidSoFar + amount)),
    });
  }),
);

export default router;
