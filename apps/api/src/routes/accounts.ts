import { Router } from 'express';
import { z } from 'zod';
import { computeReconcileAdjustment } from '../lib/accounts';
import { consolidateToBase } from '../lib/currency';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['CASH', 'BANK', 'CARD', 'OTHER']).default('BANK'),
  initialBalance: z.number().min(-999_999_999).max(999_999_999).default(0),
  /** Moneda de la cuenta. Modelo free-string; la UI ofrece ARS/USD primero. */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}$/, 'Código de moneda inválido')
    .transform((s) => s.toUpperCase())
    .default('ARS'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(16).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const updateSchema = createSchema.partial().extend({
  /** true archiva (setea archivedAt), false desarchiva. */
  archived: z.boolean().optional(),
});

const reconcileSchema = z.object({
  actualBalance: z.number().min(-999_999_999).max(999_999_999),
  date: z.coerce.date().optional(),
});

interface AccountComputed {
  /** Inicial + ingresos - gastos + transferencias recibidas - enviadas, en la moneda de la cuenta. */
  balance: number;
  /** true si tiene transacciones o transferencias: la moneda ya no se puede cambiar. */
  hasMovements: boolean;
}

/** Calcula balance y presencia de movimientos de cada cuenta. Las transferencias
 * entran por `amountTo` en destino y `amount` en origen (cada pata en su moneda). */
async function computeAccountFields(
  userId: string,
  accounts: { id: string; initialBalance: { toNumber(): number } }[],
): Promise<Map<string, AccountComputed>> {
  const ids = accounts.map((a) => a.id);
  const [txSums, fromSums, toSums] = await Promise.all([
    prisma.transaction.groupBy({ by: ['accountId', 'type'], where: { userId, accountId: { in: ids } }, _sum: { amount: true } }),
    prisma.transfer.groupBy({ by: ['fromAccountId'], where: { userId }, _sum: { amount: true } }),
    prisma.transfer.groupBy({ by: ['toAccountId'], where: { userId }, _sum: { amountTo: true } }),
  ]);
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  for (const row of txSums) {
    const target = row.type === 'INCOME' ? income : expense;
    target.set(row.accountId, (target.get(row.accountId) ?? 0) + (row._sum.amount?.toNumber() ?? 0));
  }
  const out = new Map(fromSums.map((r) => [r.fromAccountId, r._sum.amount?.toNumber() ?? 0]));
  const inn = new Map(toSums.map((r) => [r.toAccountId, r._sum.amountTo?.toNumber() ?? 0]));

  const map = new Map<string, AccountComputed>();
  for (const a of accounts) {
    const balance =
      a.initialBalance.toNumber() +
      (income.get(a.id) ?? 0) -
      (expense.get(a.id) ?? 0) +
      (inn.get(a.id) ?? 0) -
      (out.get(a.id) ?? 0);
    // Los groupBy solo devuelven filas para cuentas con datos: la sola presencia
    // en alguno de los mapas implica que la cuenta tiene movimientos.
    const hasMovements =
      income.has(a.id) || expense.has(a.id) || inn.has(a.id) || out.has(a.id);
    map.set(a.id, { balance: round2(balance), hasMovements });
  }
  return map;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const [accounts, user, exchangeRates] = await Promise.all([
      prisma.account.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
      prisma.exchangeRate.findMany({ where: { userId } }),
    ]);
    const computed = await computeAccountFields(userId, accounts);

    // Patrimonio neto agrupado por moneda de cuenta (incluye archivadas: el
    // dinero existió) y consolidado a la moneda base del usuario.
    const baseCurrency = user?.baseCurrency ?? 'ARS';
    const balanceByCurrency = new Map<string, number>();
    for (const a of accounts) {
      const balance = computed.get(a.id)?.balance ?? 0;
      balanceByCurrency.set(a.currency, (balanceByCurrency.get(a.currency) ?? 0) + balance);
    }
    const consolidated = consolidateToBase(
      balanceByCurrency,
      baseCurrency,
      new Map(exchangeRates.map((r) => [r.currency, r.rate.toNumber()])),
    );

    res.json({
      items: accounts.map((a) => ({
        ...(serialize(a) as Record<string, unknown>),
        balance: computed.get(a.id)?.balance ?? 0,
        hasMovements: computed.get(a.id)?.hasMovements ?? false,
      })),
      netWorth: {
        baseCurrency,
        total: consolidated.total,
        converted: consolidated.converted,
        byCurrency: Array.from(balanceByCurrency, ([currency, amount]) => ({ currency, amount: round2(amount) })),
        missingRates: consolidated.missingRates,
      },
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const userId = req.auth!.userId;
    const count = await prisma.account.count({ where: { userId } });
    // La primera cuenta es siempre la por defecto.
    const makeDefault = input.isDefault || count === 0;
    if (makeDefault) {
      await prisma.account.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    const account = await prisma.account.create({ data: { ...input, isDefault: makeDefault, userId } });
    res.status(201).json({
      ...(serialize(account) as Record<string, unknown>),
      balance: account.initialBalance.toNumber(),
      hasMovements: false,
    });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const userId = req.auth!.userId;
    const existing = await prisma.account.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new HttpError(404, 'Cuenta no encontrada');
    // No permitir quitar el flag de la única cuenta por defecto sin designar otra.
    if (input.isDefault === false && existing.isDefault) {
      throw new HttpError(400, 'Designá otra cuenta como predeterminada en lugar de quitar esta.');
    }
    // Misma regla que el DELETE: la cuenta por defecto no se archiva.
    if (input.archived === true && existing.isDefault) {
      throw new HttpError(400, 'No podés archivar la cuenta por defecto.');
    }
    // Una cuenta archivada (ya sea que lo estaba o pasa a estarlo en este mismo pedido) no puede
    // convertirse en la predeterminada.
    const staysArchived = input.archived !== undefined ? input.archived : existing.archivedAt !== null;
    if (input.isDefault === true && staysArchived) {
      throw new HttpError(400, 'Una cuenta archivada no puede ser la predeterminada. Desarchivala primero.');
    }
    // Regla dura de spec 19: la moneda es inmutable con movimientos existentes.
    // Cambiarla reinterpretaría todo el historial de la cuenta en otra moneda.
    if (input.currency !== undefined && input.currency !== existing.currency) {
      const [txCount, transferCount] = await Promise.all([
        prisma.transaction.count({ where: { accountId: existing.id } }),
        prisma.transfer.count({ where: { OR: [{ fromAccountId: existing.id }, { toAccountId: existing.id }] } }),
      ]);
      if (txCount > 0 || transferCount > 0) {
        throw new HttpError(
          400,
          'No se puede cambiar la moneda: la cuenta ya tiene movimientos o transferencias registrados en su moneda original.',
        );
      }
    }

    const { archived, ...fields } = input;
    const data: Record<string, unknown> = { ...fields };
    if (archived !== undefined) {
      data.archivedAt = archived ? (existing.archivedAt ?? new Date()) : null;
    }

    const ops = [];
    if (input.isDefault === true && !existing.isDefault) {
      ops.push(prisma.account.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }));
    }
    ops.push(prisma.account.update({ where: { id: existing.id }, data }));
    const results = await prisma.$transaction(ops);
    const account = results[results.length - 1] as Awaited<ReturnType<typeof prisma.account.update>>;
    const computed = await computeAccountFields(userId, [account]);
    res.json({
      ...(serialize(account) as Record<string, unknown>),
      balance: computed.get(account.id)?.balance ?? 0,
      hasMovements: computed.get(account.id)?.hasMovements ?? false,
    });
  }),
);

/**
 * Reconcilia el saldo calculado de la cuenta con el saldo real informado por el usuario: si
 * difieren, crea una transacción de ajuste (sin categoría) para que el balance calculado vuelva
 * a coincidir con la realidad, sin reescribir el historial existente.
 */
router.post(
  '/:id/reconcile',
  asyncHandler(async (req, res) => {
    const input = reconcileSchema.parse(req.body);
    const userId = req.auth!.userId;
    const existing = await prisma.account.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new HttpError(404, 'Cuenta no encontrada');

    const computed = await computeAccountFields(userId, [existing]);
    const calculated = computed.get(existing.id)?.balance ?? 0;
    const adjustment = computeReconcileAdjustment(calculated, input.actualBalance);
    if (!adjustment) {
      res.json({ adjustment: 0, newBalance: calculated });
      return;
    }

    await prisma.transaction.create({
      data: {
        type: adjustment.type,
        amount: adjustment.amount,
        date: input.date ?? new Date(),
        note: 'Ajuste de saldo',
        categoryId: null,
        accountId: existing.id,
        userId,
      },
    });
    res.status(201).json({ adjustment: adjustment.adjustment, newBalance: adjustment.newBalance });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const existing = await prisma.account.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new HttpError(404, 'Cuenta no encontrada');
    if (existing.isDefault) throw new HttpError(400, 'No podés eliminar la cuenta por defecto.');

    const [txCount, transferCount] = await Promise.all([
      prisma.transaction.count({ where: { accountId: existing.id } }),
      prisma.transfer.count({ where: { OR: [{ fromAccountId: existing.id }, { toAccountId: existing.id }] } }),
    ]);
    if (txCount > 0 || transferCount > 0) {
      throw new HttpError(400, 'La cuenta tiene movimientos o transferencias. Reasignalos antes de eliminarla.');
    }
    await prisma.account.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
