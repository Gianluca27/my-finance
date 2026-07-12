import { Router } from 'express';
import { z } from 'zod';
import { resolveAccount } from '../lib/accounts';
import { convertPaymentAmount, effectiveEntityAmount } from '../lib/currency';
import { getRateMap } from '../lib/exchangeRates';
import { netSaved, resolveAchievedAt } from '../lib/goals';
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
  name: z.string().min(1).max(100),
  targetAmount: z.number().positive().max(999_999_999),
  /** Moneda de la meta. Default: la moneda base del usuario (se resuelve en el POST). */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}$/, 'Código de moneda inválido')
    .transform((s) => s.toUpperCase())
    .optional(),
  targetDate: z.coerce.date().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(16).nullable().optional(),
});

const updateSchema = createSchema.partial();

const contributionSchema = z.object({
  amount: z.number().positive().max(999_999_999),
  /** Cuenta de origen del aporte. Default: cuenta por defecto del usuario. */
  accountId: z.string().nullable().optional(),
});

const withdrawalSchema = z.object({
  amount: z.number().positive().max(999_999_999),
  /** Cuenta destino del retiro. Default: cuenta por defecto del usuario. */
  accountId: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Fila mínima de un aporte/retiro para netear en la moneda de la meta. */
type GoalMovementRow = {
  type: 'INCOME' | 'EXPENSE';
  amount: { toNumber(): number };
  entityAmount: { toNumber(): number } | null;
};

/** Aportes (EXPENSE) menos retiros (INCOME) en la moneda de la meta: los movimientos desde
 * cuentas en otra moneda cuentan por su `entityAmount` convertido (spec 19, fase B). */
function netSavedFromRows(rows: GoalMovementRow[]): number {
  const contributed = rows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + effectiveEntityAmount(r), 0);
  const withdrawn = rows.filter((r) => r.type === 'INCOME').reduce((s, r) => s + effectiveEntityAmount(r), 0);
  return netSaved(contributed, withdrawn);
}

/** Ahorro neto de la meta + si tiene movimientos vinculados (bloquea el cambio de moneda). */
async function getSavedState(goalId: string): Promise<{ saved: number; hasMovements: boolean }> {
  const rows = await prisma.transaction.findMany({
    where: { goalId },
    select: { type: true, amount: true, entityAmount: true },
  });
  return { saved: netSavedFromRows(rows), hasMovements: rows.length > 0 };
}

function withSaved(goal: { targetAmount: { toNumber(): number } }, saved: number, hasMovements: boolean) {
  const target = goal.targetAmount.toNumber();
  return {
    ...(serialize(goal) as Record<string, unknown>),
    saved: round2(saved),
    remaining: Math.max(0, round2(target - saved)),
    hasMovements,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: [{ achievedAt: 'asc' }, { createdAt: 'desc' }],
    });
    // Aportes/retiros por meta en la moneda de cada meta: los cross-currency cuentan por su
    // entityAmount, por eso se netean en memoria (COALESCE no está en groupBy de Prisma).
    const movementRows = await prisma.transaction.findMany({
      where: { userId, goalId: { in: goals.map((g) => g.id) } },
      select: { goalId: true, type: true, amount: true, entityAmount: true },
    });
    const rowsByGoal = new Map<string, GoalMovementRow[]>();
    for (const row of movementRows) {
      if (!row.goalId) continue;
      const list = rowsByGoal.get(row.goalId) ?? [];
      list.push(row);
      rowsByGoal.set(row.goalId, list);
    }
    res.json(
      goals.map((goal) => {
        const rows = rowsByGoal.get(goal.id) ?? [];
        return withSaved(goal, netSavedFromRows(rows), rows.length > 0);
      }),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    // Default de moneda: la base del usuario (spec 19 fase B) — el default estático "ARS"
    // de la columna es solo el backfill de metas preexistentes.
    const currency =
      input.currency ??
      (await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { baseCurrency: true } }))
        ?.baseCurrency ??
      'ARS';
    const goal = await prisma.goal.create({
      data: { ...input, currency, userId: req.auth!.userId },
    });
    res.status(201).json(withSaved(goal, 0, false));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    // Recalcular achievedAt contra el targetAmount resultante: si baja por debajo de lo ya
    // aportado, la meta pasa a lograda; si sube por encima, vuelve a activa.
    const { saved, hasMovements } = await getSavedState(existing.id);

    // Regla dura (spec 19 fase B, espejo de Account.currency): la moneda es inmutable con
    // movimientos registrados — cambiarla reinterpretaría el ahorro y los montos convertidos.
    if (input.currency !== undefined && input.currency !== existing.currency && hasMovements) {
      throw new HttpError(
        400,
        'No se puede cambiar la moneda: la meta ya tiene aportes o retiros registrados en su moneda original.',
      );
    }
    const target = input.targetAmount ?? existing.targetAmount.toNumber();

    const goal = await prisma.goal.update({
      where: { id: existing.id },
      data: { ...input, achievedAt: resolveAchievedAt(existing.achievedAt, saved, target) },
    });
    res.json(withSaved(goal, saved, hasMovements));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');
    // Los aportes ya registrados quedan como transacciones sueltas (goalId -> null vía onDelete: SetNull).
    await prisma.goal.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

/**
 * Convierte un aporte/retiro a la moneda de la meta cuando la cuenta está en otra moneda
 * (spec 19, fase B). Devuelve el `entityAmount` a persistir (null si comparten moneda) o
 * rechaza con error claro si falta la cotización — nunca se adivina el TC.
 */
async function resolveGoalEntityAmount(
  userId: string,
  amount: number,
  accountCurrency: string,
  goalCurrency: string,
): Promise<number | null> {
  if (accountCurrency === goalCurrency) return null;
  const converted = convertPaymentAmount(amount, accountCurrency, goalCurrency, await getRateMap(userId));
  if (converted === null) {
    throw new HttpError(
      400,
      `No hay cotización cargada para convertir ${accountCurrency} a ${goalCurrency}. Cargala en Inversiones y volvé a intentar.`,
    );
  }
  return converted;
}

/**
 * Registra un aporte: crea la Transaction (EXPENSE) vinculada por goalId y marca la meta como
 * lograda al alcanzar el objetivo. Queda excluida de los agregados de gasto (dashboard, presupuestos,
 * resumen PDF) porque no es un gasto real — el balance de la cuenta sí baja, eso es correcto.
 *
 * `amount` está en la moneda de la cuenta elegida; si difiere de la moneda de la meta se
 * convierte al TC vigente y el resultado se persiste en `entityAmount` (el ahorro de la meta
 * no flota con el TC posterior).
 */
router.post(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const { amount, accountId: requestedAccountId } = contributionSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    const account = await resolveAccount(req.auth!.userId, requestedAccountId);
    const entityAmount = await resolveGoalEntityAmount(
      req.auth!.userId,
      amount,
      account.currency,
      existing.currency,
    );
    // Monto que suma al ahorro de la meta, en su moneda.
    const goalAmount = entityAmount ?? amount;

    const { saved: savedSoFar } = await getSavedState(existing.id);
    const newSaved = round2(savedSoFar + goalAmount);
    const target = existing.targetAmount.toNumber();

    const [transaction, goal] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type: 'EXPENSE',
          amount,
          entityAmount,
          date: new Date(),
          note: `Aporte a meta: ${existing.name}`,
          accountId: account.id,
          goalId: existing.id,
          userId: req.auth!.userId,
        },
        include: { category: true },
      }),
      prisma.goal.update({
        where: { id: existing.id },
        data: { achievedAt: resolveAchievedAt(existing.achievedAt, newSaved, target) },
      }),
    ]);

    res.status(201).json({ transaction: serialize(transaction), goal: withSaved(goal, newSaved, true) });
  }),
);

/**
 * Registra un retiro: crea la Transaction (INCOME) vinculada por goalId — también excluida de los
 * agregados de ingreso, mismo criterio que los aportes. Si el ahorro resultante cae bajo el
 * objetivo, la meta vuelve de "lograda" a activa.
 *
 * `amount` está en la moneda de la cuenta destino (lo que efectivamente entra a la cuenta);
 * si difiere de la moneda de la meta, lo que se descuenta del ahorro es el convertido
 * persistido en `entityAmount` (mismo criterio que los aportes).
 */
router.post(
  '/:id/withdrawals',
  asyncHandler(async (req, res) => {
    const { amount, accountId: requestedAccountId, note } = withdrawalSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    const target = existing.targetAmount.toNumber();
    const account = await resolveAccount(req.auth!.userId, requestedAccountId);
    const entityAmount = await resolveGoalEntityAmount(
      req.auth!.userId,
      amount,
      account.currency,
      existing.currency,
    );
    // Monto que se descuenta del ahorro de la meta, en su moneda.
    const goalAmount = entityAmount ?? amount;

    // Transacción interactiva: el saldo se relee y valida ADENTRO, con la fila de la meta
    // bloqueada (FOR UPDATE) como primer paso. Sin el lock, dos retiros concurrentes leen el
    // mismo saldo antes de que el otro commitee (Read Committed), ambos pasan la validación y
    // el ahorro queda negativo. El lock serializa los retiros por meta; el HttpError adentro
    // hace rollback y sale como 400.
    const { transaction, goal, newSaved } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Goal" WHERE id = ${existing.id} FOR UPDATE`;

      const rows = await tx.transaction.findMany({
        where: { goalId: existing.id },
        select: { type: true, amount: true, entityAmount: true },
      });
      const savedSoFar = netSavedFromRows(rows);
      if (goalAmount > savedSoFar) throw new HttpError(400, 'El monto supera lo ahorrado en la meta');

      const newSaved = round2(savedSoFar - goalAmount);
      const transaction = await tx.transaction.create({
        data: {
          type: 'INCOME',
          amount,
          entityAmount,
          date: new Date(),
          note: note || `Retiro de meta: ${existing.name}`,
          accountId: account.id,
          goalId: existing.id,
          userId: req.auth!.userId,
        },
        include: { category: true },
      });
      const goal = await tx.goal.update({
        where: { id: existing.id },
        data: { achievedAt: resolveAchievedAt(existing.achievedAt, newSaved, target) },
      });
      return { transaction, goal, newSaved };
    });

    res.status(201).json({ transaction: serialize(transaction), goal: withSaved(goal, newSaved, true) });
  }),
);

export default router;
