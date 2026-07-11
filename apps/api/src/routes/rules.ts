import { Router } from 'express';
import { z } from 'zod';
import { loadRules } from '../lib/categoryRules';
import { computeRuleMatches } from '../lib/rulesApply';
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

const applySchema = z.object({
  dryRun: z.boolean().optional(),
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

/**
 * Aplica las reglas del usuario retroactivamente a movimientos SIN categoría (nunca pisa una
 * ya asignada, manual o previa). `dryRun` solo calcula el resumen sin escribir.
 */
router.post(
  '/apply',
  asyncHandler(async (req, res) => {
    const { dryRun } = applySchema.parse(req.body ?? {});
    const userId = req.auth!.userId;

    const [rules, uncategorized] = await Promise.all([
      loadRules(userId),
      prisma.transaction.findMany({
        // goalId: null — criterio spec 08: los aportes/retiros de metas son EXPENSE/INCOME sin
        // categoría pero quedan fuera de las reglas (no son gasto/ingreso real a categorizar).
        where: { userId, categoryId: null, goalId: null },
        select: { id: true, note: true, type: true },
      }),
    ]);
    const { total, byRule, matches } = computeRuleMatches(rules, uncategorized);
    let applied = total;

    if (!dryRun && matches.length > 0) {
      // Agrupado por categoría para minimizar statements; el filtro categoryId: null se repite
      // como resguardo contra una carrera con otra escritura entre el cálculo y este update.
      const idsByCategory = new Map<string, string[]>();
      for (const m of matches) {
        const arr = idsByCategory.get(m.categoryId) ?? [];
        arr.push(m.transactionId);
        idsByCategory.set(m.categoryId, arr);
      }
      const results = await prisma.$transaction(
        [...idsByCategory.entries()].map(([categoryId, ids]) =>
          prisma.transaction.updateMany({
            where: { id: { in: ids }, userId, categoryId: null },
            data: { categoryId },
          }),
        ),
      );
      // El total reportado es la suma real de updateMany, no el conteo precomputado: si hubo una
      // categorización concurrente entre el cálculo y el update, el conteo real puede ser menor.
      applied = results.reduce((sum, r) => sum + r.count, 0);
    }

    res.json({ total: applied, byRule });
  }),
);

export default router;
