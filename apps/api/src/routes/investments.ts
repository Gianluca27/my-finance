import type { Investment, InvestmentOperation } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  buildInvestmentsSummary,
  closestPriceMatch,
  computePosition,
  investmentMetrics,
  type PositionOp,
} from '../lib/investments';
import { serialize } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import {
  DOLAR_CURRENCIES,
  data912Enabled,
  getProvider,
  priceFactorFor,
  providerAvailability,
  providersFor,
  searchSymbols,
  twelveDataEnabled,
  type DailyClose,
  type ProviderMarket,
  type ProviderSource,
  type SymbolRef,
} from '../services/providers';

const router = Router();
router.use(requireAuth);

const typeEnum = z.enum(['ACCION', 'ETF', 'CEDEAR', 'CRIPTO', 'FCI', 'PLAZO_FIJO', 'BONO', 'OTRO']);
const sourceEnum = z.enum(['TWELVE_DATA', 'DATA912']);
const marketEnum = z.enum(['stocks', 'cedears', 'bonds', 'notes', 'corp']);

const baseSchema = z.object({
  name: z.string().min(1).max(100),
  type: typeEnum,
  symbol: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().max(8).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(16).nullable().optional(),
  /// Símbolo del proveedor (ej: AAPL, BTC/USD, AL30D). Con valor = precio automático.
  providerSymbol: z.string().trim().max(30).nullable().optional(),
  providerSource: sourceEnum.nullable().optional(),
  providerMarket: marketEnum.nullable().optional(),
  providerExchange: z.string().trim().max(40).nullable().optional(),
  /// Solo para activos manuales; en los vinculados lo deriva el mercado.
  priceFactor: z.union([z.literal(1), z.literal(100)]).optional(),
});

/** Un símbolo vinculado no sirve sin saber a qué proveedor (y mercado) pedirle el precio. */
function refineProviderLink(
  input: { providerSymbol?: string | null; providerSource?: ProviderSource | null; providerMarket?: ProviderMarket | null },
  ctx: z.RefinementCtx,
): void {
  if (!input.providerSymbol?.trim()) return;
  if (!input.providerSource) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerSource'],
      message: 'providerSource es obligatorio cuando se envía providerSymbol',
    });
    return;
  }
  if (input.providerSource === 'DATA912' && !input.providerMarket) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerMarket'],
      message: 'providerMarket es obligatorio cuando providerSource es DATA912',
    });
  }
}

const createSchema = baseSchema.superRefine(refineProviderLink);

const updateSchema = baseSchema
  .partial()
  .extend({
    /// true archiva (setea archivedAt), false desarchiva.
    archived: z.boolean().optional(),
  })
  .superRefine(refineProviderLink);

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
    ...investmentMetrics(investment.currentPrice?.toNumber() ?? null, ops, investment.priceFactor),
  };
}

/** El `providerSource` viaja como String en la DB; acá se valida contra el registry. */
function providerLabel(source: string | null): string {
  const parsed = sourceEnum.safeParse(source);
  return parsed.success ? getProvider(parsed.data).label : 'el proveedor';
}

function toRef(symbol: string, market: string | null): SymbolRef {
  return { symbol, market: market as ProviderMarket | null };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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

/**
 * Datos del proveedor para vincular un activo: precio actual + 1 año de cierres
 * diarios (backfill del histórico). Se pide ANTES de escribir, así un símbolo
 * inválido o un límite de créditos no deja el activo a medio vincular.
 *
 * El precio es obligatorio; el histórico es best-effort: `notes` y `corp` no lo
 * tienen y algún ticker suelto puede no estar en el endpoint OHLC. En esos casos
 * el gráfico arranca vacío y se llena con los snapshots del cron.
 */
async function fetchProviderData(
  source: ProviderSource,
  ref: SymbolRef,
): Promise<{ price: number; closes: DailyClose[] }> {
  const provider = getProvider(source);
  if (!provider.enabled) {
    throw new HttpError(400, `La integración con ${provider.label} no está configurada.`);
  }
  const [priceResult, closesResult] = await Promise.allSettled([
    provider.fetchPrice(ref),
    provider.fetchDailyCloses(ref),
  ]);
  if (priceResult.status === 'rejected') {
    const reason = priceResult.reason;
    throw new HttpError(
      400,
      `No se pudo vincular ${ref.symbol}: ${reason instanceof Error ? reason.message : 'error inesperado'}`,
    );
  }
  if (closesResult.status === 'rejected') {
    console.warn(`[investments] Sin histórico para ${ref.symbol}:`, closesResult.reason);
  }
  return {
    price: priceResult.value,
    closes: closesResult.status === 'fulfilled' ? closesResult.value : [],
  };
}

/** Reemplaza el histórico del rango backfilleado por los cierres oficiales. */
function replaceSnapshotsWithCloses(investmentId: string, closes: DailyClose[]) {
  if (closes.length === 0) return [];
  return [
    prisma.investmentPriceSnapshot.deleteMany({
      where: { investmentId, date: { gte: closes[0].date } },
    }),
    prisma.investmentPriceSnapshot.createMany({
      data: closes.map((c) => ({ investmentId, price: c.price, date: c.date })),
    }),
  ];
}

// --- Búsqueda de símbolos (antes de '/:id' para que 'symbols' no matchee como id) ---

const searchQuerySchema = z.object({
  type: z.enum(['ACCION', 'ETF', 'CRIPTO', 'CEDEAR', 'BONO']),
  q: z.string().trim().min(1).max(40),
});

router.get(
  '/symbols/search',
  asyncHandler(async (req, res) => {
    const { type, q } = searchQuerySchema.parse(req.query);
    // ACCION consulta los dos proveedores (NASDAQ y BYMA); el resto, uno solo.
    if (providersFor(type).length === 0) {
      res.json({ enabled: false, items: [] });
      return;
    }
    const items = await searchSymbols(type, q);
    res.json({ enabled: true, items });
  }),
);

// --- Cotizaciones (antes de '/:id' para que 'rates' no matchee como id) ---

/** El dólar oficial (Twelve Data) y el MEP/CCL (data912) los mantiene el cron: no se tocan a mano. */
function assertRateEditable(currency: string): void {
  if (twelveDataEnabled && currency === 'USD') {
    throw new HttpError(400, 'La cotización USD (oficial) se actualiza automáticamente desde Twelve Data.');
  }
  if (data912Enabled && (currency === DOLAR_CURRENCIES.mep || currency === DOLAR_CURRENCIES.ccl)) {
    throw new HttpError(400, `La cotización ${currency} se actualiza automáticamente desde data912.`);
  }
}

router.put(
  '/rates',
  asyncHandler(async (req, res) => {
    const input = rateSchema.parse(req.body);
    const userId = req.auth!.userId;
    const currency = input.currency.toUpperCase();
    assertRateEditable(currency);
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
    const currency = req.params.currency.toUpperCase();
    assertRateEditable(currency);
    const { count } = await prisma.exchangeRate.deleteMany({
      where: { userId, currency },
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

    res.json({
      items: items.map(({ json }) => json),
      rates: serialize(rates),
      summary,
      providers: providerAvailability(),
    });
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
    const providerSymbol = normalizeCode(input.providerSymbol) ?? null;
    // El esquema garantiza que con símbolo viene source, y con DATA912 viene market.
    const providerSource = providerSymbol ? input.providerSource! : null;
    const providerMarket = providerSource === 'DATA912' ? input.providerMarket! : null;
    const provider =
      providerSymbol && providerSource
        ? await fetchProviderData(providerSource, toRef(providerSymbol, providerMarket))
        : null;

    const investment = await prisma.investment.create({
      data: {
        name: input.name,
        type: input.type,
        color: input.color,
        icon: input.icon ?? null,
        symbol: normalizeCode(input.symbol) ?? null,
        currency: normalizeCode(input.currency) ?? null,
        providerSymbol,
        providerSource,
        providerMarket,
        providerExchange: providerSymbol ? input.providerExchange?.trim() || null : null,
        // Vinculado: lo manda el mercado. Manual: lo elige el usuario (bonos cotizan cada 100 VN).
        priceFactor: providerSymbol ? priceFactorFor(providerMarket) : input.priceFactor ?? 1,
        ...(provider ? { currentPrice: provider.price, priceUpdatedAt: new Date() } : {}),
        userId: req.auth!.userId,
      },
    });
    if (provider) {
      await prisma.$transaction(replaceSnapshotsWithCloses(investment.id, provider.closes));
    }
    res.status(201).json(toInvestmentJson(investment, []));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);

    // Los campos de proveedor y el factor se manejan aparte: nunca se copian crudos.
    const {
      archived,
      providerSymbol: _symbol,
      providerSource: _source,
      providerMarket: _market,
      providerExchange: _exchange,
      priceFactor: _factor,
      ...fields
    } = input;
    const data: Record<string, unknown> = { ...fields };
    if ('symbol' in input) data.symbol = normalizeCode(input.symbol) ?? null;
    if ('currency' in input) data.currency = normalizeCode(input.currency) ?? null;
    if (archived !== undefined) {
      data.archivedAt = archived ? existing.archivedAt ?? new Date() : null;
    }

    // Vinculación/desvinculación con un proveedor.
    let backfill: DailyClose[] | null = null;
    if ('providerSymbol' in input) {
      const providerSymbol = normalizeCode(input.providerSymbol) ?? null;
      const providerSource = providerSymbol ? input.providerSource! : null;
      const providerMarket = providerSource === 'DATA912' ? input.providerMarket! : null;
      data.providerSymbol = providerSymbol;
      data.providerSource = providerSource;
      data.providerMarket = providerMarket;
      data.providerExchange = providerSymbol ? input.providerExchange?.trim() || null : null;

      if (providerSymbol && providerSource) {
        data.priceFactor = priceFactorFor(providerMarket);
        const rebind =
          providerSymbol !== existing.providerSymbol ||
          providerSource !== existing.providerSource ||
          providerMarket !== existing.providerMarket;
        if (rebind) {
          const provider = await fetchProviderData(providerSource, toRef(providerSymbol, providerMarket));
          data.currentPrice = provider.price;
          data.priceUpdatedAt = new Date();
          backfill = provider.closes;
        }
      } else {
        // Desvinculado: el factor vuelve a ser del usuario (un bono manual sigue cotizando cada 100 VN).
        data.priceFactor = input.priceFactor ?? existing.priceFactor;
      }
    } else if (input.priceFactor !== undefined && existing.providerSymbol === null) {
      // En un activo vinculado el factor lo manda el mercado: se ignora lo que llegue.
      data.priceFactor = input.priceFactor;
    }

    const investment = await prisma.investment.update({ where: { id: existing.id }, data });
    if (backfill) {
      await prisma.$transaction(replaceSnapshotsWithCloses(investment.id, backfill));
    }
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

// --- Precio histórico (autocompletar el formulario de compra/venta por fecha) ---

const priceAtQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
});

/**
 * Precio para una fecha pasada: prioriza los snapshots ya guardados (backfill
 * al vincular + cron diario); si no hay nada ahí y el activo está vinculado,
 * pide el histórico en vivo al proveedor y lo persiste para no repetirlo.
 * `notes`/`corp` (sin endpoint histórico) y los activos manuales sólo pueden
 * resolver contra lo que ya haya en la tabla.
 */
router.get(
  '/:id/price-at',
  asyncHandler(async (req, res) => {
    const { date } = priceAtQuerySchema.parse(req.query);
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const target = new Date(`${date}T00:00:00.000Z`);

    const snapshots = await prisma.investmentPriceSnapshot.findMany({
      where: { investmentId: existing.id },
      select: { price: true, date: true },
    });
    let match = closestPriceMatch(
      snapshots.map((s) => ({ date: s.date, price: s.price.toNumber() })),
      target,
    );

    if (!match && existing.providerSymbol && existing.providerSource) {
      const provider = getProvider(existing.providerSource as ProviderSource);
      if (provider.enabled) {
        const closes = await provider
          .fetchDailyCloses(toRef(existing.providerSymbol, existing.providerMarket))
          .catch((err) => {
            console.warn(`[investments] Falló el histórico en vivo para ${existing.providerSymbol}:`, err);
            return [] as DailyClose[];
          });
        if (closes.length > 0) {
          const existingDays = new Set(snapshots.map((s) => dayKey(s.date)));
          const toInsert = closes.filter((c) => !existingDays.has(dayKey(c.date)));
          if (toInsert.length > 0) {
            await prisma.investmentPriceSnapshot.createMany({
              data: toInsert.map((c) => ({ investmentId: existing.id, price: c.price, date: c.date })),
            });
          }
          match = closestPriceMatch(closes, target);
        }
      }
    }

    res.json({
      price: match ? match.price : null,
      date: match ? match.date.toISOString() : null,
      exact: match !== null && dayKey(match.date) === dayKey(target),
    });
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
    if (existing.providerSymbol) {
      throw new HttpError(
        400,
        `El precio de este activo se actualiza automáticamente desde ${providerLabel(existing.providerSource)}. Desvinculalo para cargarlo a mano.`,
      );
    }
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
