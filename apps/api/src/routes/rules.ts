import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  keyword: z.string().min(1).max(100),
  categoryId: z.string().min(1),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await prisma.categoryRule.findMany({
      where: { userId: req.auth!.userId },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(serialize(rules));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId: req.auth!.userId },
    });
    if (!category) throw new HttpError(400, 'Categoría inválida');
    const rule = await prisma.categoryRule.create({
      data: { keyword: input.keyword.trim(), categoryId: input.categoryId, userId: req.auth!.userId },
      include: { category: true },
    });
    res.status(201).json(serialize(rule));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.categoryRule.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Regla no encontrada');
    await prisma.categoryRule.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
