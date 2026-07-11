import { Router } from 'express';
import { z } from 'zod';
import { resolveAccountId } from '../lib/accounts';
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

/** Ahorro neto de la meta: aportes (EXPENSE) menos retiros (INCOME), ambos vinculados por goalId. */
async function getSavedAmount(goalId: string): Promise<number> {
  const sums = await prisma.transaction.groupBy({
    by: ['type'],
    where: { goalId },
    _sum: { amount: true },
  });
  const contributed = sums.find((s) => s.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;
  const withdrawn = sums.find((s) => s.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
  return netSaved(contributed, withdrawn);
}

function withSaved(goal: { targetAmount: { toNumber(): number } }, saved: number) {
  const target = goal.targetAmount.toNumber();
  return {
    ...(serialize(goal) as Record<string, unknown>),
    saved: round2(saved),
    remaining: Math.max(0, round2(target - saved)),
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
    // Agrupa por meta y tipo: hay que netear aportes (EXPENSE) contra retiros (INCOME) antes de sumar.
    const savedSums = await prisma.transaction.groupBy({
      by: ['goalId', 'type'],
      where: { userId, goalId: { in: goals.map((g) => g.id) } },
      _sum: { amount: true },
    });
    const contributedMap = new Map<string, number>();
    const withdrawnMap = new Map<string, number>();
    for (const s of savedSums) {
      if (!s.goalId) continue;
      const amount = s._sum.amount?.toNumber() ?? 0;
      const target = s.type === 'EXPENSE' ? contributedMap : withdrawnMap;
      target.set(s.goalId, (target.get(s.goalId) ?? 0) + amount);
    }
    res.json(
      goals.map((goal) =>
        withSaved(goal, netSaved(contributedMap.get(goal.id) ?? 0, withdrawnMap.get(goal.id) ?? 0)),
      ),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const goal = await prisma.goal.create({
      data: { ...input, userId: req.auth!.userId },
    });
    res.status(201).json(withSaved(goal, 0));
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
    const saved = await getSavedAmount(existing.id);
    const target = input.targetAmount ?? existing.targetAmount.toNumber();

    const goal = await prisma.goal.update({
      where: { id: existing.id },
      data: { ...input, achievedAt: resolveAchievedAt(existing.achievedAt, saved, target) },
    });
    res.json(withSaved(goal, saved));
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
 * Registra un aporte: crea la Transaction (EXPENSE) vinculada por goalId y marca la meta como
 * lograda al alcanzar el objetivo. Queda excluida de los agregados de gasto (dashboard, presupuestos,
 * resumen PDF) porque no es un gasto real — el balance de la cuenta sí baja, eso es correcto.
 */
router.post(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const { amount, accountId: requestedAccountId } = contributionSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    const savedSoFar = await getSavedAmount(existing.id);
    const newSaved = round2(savedSoFar + amount);
    const target = existing.targetAmount.toNumber();
    const accountId = await resolveAccountId(req.auth!.userId, requestedAccountId);

    const [transaction, goal] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type: 'EXPENSE',
          amount,
          date: new Date(),
          note: `Aporte a meta: ${existing.name}`,
          accountId,
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

    res.status(201).json({ transaction: serialize(transaction), goal: withSaved(goal, newSaved) });
  }),
);

/**
 * Registra un retiro: crea la Transaction (INCOME) vinculada por goalId — también excluida de los
 * agregados de ingreso, mismo criterio que los aportes. Si el ahorro resultante cae bajo el
 * objetivo, la meta vuelve de "lograda" a activa.
 */
router.post(
  '/:id/withdrawals',
  asyncHandler(async (req, res) => {
    const { amount, accountId: requestedAccountId, note } = withdrawalSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    const savedSoFar = await getSavedAmount(existing.id);
    if (amount > savedSoFar) throw new HttpError(400, 'El monto supera lo ahorrado en la meta');

    const newSaved = round2(savedSoFar - amount);
    const target = existing.targetAmount.toNumber();
    const accountId = await resolveAccountId(req.auth!.userId, requestedAccountId);

    const [transaction, goal] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          type: 'INCOME',
          amount,
          date: new Date(),
          note: note || `Retiro de meta: ${existing.name}`,
          accountId,
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

    res.status(201).json({ transaction: serialize(transaction), goal: withSaved(goal, newSaved) });
  }),
);

export default router;
