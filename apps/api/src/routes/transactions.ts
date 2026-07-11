import type { Prisma, TransactionType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { resolveAccountId } from '../lib/accounts';
import { loadRules, matchRule } from '../lib/categoryRules';
import { serialize } from '../lib/serialize';
import { suggestCategoryFromHistory } from '../lib/suggestions';
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

const filtersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
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
      data.accountId = await resolveAccountId(req.auth!.userId, rawAccountId);
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

/** Parsea una línea CSV (comillas dobles, comas y comillas escapadas ""). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Importa transacciones desde el CSV con el mismo formato que exporta la app
 * (encabezado `fecha,tipo,monto,categoria,nota,meta`; la columna `meta` de la exportación se
 * ignora al importar — las columnas se leen por posición, así que los CSV viejos de 5 columnas
 * siguen siendo válidos). Las categorías se emparejan por nombre+tipo; si no existe, el
 * movimiento se importa sin categoría.
 */
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const { csv, accountId: requestedAccountId } = importSchema.parse(req.body);
    const userId = req.auth!.userId;
    const accountId = await resolveAccountId(userId, requestedAccountId);

    const categories = await prisma.category.findMany({ where: { userId } });
    const categoryByKey = new Map(categories.map((c) => [`${c.type}:${c.name.trim().toLowerCase()}`, c.id]));
    const rules = await loadRules(userId);

    const rawLines = csv.replace(/^﻿/, '').split(/\r?\n/);
    const errors: Array<{ line: number; reason: string }> = [];
    const toCreate: Prisma.TransactionCreateManyInput[] = [];
    let skipped = 0;

    rawLines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      if (rawLine.trim() === '') {
        skipped++;
        return;
      }
      const cols = parseCsvLine(rawLine).map((c) => c.trim());
      // Encabezado (mismo formato que la exportación)
      if (index === 0 && cols[0]?.toLowerCase() === 'fecha') {
        skipped++;
        return;
      }
      const [fechaStr, tipoStr, montoStr, categoriaStr, notaStr] = cols;

      const date = new Date(fechaStr);
      if (!fechaStr || Number.isNaN(date.getTime())) {
        errors.push({ line: lineNo, reason: 'Fecha inválida' });
        return;
      }
      const tipoNorm = (tipoStr ?? '').toLowerCase();
      const type = tipoNorm === 'ingreso' ? 'INCOME' : tipoNorm === 'gasto' ? 'EXPENSE' : null;
      if (!type) {
        errors.push({ line: lineNo, reason: 'Tipo debe ser "ingreso" o "gasto"' });
        return;
      }
      const amount = Number((montoStr ?? '').replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push({ line: lineNo, reason: 'Monto inválido' });
        return;
      }

      let categoryId =
        categoriaStr && categoriaStr.toLowerCase() !== 'sin categoría'
          ? categoryByKey.get(`${type}:${categoriaStr.toLowerCase()}`) ?? null
          : null;
      // Sin categoría explícita en el CSV → intentar autocategorizar por reglas sobre la nota.
      if (!categoryId) categoryId = matchRule(rules, notaStr ?? null, type);

      toCreate.push({
        userId,
        type,
        amount,
        date,
        note: notaStr ? notaStr.slice(0, 500) : null,
        categoryId,
        accountId,
      });
    });

    if (toCreate.length > 0) {
      await prisma.transaction.createMany({ data: toCreate });
    }

    res.status(201).json({ imported: toCreate.length, skipped, errors: errors.slice(0, 50) });
  }),
);

export default router;
