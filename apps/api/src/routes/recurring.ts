import { Router } from 'express';
import { z } from 'zod';
import { resolveAccountId } from '../lib/accounts';
import { advanceDueDate, nextDueDate } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';
import { checkCardLimitAlert } from '../services/cardAlerts';

const router = Router();
router.use(requireAuth);

const baseSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['INCOME', 'EXPENSE']).default('EXPENSE'),
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

/** Body opcional de /:id/pay: todos los campos opcionales, default = comportamiento actual. */
const paySchema = z.object({
  amount: z.number().positive().max(999_999_999).optional(),
  accountId: z.string().nullable().optional(),
  date: z.coerce.date().optional(),
});

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

/**
 * Registra el pago del período actual: crea la transacción (vinculada vía recurringId) y avanza
 * el vencimiento. El body es opcional; monto, cuenta y fecha por defecto reproducen el
 * comportamiento previo. Pagar con un monto distinto no modifica el `amount` del recurrente
 * (queda solo como referencia para el próximo período).
 */
router.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const input = paySchema.parse(req.body ?? {});
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');

    const accountId = await resolveAccountId(req.auth!.userId, input.accountId);
    const notePrefix = existing.type === 'INCOME' ? 'Cobro recurrente' : 'Pago recurrente';
    const [transaction, recurring] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type: existing.type,
          amount: input.amount ?? existing.amount,
          date: input.date ?? new Date(),
          note: `${notePrefix}: ${existing.name}`,
          categoryId: existing.categoryId,
          accountId,
          recurringId: existing.id,
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

    // Las alertas de presupuesto sólo aplican a gastos; usan el monto real pagado (ya persistido).
    if (existing.type === 'EXPENSE') {
      checkBudgetAlert(req.auth!.userId, existing.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
      // Un recurrente pagado con la tarjeta también cuenta contra el límite del ciclo (spec 20).
      checkCardLimitAlert(req.auth!.userId, accountId).catch((err) =>
        console.error('[cards] Error evaluando alerta de límite:', err),
      );
    }
    res.status(201).json({ transaction: serialize(transaction), recurring: serialize(recurring) });
  }),
);

/** Salta el período actual sin registrar pago: solo avanza el vencimiento. */
router.post(
  '/:id/skip',
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');

    const recurring = await prisma.recurringExpense.update({
      where: { id: existing.id },
      data: {
        nextDueDate: advanceDueDate(existing.frequency, existing.dueDay, existing.dueMonth, existing.nextDueDate),
      },
      include: { category: true },
    });
    res.json(serialize(recurring));
  }),
);

/** Últimos pagos vinculados a este recurrente (orden desc, máx. 24). Los pagos previos a la
 * introducción de `recurringId` no quedaron vinculados: el historial arranca desde ahora. */
router.get(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Gasto recurrente no encontrado');

    const payments = await prisma.transaction.findMany({
      where: { recurringId: existing.id, userId: req.auth!.userId },
      include: { category: true },
      orderBy: { date: 'desc' },
      take: 24,
    });
    res.json(serialize(payments));
  }),
);

export default router;
