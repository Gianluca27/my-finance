import { Router } from 'express';
import { z } from 'zod';
import { nextDueDate } from '../lib/dates';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { refreshSuggestionsForUser } from '../services/suggestions';

const router = Router();
router.use(requireAuth);

/** Forma persistida en Suggestion.payload según el tipo (ver @myfinance/shared). */
interface RecurringPayload {
  name: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  dueDay: number;
  dueMonth: number | null;
  categoryId: string | null;
}

interface RulePayload {
  keyword: string;
  categoryId: string;
}

/** Ediciones opcionales al aceptar: pisan los valores detectados. */
const acceptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  amount: z.number().positive().max(999_999_999).optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  dueDay: z.number().int().optional(),
  dueMonth: z.number().int().min(1).max(12).nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).optional(),
  categoryId: z.string().nullable().optional(),
  keyword: z.string().min(1).max(100).optional(),
});

async function assertCategoryOwned(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new HttpError(400, 'Categoría inválida');
}

async function findPendingSuggestion(userId: string, id: string) {
  const suggestion = await prisma.suggestion.findFirst({ where: { id, userId } });
  if (!suggestion) throw new HttpError(404, 'Sugerencia no encontrada');
  if (suggestion.status !== 'PENDING') throw new HttpError(400, 'La sugerencia ya fue resuelta');
  return suggestion;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.suggestion.findMany({
      where: { userId: req.auth!.userId, status: 'PENDING' },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(serialize(items));
  }),
);

/** Corre la detección sobre el historial del usuario y devuelve las pendientes. */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const created = await refreshSuggestionsForUser(req.auth!.userId);
    const items = await prisma.suggestion.findMany({
      where: { userId: req.auth!.userId, status: 'PENDING' },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ created, items: serialize(items) });
  }),
);

/** Acepta la sugerencia: crea el recurrente o la regla con los valores detectados + ediciones. */
router.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const suggestion = await findPendingSuggestion(userId, req.params.id);
    const edits = acceptSchema.parse(req.body ?? {});

    if (suggestion.type === 'RECURRING') {
      const payload = suggestion.payload as unknown as RecurringPayload;
      const frequency = edits.frequency ?? payload.frequency;
      const dueDay = edits.dueDay ?? payload.dueDay;
      const dueMonth = edits.dueMonth !== undefined ? edits.dueMonth : payload.dueMonth;
      if (frequency === 'WEEKLY' && (dueDay < 0 || dueDay > 6)) {
        throw new HttpError(400, 'Para frecuencia semanal, dueDay debe ser 0-6 (0 = domingo)');
      }
      if (frequency !== 'WEEKLY' && (dueDay < 1 || dueDay > 31)) {
        throw new HttpError(400, 'dueDay debe ser 1-31');
      }
      if (frequency === 'YEARLY' && !dueMonth) {
        throw new HttpError(400, 'Para frecuencia anual, dueMonth (1-12) es obligatorio');
      }
      const categoryId = edits.categoryId !== undefined ? edits.categoryId : payload.categoryId;
      await assertCategoryOwned(userId, categoryId);

      const [recurring, updated] = await prisma.$transaction([
        prisma.recurringExpense.create({
          data: {
            name: edits.name ?? payload.name,
            type: payload.type,
            amount: edits.amount ?? payload.amount,
            frequency,
            dueDay,
            dueMonth,
            reminderDaysBefore: edits.reminderDaysBefore ?? 3,
            categoryId,
            userId,
            nextDueDate: nextDueDate(frequency, dueDay, dueMonth),
          },
          include: { category: true },
        }),
        prisma.suggestion.update({ where: { id: suggestion.id }, data: { status: 'ACCEPTED' } }),
      ]);
      return res.status(201).json({ suggestion: serialize(updated), recurring: serialize(recurring) });
    }

    // RULE
    const payload = suggestion.payload as unknown as RulePayload;
    const keyword = (edits.keyword ?? payload.keyword).trim();
    if (!keyword) throw new HttpError(400, 'Keyword inválido');
    const categoryId = edits.categoryId ?? payload.categoryId;
    if (!categoryId) throw new HttpError(400, 'Categoría requerida');
    await assertCategoryOwned(userId, categoryId);

    const [rule, updated] = await prisma.$transaction([
      prisma.categoryRule.create({
        data: { keyword, categoryId, userId },
        include: { category: true },
      }),
      prisma.suggestion.update({ where: { id: suggestion.id }, data: { status: 'ACCEPTED' } }),
    ]);
    res.status(201).json({ suggestion: serialize(updated), rule: serialize(rule) });
  }),
);

/** Descarta la sugerencia. El fingerprint queda registrado: no se vuelve a sugerir. */
router.post(
  '/:id/dismiss',
  asyncHandler(async (req, res) => {
    const suggestion = await findPendingSuggestion(req.auth!.userId, req.params.id);
    await prisma.suggestion.update({ where: { id: suggestion.id }, data: { status: 'DISMISSED' } });
    res.status(204).end();
  }),
);

export default router;
