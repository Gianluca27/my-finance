import { Router } from 'express';
import { z } from 'zod';
import { resolveAccount } from '../lib/accounts';
import { convertPaymentAmount, sumEntityAmounts } from '../lib/currency';
import { getPaidAmount, remainingBalance } from '../lib/debts';
import { getRateMap } from '../lib/exchangeRates';
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
import { checkCardLimitAlert } from '../services/cardAlerts';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  direction: z.enum(['I_OWE', 'OWED_TO_ME']),
  counterparty: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  totalAmount: z.number().positive().max(999_999_999),
  /** Moneda de la deuda. Default: la moneda base del usuario (se resuelve en el POST). */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}$/, 'Código de moneda inválido')
    .transform((s) => s.toUpperCase())
    .optional(),
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

/** Respuesta de deuda: `remainingBalance` calculado (en la moneda de la deuda) y, si está en
 * cuotas, los derivados del cronograma (`paidInstallments`, `nextInstallment`) — null para
 * deudas simples. `hasPayments` habilita al cliente a bloquear el cambio de moneda. */
function withDerived(debt: DebtRecord, paid: number) {
  const plan = planFromDebt(debt);
  const schedule = plan ? buildSchedule(plan, paid) : null;
  return {
    ...(serialize(debt) as Record<string, unknown>),
    remainingBalance: remainingBalance(debt.totalAmount.toNumber(), paid),
    paidInstallments: plan ? paidInstallmentsCount(plan, paid) : null,
    nextInstallment: schedule ? serialize(nextInstallment(schedule)) : null,
    // Los montos de pago son estrictamente positivos: paid > 0 ⇔ hay pagos vinculados.
    hasPayments: paid > 0,
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
    // Pagos por deuda en la moneda de cada deuda: los cross-currency cuentan por su
    // entityAmount, por eso se suman en memoria (COALESCE no está en groupBy de Prisma).
    const paymentRows = await prisma.transaction.findMany({
      where: { userId, debtId: { in: debts.map((d) => d.id) } },
      select: { debtId: true, amount: true, entityAmount: true },
    });
    const paymentsByDebt = new Map<string, typeof paymentRows>();
    for (const row of paymentRows) {
      if (!row.debtId) continue;
      const list = paymentsByDebt.get(row.debtId) ?? [];
      list.push(row);
      paymentsByDebt.set(row.debtId, list);
    }
    res.json(debts.map((debt) => withDerived(debt, sumEntityAmounts(paymentsByDebt.get(debt.id) ?? []))));
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
    const paid = sumEntityAmounts(payments);
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
    // Default de moneda: la base del usuario (spec 19 fase B) — el default estático "ARS"
    // de la columna es solo el backfill de deudas preexistentes.
    const currency =
      input.currency ??
      (await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { baseCurrency: true } }))
        ?.baseCurrency ??
      'ARS';
    const debt = await prisma.debt.create({
      data: { ...input, currency, userId: req.auth!.userId },
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

    // Regla dura (spec 19 fase B, espejo de Account.currency): la moneda es inmutable con
    // pagos registrados — cambiarla reinterpretaría el saldo y los montos ya convertidos.
    if (input.currency !== undefined && input.currency !== existing.currency) {
      const paymentCount = await prisma.transaction.count({ where: { debtId: existing.id } });
      if (paymentCount > 0) {
        throw new HttpError(
          400,
          'No se puede cambiar la moneda: la deuda ya tiene pagos registrados en su moneda original.',
        );
      }
    }

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
 *
 * `amount` está SIEMPRE en la moneda de la cuenta elegida (la transacción vive en esa
 * moneda). Si difiere de la moneda de la deuda, se convierte con la cotización vigente y el
 * resultado se persiste en `entityAmount`: el saldo de la deuda queda fijado al TC del día
 * del pago y no flota si el TC se mueve después (spec 19, fase B). Sin cotización cargada
 * se rechaza con error claro en vez de adivinar.
 */
router.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const input = paymentSchema.parse(req.body);
    const existing = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Deuda no encontrada');
    if (existing.settledAt) throw new HttpError(400, 'La deuda ya está saldada');

    const account = await resolveAccount(req.auth!.userId, input.accountId);
    let entityAmount: number | null = null;
    if (account.currency !== existing.currency) {
      const converted = convertPaymentAmount(
        input.amount,
        account.currency,
        existing.currency,
        await getRateMap(req.auth!.userId),
      );
      if (converted === null) {
        throw new HttpError(
          400,
          `No hay cotización cargada para convertir ${account.currency} a ${existing.currency}. Cargala en Inversiones y volvé a intentar.`,
        );
      }
      // El convertido se redondea a centavos: un monto muy chico puede quedar en 0.00 y el
      // "pago" no descontaría nada del saldo (quedaría una transacción sin efecto).
      if (converted === 0) {
        throw new HttpError(
          400,
          `El monto es demasiado chico: equivale a 0.00 ${existing.currency} al tipo de cambio vigente. Ingresá un monto mayor.`,
        );
      }
      entityAmount = converted;
    }
    // Monto que impacta el saldo de la deuda, en su moneda.
    const debtAmount = entityAmount ?? input.amount;

    const paidSoFar = await getPaidAmount(existing.id);
    const balance = remainingBalance(existing.totalAmount.toNumber(), paidSoFar);
    if (debtAmount > balance) throw new HttpError(400, 'El monto supera el saldo restante');

    const type = existing.direction === 'I_OWE' ? 'EXPENSE' : 'INCOME';
    const newRemaining = remainingBalance(existing.totalAmount.toNumber(), paidSoFar + debtAmount);

    const [transaction, debt] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type,
          amount: input.amount,
          entityAmount,
          date: input.date ?? new Date(),
          note: `Pago de deuda: ${existing.counterparty}`,
          categoryId: existing.categoryId,
          accountId: account.id,
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
      // Un pago de deuda hecho con la tarjeta también cuenta contra el límite del ciclo (spec 20).
      checkCardLimitAlert(req.auth!.userId, account.id).catch((err) =>
        console.error('[cards] Error evaluando alerta de límite:', err),
      );
    }

    res.status(201).json({
      transaction: serialize(transaction),
      debt: withDerived(debt, Math.max(0, paidSoFar + debtAmount)),
    });
  }),
);

export default router;
