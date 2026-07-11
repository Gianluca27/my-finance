import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const categorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido')
    .default('#6366f1'),
  icon: z.string().max(10).nullable().optional(),
  type: z.enum(['INCOME', 'EXPENSE']),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { userId: req.auth!.userId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });
    const withCount = categories.map(({ _count, ...c }) => ({ ...c, transactionCount: _count.transactions }));
    res.json(serialize(withCount));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = categorySchema.parse(req.body);
    const existing = await prisma.category.findUnique({
      where: {
        userId_name_type: { userId: req.auth!.userId, name: input.name, type: input.type },
      },
    });
    if (existing) throw new HttpError(409, 'Ya existe una categoría con ese nombre y tipo');
    const category = await prisma.category.create({
      data: { ...input, userId: req.auth!.userId },
    });
    res.status(201).json(serialize({ ...category, transactionCount: 0 }));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = categorySchema.partial().parse(req.body);
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
      include: { _count: { select: { transactions: true } } },
    });
    if (!existing) throw new HttpError(404, 'Categoría no encontrada');
    // Cambiar INCOME↔EXPENSE con movimientos ya cargados rompe la semántica de reportes
    // y presupuestos: solo se permite en categorías todavía sin transacciones.
    if (input.type !== undefined && input.type !== existing.type && existing._count.transactions > 0) {
      throw new HttpError(400, 'No se puede cambiar el tipo de una categoría con movimientos asociados');
    }
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: input,
      include: { _count: { select: { transactions: true } } },
    });
    const { _count, ...rest } = category;
    res.json(serialize({ ...rest, transactionCount: _count.transactions }));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Categoría no encontrada');
    // Las transacciones quedan con categoryId = null (onDelete: SetNull);
    // los presupuestos de la categoría se eliminan en cascada.
    await prisma.category.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
