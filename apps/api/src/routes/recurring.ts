import { Router } from 'express';
import { z } from 'zod';
import { advanceDueDate, nextDueDate } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';

const router = Router();
router.use(requireAuth);

const baseSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().positive().max(999_999_999),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']),
  dueDay: z.number().int(),
  dueMonth: z.number().int().min(1).max(12).nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).default(3),
  active: z.boolean().default(true),
  categoryId: z.string().nullable().optional(),
});

function validateDueDay(frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY', dueDay: number, dueMonth?: number | null) {
  if (frequency === 'WEEKLY' && (dueDay < 0 || dueDay > 6)) {
    throw new HttpError(400, 'Para frecuencia semanal, dueDay debe ser 0-6 (0 = domingo)');
  }
  if (frequency !== 'WEEKLY' && (dueDay < 1 || dueDay > 31)) {
    throw new HttpError(400, 'dueDay debe ser 1-31');
  }
  if (frequency === 'YEARLY' && !dueMonth) {
    throw new HttpError(400, 'Para frecuencia anual, dueMonth (1-12) es obligatorio');
  }
}

async function assertCategoryOwned(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new HttpError(400, 'Categoría inválida');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.recurringExpense.findMany({
      where: { userId: req.auth!.userId },
      include: { category: true },
      orderBy: { nextDueDate: 'asc' },
    });
    res.json(serialize(items));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = baseSchema.parse(req.body);
    validateDueDay(input.frequency, input.dueDay, input.dueMonth);
    await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const item = await prisma.recurringExpense.create({
      data: {
        ...input,
        userId: req.auth!.userId,
        nextDueDate: nextDueDate(input.frequency, input.dueDay, input.dueMonth ?? null),
      },
      include: { category: true },
    });
    res.status(201).json(serialize(item));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = baseSchema.partial().parse(req.body);
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');

    const frequency = input.frequency ?? existing.frequency;
    const dueDay = input.dueDay ?? existing.dueDay;
    const dueMonth = input.dueMonth !== undefined ? input.dueMonth : existing.dueMonth;
    validateDueDay(frequency, dueDay, dueMonth);
    if (input.categoryId !== undefined) await assertCategoryOwned(req.auth!.userId, input.categoryId);

    const scheduleChanged =
      frequency !== existing.frequency || dueDay !== existing.dueDay || dueMonth !== existing.dueMonth;

    const item = await prisma.recurringExpense.update({
      where: { id: existing.id },
      data: {
        ...input,
        ...(scheduleChanged
          ? { nextDueDate: nextDueDate(frequency, dueDay, dueMonth ?? null), lastRemindedFor: null }
          : {}),
      },
      include: { category: true },
    });
    res.json(serialize(item));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');
    await prisma.recurringExpense.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

/** Registra el pago del período actual: crea la transacción y avanza el vencimiento. */
router.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');

    const [transaction, recurring] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: existing.amount,
          date: new Date(),
          note: `Pago recurrente: ${existing.name}`,
          categoryId: existing.categoryId,
          userId: req.auth!.userId,
        },
        include: { category: true },
      }),
      prisma.recurringExpense.update({
        where: { id: existing.id },
        data: {
          nextDueDate: advanceDueDate(existing.frequency, existing.dueDay, existing.dueMonth, existing.nextDueDate),
        },
        include: { category: true },
      }),
    ]);

    checkBudgetAlert(req.auth!.userId, existing.categoryId).catch((err) =>
      console.error('[budgets] Error evaluando alerta:', err),
    );
    res.status(201).json({ transaction: serialize(transaction), recurring: serialize(recurring) });
  }),
);

export default router;
