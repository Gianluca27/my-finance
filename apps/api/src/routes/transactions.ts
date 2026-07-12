import type { Prisma, TransactionType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { resolveAccount, resolveAccountId } from '../lib/accounts';
import { loadRules, matchRule } from '../lib/categoryRules';
import { scaleEntityAmount } from '../lib/currency';
import { parseImportCsv, type ImportCategoryResolution } from '../lib/importCsv';
import { serialize } from '../lib/serialize';
import { suggestCategoryFromHistory } from '../lib/suggestions';
import { transactionFilterSchema } from '../lib/transactionFilters';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { checkBudgetAlert } from '../services/budgetAlerts';

const router = Router();
router.use(requireAuth);

const transactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().positive().max(999_999_999),
  date: z.coerce.date(),
  note: z.string().max(500).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
});

const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(100),
    action: z.enum(['delete', 'setCategory']),
    categoryId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.action !== 'setCategory' || !!v.categoryId, {
    message: 'categoryId es obligatorio para recategorizar',
    path: ['categoryId'],
  });

const filtersSchema = transactionFilterSchema.extend({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Valida que la categoría exista y sea del usuario; devuelve la categoría (con su tipo) o null si no se pidió ninguna. */
async function assertCategoryOwned(
  userId: string,
  categoryId: string | null | undefined,
): Promise<{ id: string; type: TransactionType } | null> {
  if (!categoryId) return null;
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true, type: true },
  });
  if (!category) throw new HttpError(400, 'Categoría inválida');
  return category;
}

const suggestCategorySchema = z.object({
  note: z.string().min(1).max(500),
  type: z.enum(['INCOME', 'EXPENSE']),
});

/**
 * Sugerencia de categoría para el formulario: primero las reglas del usuario
 * (deterministas), después el análisis del historial reciente. Devuelve null
 * si no hay señal suficiente.
 */
router.get(
  '/suggest-category',
  asyncHandler(async (req, res) => {
    const { note, type } = suggestCategorySchema.parse(req.query);
    const userId = req.auth!.userId;

    const rules = await loadRules(userId);
    const ruleMatch = matchRule(rules, note, type);
    if (ruleMatch) return res.json({ categoryId: ruleMatch, source: 'rule', confidence: 1 });

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 6);
    const history = await prisma.transaction.findMany({
      where: { userId, type, date: { gte: since }, categoryId: { not: null }, note: { not: null } },
      select: { note: true, amount: true, date: true, type: true, categoryId: true },
      orderBy: { date: 'desc' },
      take: 500,
    });
    const suggestion = suggestCategoryFromHistory(
      note,
      type,
      history.map((t) => ({ ...t, amount: t.amount.toNumber() })),
    );
    if (!suggestion) return res.json(null);
    res.json({ categoryId: suggestion.categoryId, source: 'history', confidence: suggestion.confidence });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = filtersSchema.parse(req.query);
    const searchTerm = filters.search?.trim();
    const searchOr: Prisma.TransactionWhereInput[] = [];
    if (searchTerm) {
      searchOr.push({ note: { contains: searchTerm, mode: 'insensitive' } });
      const parsedAmount = Number(searchTerm);
      if (Number.isFinite(parsedAmount)) searchOr.push({ amount: parsedAmount });
    }
    const where: Prisma.TransactionWhereInput = {
      userId: req.auth!.userId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.from || filters.to
        ? { date: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { category: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);
    res.json({ items: serialize(items), total, page: filters.page, pageSize: filters.pageSize });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = transactionSchema.parse(req.body);
    await assertCategoryOwned(req.auth!.userId, input.categoryId);
    const accountId = await resolveAccountId(req.auth!.userId, input.accountId);
    // Si no se eligió categoría, intentar autocategorizar por reglas sobre la nota.
    let categoryId = input.categoryId ?? null;
    if (!categoryId) {
      const rules = await loadRules(req.auth!.userId);
      categoryId = matchRule(rules, input.note, input.type);
    }
    const transaction = await prisma.transaction.create({
      data: { ...input, categoryId, accountId, userId: req.auth!.userId },
      include: { category: true },
    });
    if (transaction.type === 'EXPENSE') {
      // No bloquea la respuesta; las alertas de presupuesto se evalúan en segundo plano
      checkBudgetAlert(req.auth!.userId, transaction.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
    }
    res.status(201).json(serialize(transaction));
  }),
);

/**
 * Acción en lote sobre movimientos propios (máx. 100 ids). Todo o nada: si algún id no
 * pertenece al usuario (o no existe), 404 sin dejar ningún cambio. `setCategory` además
 * exige que el tipo de la categoría coincida con el de CADA transacción seleccionada.
 *
 * La garantía es escribir-y-verificar dentro de una transacción interactiva: el
 * deleteMany/updateMany corre primero y, si su conteo no coincide con los ids pedidos
 * (id ajeno, inexistente, o modificado/borrado en forma concurrente), el HttpError hace
 * rollback y el lote entero queda sin efecto. Sin ventana entre chequeo y escritura.
 */
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const input = bulkSchema.parse(req.body);
    const userId = req.auth!.userId;
    const ids = [...new Set(input.ids)];
    const notFoundMsg = 'Alguno de los movimientos seleccionados no existe o no te pertenece';

    if (input.action === 'delete') {
      const affected = await prisma.$transaction(async (tx) => {
        const result = await tx.transaction.deleteMany({ where: { id: { in: ids }, userId } });
        if (result.count !== ids.length) throw new HttpError(404, notFoundMsg);
        return result.count;
      });
      return res.json({ affected });
    }

    // setCategory: la categoría debe existir y su tipo debe coincidir con el de cada movimiento.
    const category = await assertCategoryOwned(userId, input.categoryId);
    if (!category) throw new HttpError(400, 'Categoría inválida');
    const affected = await prisma.$transaction(async (tx) => {
      // El where con `type` hace que el update solo toque filas propias del tipo correcto;
      // un conteo menor significa id faltante/ajeno o mezcla de tipos.
      const result = await tx.transaction.updateMany({
        where: { id: { in: ids }, userId, type: category.type },
        data: { categoryId: category.id },
      });
      if (result.count === ids.length) return result.count;
      // Diagnóstico solo para elegir el error (404 vs 400 con detalle); el throw deshace
      // el update parcial vía rollback.
      const owned = await tx.transaction.count({ where: { id: { in: ids }, userId } });
      if (owned !== ids.length) throw new HttpError(404, notFoundMsg);
      const mismatched = ids.length - result.count;
      const tipo = category.type === 'INCOME' ? 'ingreso' : 'gasto';
      throw new HttpError(
        400,
        `La categoría es de ${tipo} pero ${mismatched} de los ${ids.length} movimientos seleccionados son de otro tipo`,
      );
    });
    res.json({ affected });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = transactionSchema.partial().parse(req.body);
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    if (input.categoryId !== undefined) await assertCategoryOwned(req.auth!.userId, input.categoryId);
    // accountId es obligatorio: si viene en la edición, validar propiedad (nunca null).
    const { accountId: rawAccountId, ...rest } = input;
    const data: Prisma.TransactionUncheckedUpdateInput = { ...rest };
    if (rawAccountId !== undefined) {
      const newAccount = await resolveAccount(req.auth!.userId, rawAccountId);
      // Un pago de deuda / aporte de meta no puede moverse a una cuenta en otra moneda:
      // su `amount` está en la moneda de la cuenta y reinterpretarlo desalinearía el
      // saldo de la entidad (spec 19, fase B).
      if ((existing.debtId || existing.goalId) && newAccount.id !== existing.accountId) {
        const current = await prisma.account.findUnique({
          where: { id: existing.accountId },
          select: { currency: true },
        });
        if (current && current.currency !== newAccount.currency) {
          throw new HttpError(
            400,
            'No se puede mover un pago de deuda o aporte de meta a una cuenta en otra moneda. Eliminá el movimiento y registralo de nuevo desde la deuda o la meta.',
          );
        }
      }
      data.accountId = newAccount.id;
    }
    // Editar el monto de un pago cross-currency reescala su entityAmount manteniendo el TC
    // implícito de la operación original: el saldo de la deuda/meta no se reconvierte al
    // TC del día (spec 19, fase B).
    if (input.amount !== undefined && existing.entityAmount !== null) {
      data.entityAmount = scaleEntityAmount(
        existing.entityAmount.toNumber(),
        existing.amount.toNumber(),
        input.amount,
      );
    }
    const transaction = await prisma.transaction.update({
      where: { id: existing.id },
      data,
      include: { category: true },
    });
    if (transaction.type === 'EXPENSE') {
      checkBudgetAlert(req.auth!.userId, transaction.categoryId).catch((err) =>
        console.error('[budgets] Error evaluando alerta:', err),
      );
    }
    res.json(serialize(transaction));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    await prisma.transaction.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

const ALLOWED_RECEIPT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_RECEIPT_BYTES = 1_500_000;
const receiptSchema = z.object({
  data: z.string().min(1),
  mime: z.string(),
});

/** Adjunta un recibo (imagen). Recibe base64 sin prefijo `data:`. */
router.post(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const { data, mime } = receiptSchema.parse(req.body);
    if (!ALLOWED_RECEIPT_MIME.has(mime)) throw new HttpError(400, 'Formato no soportado (jpg, png o webp)');
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length === 0) throw new HttpError(400, 'Imagen inválida');
    if (buffer.length > MAX_RECEIPT_BYTES) throw new HttpError(413, 'La imagen supera 1,5 MB');
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    // Upsert del recibo + flag liviano en la transacción, en una sola transacción.
    await prisma.$transaction([
      prisma.receipt.upsert({
        where: { transactionId: existing.id },
        create: { transactionId: existing.id, data: buffer, mime },
        update: { data: buffer, mime },
      }),
      prisma.transaction.update({ where: { id: existing.id }, data: { receiptMime: mime } }),
    ]);
    res.status(201).json({ receiptMime: mime });
  }),
);

/** Sirve la imagen del recibo. `requireAuth` acepta `?token=` para poder usarla en <img>/enlaces. */
router.get(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const receipt = await prisma.receipt.findFirst({
      where: { transactionId: req.params.id, transaction: { userId: req.auth!.userId } },
    });
    if (!receipt) throw new HttpError(404, 'Sin recibo');
    res.setHeader('Content-Type', receipt.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(receipt.data));
  }),
);

router.delete(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId },
    });
    if (!existing) throw new HttpError(404, 'Transacción no encontrada');
    await prisma.$transaction([
      prisma.receipt.deleteMany({ where: { transactionId: existing.id } }),
      prisma.transaction.update({ where: { id: existing.id }, data: { receiptMime: null } }),
    ]);
    res.status(204).end();
  }),
);

const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  accountId: z.string().nullable().optional(),
});

/**
 * Arma el `categoryId` final de una fila ya parseada: existente o recién creada (`toCreate`,
 * resuelto contra el mapa de categorías creadas en esta misma corrida) o por regla; `none` no
 * tiene categoría.
 */
function resolveRowCategoryId(
  category: ImportCategoryResolution,
  newCategoryIds: Map<string, string>,
): string | null {
  switch (category.kind) {
    case 'existing':
    case 'rule':
      return category.categoryId;
    case 'toCreate':
      return newCategoryIds.get(category.key) ?? null;
    case 'none':
      return null;
  }
}

/**
 * Importa transacciones desde el CSV con el mismo formato que exporta la app (ver
 * `lib/importCsv.ts` para el detalle del parseo/resolución de categorías). Con
 * `?dryRun=true` corre exactamente el mismo parseo/validación pero no escribe nada — ni
 * transacciones ni categorías nuevas — y devuelve un preview con las primeras 10 filas
 * interpretadas para mostrar antes de confirmar.
 *
 * Moneda (spec 19, fase C): los movimientos importados quedan en la cuenta elegida y por lo
 * tanto en SU moneda — el `monto` del CSV se toma como nominal de esa moneda, sin conversión.
 * La columna `moneda` de la exportación se ignora, igual que `meta` y `cuenta` (las columnas
 * se leen por posición, solo las primeras 5).
 */
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const { csv, accountId: requestedAccountId } = importSchema.parse(req.body);
    const dryRun = req.query.dryRun === 'true';
    const userId = req.auth!.userId;
    // Se valida la cuenta también en dryRun (mismo pipeline completo, solo difiere la escritura);
    // no se usa en la respuesta del preview, pero un accountId inválido debe fallar temprano.
    const accountId = await resolveAccountId(userId, requestedAccountId);

    const [categories, rules] = await Promise.all([
      prisma.category.findMany({ where: { userId } }),
      loadRules(userId),
    ]);
    const parsed = parseImportCsv(csv, categories, rules);

    if (dryRun) {
      const sample = parsed.rows.slice(0, 10).map((row) => ({
        fecha: row.date.toISOString().slice(0, 10),
        tipo: row.type === 'INCOME' ? 'ingreso' : ('gasto' as const),
        monto: row.amount,
        categoria: row.category.label,
        nota: row.note ?? '',
      }));
      res.json({
        total: parsed.total,
        valid: parsed.rows.length,
        skipped: parsed.skipped,
        errors: parsed.errors,
        sample,
      });
      return;
    }

    const imported = await prisma.$transaction(async (tx) => {
      const newCategoryIds = new Map<string, string>();
      for (const cat of parsed.categoriesToCreate) {
        // upsert por si la categoría se creó por otra vía entre el parseo y esta escritura
        // (ej: otra pestaña) — evita chocar contra el único (userId, name, type).
        const category = await tx.category.upsert({
          where: { userId_name_type: { userId, name: cat.name, type: cat.type } },
          create: { userId, name: cat.name, type: cat.type },
          update: {},
        });
        newCategoryIds.set(cat.key, category.id);
      }

      const toCreate: Prisma.TransactionCreateManyInput[] = parsed.rows.map((row) => ({
        userId,
        type: row.type,
        amount: row.amount,
        date: row.date,
        note: row.note,
        categoryId: resolveRowCategoryId(row.category, newCategoryIds),
        accountId,
      }));
      if (toCreate.length > 0) await tx.transaction.createMany({ data: toCreate });
      return toCreate.length;
    });

    res.status(201).json({ imported, skipped: parsed.skipped, errors: parsed.errors });
  }),
);

export default router;
