import type { Investment, InvestmentOperation } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { buildInvestmentsSummary, computePosition, investmentMetrics, type PositionOp } from '../lib/investments';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const typeEnum = z.enum(['ACCION', 'CEDEAR', 'CRIPTO', 'FCI', 'PLAZO_FIJO', 'BONO', 'OTRO']);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: typeEnum,
  symbol: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().max(8).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(16).nullable().optional(),
});

const updateSchema = createSchema.partial().extend({
  /// true archiva (setea archivedAt), false desarchiva.
  archived: z.boolean().optional(),
});

const operationSchema = z.object({
  type: z.enum(['COMPRA', 'VENTA']),
  quantity: z.number().positive().max(999_999_999_999),
  unitPrice: z.number().positive().max(999_999_999_999),
  date: z.coerce.date().optional(),
  note: z.string().max(500).nullable().optional(),
});

const priceSchema = z.object({
  price: z.number().positive().max(999_999_999_999),
});

const rateSchema = z.object({
  currency: z.string().trim().min(1).max(8),
  rate: z.number().positive().max(999_999_999_999),
});

/** Normaliza códigos tipeados: mayúsculas, y vacío/null -> null. */
function normalizeCode(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim().toUpperCase() ?? null;
  return trimmed ? trimmed : null;
}

interface DatedOp extends PositionOp {
  date: Date;
  createdAt: Date;
}

/** Orden cronológico; ante la misma fecha desempata por orden de carga. */
function sortOps(ops: DatedOp[]): DatedOp[] {
  return [...ops].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
}

function toDatedOps(ops: InvestmentOperation[]): DatedOp[] {
  return ops.map((op) => ({
    type: op.type,
    quantity: op.quantity.toNumber(),
    unitPrice: op.unitPrice.toNumber(),
    date: op.date,
    createdAt: op.createdAt,
  }));
}

function fetchOps(investmentId: string) {
  return prisma.investmentOperation.findMany({
    where: { investmentId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Activo serializado + métricas derivadas del ledger, en su moneda. */
function toInvestmentJson(investment: Investment, ops: PositionOp[]) {
  return {
    ...(serialize(investment) as Record<string, unknown>),
    ...investmentMetrics(investment.currentPrice?.toNumber() ?? null, ops),
  };
}

/** Detalle completo: métricas + operaciones (recientes primero) + histórico de precios. */
async function buildDetail(investment: Investment) {
  const [ops, snapshots] = await Promise.all([
    fetchOps(investment.id),
    prisma.investmentPriceSnapshot.findMany({
      where: { investmentId: investment.id },
      orderBy: { date: 'asc' },
    }),
  ]);
  return {
    ...toInvestmentJson(investment, toDatedOps(ops)),
    operations: serialize([...ops].reverse()),
    priceHistory: serialize(snapshots.map((s) => ({ id: s.id, price: s.price, date: s.date }))),
  };
}

async function findOwned(userId: string, id: string): Promise<Investment> {
  const investment = await prisma.investment.findFirst({ where: { id, userId } });
  if (!investment) throw new HttpError(404, 'Inversión no encontrada');
  return investment;
}

// --- Cotizaciones (antes de '/:id' para que 'rates' no matchee como id) ---

router.put(
  '/rates',
  asyncHandler(async (req, res) => {
    const input = rateSchema.parse(req.body);
    const userId = req.auth!.userId;
    const currency = input.currency.toUpperCase();
    const rate = await prisma.exchangeRate.upsert({
      where: { userId_currency: { userId, currency } },
      update: { rate: input.rate },
      create: { userId, currency, rate: input.rate },
    });
    res.json(serialize(rate));
  }),
);

router.delete(
  '/rates/:currency',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { count } = await prisma.exchangeRate.deleteMany({
      where: { userId, currency: req.params.currency.toUpperCase() },
    });
    if (count === 0) throw new HttpError(404, 'Cotización no encontrada');
    res.status(204).end();
  }),
);

// --- Activos ---

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const [investments, allOps, rates] = await Promise.all([
      prisma.investment.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      prisma.investmentOperation.findMany({
        where: { userId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.exchangeRate.findMany({ where: { userId }, orderBy: { currency: 'asc' } }),
    ]);

    const opsByInvestment = new Map<string, InvestmentOperation[]>();
    for (const op of allOps) {
      const list = opsByInvestment.get(op.investmentId) ?? [];
      list.push(op);
      opsByInvestment.set(op.investmentId, list);
    }

    const items = investments.map((inv) => ({
      investment: inv,
      json: toInvestmentJson(inv, toDatedOps(opsByInvestment.get(inv.id) ?? [])),
    }));

    const rateMap = new Map(rates.map((r) => [r.currency, r.rate.toNumber()]));
    // Los archivados no participan de los totales del portafolio.
    const summary = buildInvestmentsSummary(
      items
        .filter(({ investment }) => investment.archivedAt === null)
        .map(({ investment, json }) => ({
          currency: investment.currency,
          investedCost: json.investedCost as number,
          currentValue: json.currentValue as number,
        })),
      rateMap,
    );

    res.json({ items: items.map(({ json }) => json), rates: serialize(rates), summary });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const investment = await findOwned(req.auth!.userId, req.params.id);
    res.json(await buildDetail(investment));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const investment = await prisma.investment.create({
      data: {
        ...input,
        symbol: normalizeCode(input.symbol) ?? null,
        currency: normalizeCode(input.currency) ?? null,
        userId: req.auth!.userId,
      },
    });
    res.status(201).json(toInvestmentJson(investment, []));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);

    const { archived, ...fields } = input;
    const data: Record<string, unknown> = { ...fields };
    if ('symbol' in input) data.symbol = normalizeCode(input.symbol) ?? null;
    if ('currency' in input) data.currency = normalizeCode(input.currency) ?? null;
    if (archived !== undefined) {
      data.archivedAt = archived ? existing.archivedAt ?? new Date() : null;
    }

    const investment = await prisma.investment.update({ where: { id: existing.id }, data });
    const ops = await fetchOps(investment.id);
    res.json(toInvestmentJson(investment, toDatedOps(ops)));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const opCount = await prisma.investmentOperation.count({ where: { investmentId: existing.id } });
    if (opCount > 0) {
      throw new HttpError(400, 'El activo tiene operaciones registradas. Archivalo en lugar de eliminarlo.');
    }
    await prisma.investment.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

// --- Operaciones ---

router.post(
  '/:id/operations',
  asyncHandler(async (req, res) => {
    const input = operationSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);

    const now = new Date();
    const opDate = input.date ?? now;
    const ops = toDatedOps(await fetchOps(existing.id));
    const candidate = sortOps([
      ...ops,
      { type: input.type, quantity: input.quantity, unitPrice: input.unitPrice, date: opDate, createdAt: now },
    ]);
    // Valida toda la secuencia: una venta (incluso retroactiva) nunca puede
    // superar la tenencia disponible a esa fecha.
    if (computePosition(candidate) === null) {
      throw new HttpError(400, 'La venta supera la tenencia disponible a esa fecha.');
    }

    await prisma.investmentOperation.create({
      data: {
        type: input.type,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        date: opDate,
        note: input.note ?? null,
        investmentId: existing.id,
        userId: req.auth!.userId,
      },
    });
    res.status(201).json(await buildDetail(existing));
  }),
);

router.delete(
  '/:id/operations/:operationId',
  asyncHandler(async (req, res) => {
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const operation = await prisma.investmentOperation.findFirst({
      where: { id: req.params.operationId, investmentId: existing.id },
    });
    if (!operation) throw new HttpError(404, 'Operación no encontrada');

    const ops = await fetchOps(existing.id);
    const remaining = toDatedOps(ops.filter((op) => op.id !== operation.id));
    if (computePosition(sortOps(remaining)) === null) {
      throw new HttpError(400, 'No se puede eliminar: dejaría ventas sin tenencia suficiente.');
    }

    await prisma.investmentOperation.delete({ where: { id: operation.id } });
    res.json(await buildDetail(existing));
  }),
);

// --- Precio manual ---

router.patch(
  '/:id/price',
  asyncHandler(async (req, res) => {
    const { price } = priceSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const now = new Date();
    const [investment] = await prisma.$transaction([
      prisma.investment.update({
        where: { id: existing.id },
        data: { currentPrice: price, priceUpdatedAt: now },
      }),
      // Cada actualización deja un punto en el histórico para el gráfico.
      prisma.investmentPriceSnapshot.create({
        data: { investmentId: existing.id, price, date: now },
      }),
    ]);
    const ops = await fetchOps(investment.id);
    res.json(toInvestmentJson(investment, toDatedOps(ops)));
  }),
);

export default router;
