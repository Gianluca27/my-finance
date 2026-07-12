import { Router } from 'express';
import { z } from 'zod';
import { resolveAccountId } from '../lib/accounts';
import { getPaidAmount, remainingBalance } from '../lib/debts';
import {
  buildSchedule,
  installmentPlanError,
  nextInstallment,
  paidInstallmentsCount,
  planFromDebt,
} from '../lib/installments';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  direction: z.enum(['I_OWE', 'OWED_TO_ME']),
  counterparty: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  totalAmount: z.number().positive().max(999_999_999),
  categoryId: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  // Cuotas (spec 17): la coherencia entre los tres (y contra totalAmount) se valida con
  // `installmentPlanError` sobre los valores efectivos — en PUT hay que mergear con lo existente.
  installmentCount: z.number().int().min(1).max(360).nullable().optional(),
  installmentAmount: z.number().positive().max(999_999_999).nullable().optional(),
  firstDueDate: z.coerce.date().nullable().optional(),
});

// Edición: `direction` es inmutable una vez creada la deuda (ver spec).
const updateSchema = createSchema.omit({ direction: true }).partial();

const paymentSchema = z.object({
  amount: z.number().positive().max(999_999_999),
  /** Cuenta donde se registra el movimiento. Default: cuenta por defecto del usuario. */
  accountId: z.string().nullable().optional(),
  /** Fecha del movimiento (ISO o YYYY-MM-DD). Default: ahora. */
  date: z.coerce.date().optional(),
});

async function assertCategoryOwned(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new HttpError(400, 'Categoría inválida');
}

type DebtRecord = {
  totalAmount: { toNumber(): number };
  installmentCount: number | null;
  installmentAmount: { toNumber(): number } | null;
  firstDueDate: Date | null;
};

/** Respuesta de deuda: `remainingBalance` calculado y, si está en cuotas, los derivados del
 * cronograma (`paidInstallments`, `nextInstallment`) — null para deudas simples. */
function withDerived(debt: DebtRecord, paid: number) {
  const plan = planFromDebt(debt);
  const schedule = plan ? buildSchedule(plan, paid) : null;
  return {
    ...(serialize(debt) as Record<string, unknown>),
    remainingBalance: remainingBalance(debt.totalAmount.toNumber(), paid),
    paidInstallments: plan ? paidInstallmentsCount(plan, paid) : null,
    nextInstallment: schedule ? serialize(nextInstallment(schedule)) : null,
  };
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
    res.json(debts.map((debt) => withDerived(debt, paidMap.get(debt.id) ?? 0)));
  }),
);

/** Detalle de una deuda con el historial de pagos (transacciones con este debtId, orden desc)
 * y, si está en cuotas, el cronograma derivado completo (nunca se persiste, se recalcula). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.debt.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
      include: { category: true },
    });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');

    const payments = await prisma.transaction.findMany({
      where: { debtId: existing.id, userId: req.auth!.userId },
      include: { category: true },
      orderBy: { date: 'desc' },
    });
    const paid = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    const plan = planFromDebt(existing);
    res.json({
      ...withDerived(existing, paid),
      payments: serialize(payments),
      schedule: plan ? serialize(buildSchedule(plan, paid)) : null,
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const planError = installmentPlanError({
      totalAmount: input.totalAmount,
      installmentCount: input.installmentCount ?? null,
      installmentAmount: input.installmentAmount ?? null,
      firstDueDate: input.firstDueDate ?? null,
    });
    if (planError) throw new HttpError(400, planError);
    await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const debt = await prisma.debt.create({
      data: { ...input, userId: req.auth!.userId },
      include: { category: true },
    });
    res.status(201).json(withDerived(debt, 0));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    if (input.categoryId !== undefined) await assertCategoryOwned(req.auth!.userId, input.categoryId);

    // Coherencia de cuotas sobre los valores efectivos (lo enviado mergeado con lo existente).
    // Nota (spec 17): editar count/monto/primer vencimiento regenera el cronograma derivado —
    // las cuotas pagadas se recalculan contra los pagos ya registrados.
    const data = { ...input };
    const merged = {
      totalAmount: input.totalAmount ?? existing.totalAmount.toNumber(),
      installmentCount: input.installmentCount !== undefined ? input.installmentCount : existing.installmentCount,
      installmentAmount:
        input.installmentAmount !== undefined
          ? input.installmentAmount
          : (existing.installmentAmount?.toNumber() ?? null),
      firstDueDate: input.firstDueDate !== undefined ? input.firstDueDate : existing.firstDueDate,
    };
    // Quitar el plan (installmentCount: null) limpia también monto y primer vencimiento,
    // salvo que el payload los mande explícitos (incoherencia que se rechaza abajo).
    if (input.installmentCount === null) {
      merged.installmentAmount = data.installmentAmount = input.installmentAmount ?? null;
      merged.firstDueDate = data.firstDueDate = input.firstDueDate ?? null;
    }
    const planError = installmentPlanError(merged);
    if (planError) throw new HttpError(400, planError);

    const debt = await prisma.debt.update({
      where: { id: existing.id },
      data,
      include: { category: true },
    });
    const paid = await getPaidAmount(debt.id);
    res.json(withDerived(debt, paid));
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

/**
 * Registra un pago parcial: crea la Transaction vinculada y salda la deuda si el saldo llega a 0.
 * `accountId` y `date` son opcionales: default cuenta por defecto del usuario y fecha actual
 * (mismo patrón que POST /api/recurring/:id/pay).
 */
router.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const input = paymentSchema.parse(req.body);
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    if (existing.settledAt) throw new HttpError(400, 'La deuda ya está saldada');

    const paidSoFar = await getPaidAmount(existing.id);
    const balance = remainingBalance(existing.totalAmount.toNumber(), paidSoFar);
    if (input.amount > balance) throw new HttpError(400, 'El monto supera el saldo restante');

    const type = existing.direction === 'I_OWE' ? 'EXPENSE' : 'INCOME';
    const newRemaining = remainingBalance(existing.totalAmount.toNumber(), paidSoFar + input.amount);
    const accountId = await resolveAccountId(req.auth!.userId, input.accountId);

    const [transaction, debt] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type,
          amount: input.amount,
          date: input.date ?? new Date(),
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
      debt: withDerived(debt, Math.max(0, paidSoFar + input.amount)),
    });
  }),
);

export default router;
