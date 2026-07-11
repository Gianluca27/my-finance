import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const accountSelect = { select: { id: true, name: true, color: true, icon: true, type: true } };

const createSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().positive().max(999_999_999),
  date: z.coerce.date().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Origen y destino distintos, y ambos de propiedad del usuario. Comparte reglas entre POST y PUT. */
async function validateAccounts(userId: string, fromAccountId: string, toAccountId: string) {
  if (fromAccountId === toAccountId) {
    throw new HttpError(400, 'La cuenta de origen y destino deben ser distintas');
  }
  const accounts = await prisma.account.findMany({
    where: { id: { in: [fromAccountId, toAccountId] }, userId },
  });
  if (accounts.length !== 2) throw new HttpError(400, 'Cuenta de origen o destino inválida');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const transfers = await prisma.transfer.findMany({
      where: { userId: req.auth!.userId },
      include: { fromAccount: accountSelect, toAccount: accountSelect },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(serialize(transfers));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const userId = req.auth!.userId;
    await validateAccounts(userId, input.fromAccountId, input.toAccountId);

    const transfer = await prisma.transfer.create({
      data: {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        date: input.date ?? new Date(),
        note: input.note ?? null,
        userId,
      },
      include: { fromAccount: accountSelect, toAccount: accountSelect },
    });
    res.status(201).json(serialize(transfer));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const userId = req.auth!.userId;
    const existing = await prisma.transfer.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new HttpError(404, 'Transferencia no encontrada');
    await validateAccounts(userId, input.fromAccountId, input.toAccountId);

    const transfer = await prisma.transfer.update({
      where: { id: existing.id },
      data: {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        date: input.date ?? existing.date,
        note: input.note ?? null,
      },
      include: { fromAccount: accountSelect, toAccount: accountSelect },
    });
    res.json(serialize(transfer));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transfer.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!existing) throw new HttpError(404, 'Transferencia no encontrada');
    await prisma.transfer.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
