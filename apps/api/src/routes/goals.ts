import { Router } from 'express';
import { z } from 'zod';
import { getDefaultAccountId } from '../lib/accounts';
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
});

async function getSavedAmount(goalId: string): Promise<number> {
  const result = await prisma.transaction.aggregate({ where: { goalId }, _sum: { amount: true } });
  return result._sum.amount?.toNumber() ?? 0;
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
    const savedSums = await prisma.transaction.groupBy({
      by: ['goalId'],
      where: { userId, goalId: { in: goals.map((g) => g.id) } },
      _sum: { amount: true },
    });
    const savedMap = new Map(
      savedSums
        .filter((s): s is typeof s & { goalId: string } => s.goalId !== null)
        .map((s) => [s.goalId, s._sum.amount?.toNumber() ?? 0]),
    );
    res.json(goals.map((goal) => withSaved(goal, savedMap.get(goal.id) ?? 0)));
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
    const goal = await prisma.goal.update({ where: { id: existing.id }, data: input });
    const saved = await getSavedAmount(goal.id);
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

/** Registra un aporte: crea la Transaction (EXPENSE) vinculada y marca la meta como lograda al alcanzar el objetivo. */
router.post(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const { amount } = contributionSchema.parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Meta no encontrada');

    const savedSoFar = await getSavedAmount(existing.id);
    const newSaved = round2(savedSoFar + amount);
    const target = existing.targetAmount.toNumber();
    const justAchieved = !existing.achievedAt && newSaved >= target;
    const accountId = await getDefaultAccountId(req.auth!.userId);

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
        data: justAchieved ? { achievedAt: new Date() } : {},
      }),
    ]);

    res.status(201).json({ transaction: serialize(transaction), goal: withSaved(goal, newSaved) });
  }),
);

export default router;
