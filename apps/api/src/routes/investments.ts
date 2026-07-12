import type { Investment, InvestmentOperation, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  buildInvestmentsSummary,
  closestPriceMatch,
  computePosition,
  firstRentaWithoutHolding,
  investmentMetrics,
  operationCashAmount,
  positionAsOf,
  PRICE_HISTORY_RANGES,
  priceHistoryCutoff,
  xirr,
  type CashFlow,
  type PositionOp,
  type PriceHistoryRange,
} from '../lib/investments';
import { resolveAccountId } from '../lib/accounts';
import { refreshPricesForUser, upsertDailySnapshot } from '../jobs/prices';
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

/** Compra o venta: cantidad de unidades × precio unitario. */
const tradeOpSchema = z.object({
  type: z.enum(['COMPRA', 'VENTA']),
  quantity: z.number().positive().max(999_999_999_999),
  unitPrice: z.number().positive().max(999_999_999_999),
  date: z.coerce.date().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Renta cobrada (dividendo/cupón/amortización): monto total, sin mover la tenencia. */
const rentaOpSchema = z.object({
  type: z.literal('RENTA'),
  amount: z.number().positive().max(999_999_999_999),
  date: z.coerce.date().optional(),
  note: z.string().max(500).nullable().optional(),
  /// true acredita además un INCOME en movimientos (default: no, desacopla inversiones del flujo de caja).
  credit: z.boolean().optional(),
  /// Cuenta destino del INCOME cuando credit=true. Default: cuenta por defecto del usuario.
  accountId: z.string().nullable().optional(),
});

const operationSchema = z.discriminatedUnion('type', [tradeOpSchema, rentaOpSchema]);
type OperationInput = z.infer<typeof operationSchema>;

/**
 * Campos que persiste la DB para una operación. La RENTA no mueve tenencia: se
 * guarda con quantity 0 y el monto total cobrado en unitPrice (ver schema.prisma).
 */
function opStorageFields(input: OperationInput): { type: OperationInput['type']; quantity: number; unitPrice: number } {
  if (input.type === 'RENTA') return { type: 'RENTA', quantity: 0, unitPrice: input.amount };
  return { type: input.type, quantity: input.quantity, unitPrice: input.unitPrice };
}

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

const MS_PER_DAY = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * TIR anualizada del activo, en %: compras negativas, ventas y rentas positivas
 * y el valor actual como flujo final positivo. Los importes van en espacio
 * monetario (compras/ventas divididas por el factor; la renta ya es efectivo
 * real). Null si no hay señal.
 */
function assetTir(ops: DatedOp[], priceFactor: number, currentValue: number, now: Date): number | null {
  const flows: CashFlow[] = ops.map((op) => ({ date: op.date, amount: operationCashAmount(op, priceFactor) }));
  if (currentValue > 0) flows.push({ date: now, amount: currentValue });
  const rate = xirr(flows);
  return rate === null ? null : round2(rate * 100);
}

/** Activo serializado + métricas derivadas del ledger (incl. TIR), en su moneda. */
function toInvestmentJson(investment: Investment, ops: DatedOp[]) {
  const metrics = investmentMetrics(investment.currentPrice?.toNumber() ?? null, ops, investment.priceFactor);
  return {
    ...(serialize(investment) as Record<string, unknown>),
    ...metrics,
    tir: assetTir(ops, investment.priceFactor, metrics.currentValue, new Date()),
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

/** Cotizaciones vigentes del usuario. Liviano: lo usan los modales de pago/aporte
 * cross-currency (deudas/metas, spec 19 fase B) para previsualizar la conversión
 * sin traer el portafolio completo de GET /api/investments. */
router.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const rates = await prisma.exchangeRate.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { currency: 'asc' },
    });
    res.json(serialize(rates));
  }),
);

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

    // TIR del portafolio: flujos de todos los activos incluidos, convertidos a base,
    // con el valor total actual como flujo final. Excluye monedas sin cotización.
    const now = new Date();
    const portfolioFlows: CashFlow[] = [];
    for (const { investment } of items) {
      if (investment.archivedAt !== null) continue;
      const rate = investment.currency === null ? 1 : rateMap.get(investment.currency);
      if (rate === undefined) continue;
      for (const op of toDatedOps(opsByInvestment.get(investment.id) ?? [])) {
        // La renta suma como flujo positivo a su fecha (igual que en assetTir).
        portfolioFlows.push({ date: op.date, amount: operationCashAmount(op, investment.priceFactor) * rate });
      }
    }
    if (summary.totalValue > 0) portfolioFlows.push({ date: now, amount: summary.totalValue });
    const portfolioTir = xirr(portfolioFlows);

    res.json({
      items: items.map(({ json }) => json),
      rates: serialize(rates),
      summary: { ...summary, tir: portfolioTir === null ? null : round2(portfolioTir * 100) },
      providers: providerAvailability(),
    });
  }),
);

// --- Curva de valor del portafolio (antes de '/:id' para no matchear como id) ---

const historyQuerySchema = z.object({
  months: z.coerce.number().int().optional(),
});

/**
 * Curva de valor total del portafolio en moneda base. Un punto por día con
 * snapshots (union entre activos); para cada día se valúa cada activo con la
 * tenencia a esa fecha (corte temporal) y su último precio conocido (forward-fill,
 * para que huecos de notes/corp no serruchen la curva). Conversión con el TC
 * vigente (no hay historial de TC); monedas sin cotización se excluyen.
 */
router.get(
  '/portfolio-history',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { months: rawMonths } = historyQuerySchema.parse(req.query);
    const months = Math.min(24, Math.max(1, rawMonths ?? 12));

    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    from.setUTCMonth(from.getUTCMonth() - months);

    const [investments, allOps, snapshots, rates] = await Promise.all([
      prisma.investment.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, currency: true, priceFactor: true },
      }),
      prisma.investmentOperation.findMany({
        where: { userId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.investmentPriceSnapshot.findMany({
        where: { investment: { userId, archivedAt: null } },
        orderBy: { date: 'asc' },
        select: { investmentId: true, price: true, date: true },
      }),
      prisma.exchangeRate.findMany({ where: { userId } }),
    ]);

    const rateMap = new Map(rates.map((r) => [r.currency, r.rate.toNumber()]));

    // Activos incluidos: los que tienen cotización (o están en moneda base). El
    // resto queda fuera de la curva y su moneda se reporta en missingRates.
    const missing = new Set<string>();
    const included = investments.filter((inv) => {
      if (inv.currency === null || rateMap.has(inv.currency)) return true;
      missing.add(inv.currency);
      return false;
    });

    const rawByInv = new Map<string, InvestmentOperation[]>();
    for (const op of allOps) {
      const list = rawByInv.get(op.investmentId);
      if (list) list.push(op);
      else rawByInv.set(op.investmentId, [op]);
    }
    const opsByInv = new Map<string, DatedOp[]>();
    for (const [id, list] of rawByInv) opsByInv.set(id, toDatedOps(list));

    // Snapshots por activo, en orden cronológico (la query ya ordena por fecha).
    const snapsByInv = new Map<string, { t: number; price: number }[]>();
    for (const s of snapshots) {
      const list = snapsByInv.get(s.investmentId);
      const point = { t: s.date.getTime(), price: s.price.toNumber() };
      if (list) list.push(point);
      else snapsByInv.set(s.investmentId, [point]);
    }

    // Eje X: días con al menos un snapshot dentro del rango.
    const fromT = from.getTime();
    const nowT = now.getTime();
    const daySet = new Set<string>();
    for (const s of snapshots) {
      const t = s.date.getTime();
      if (t >= fromT && t <= nowT) daySet.add(dayKey(s.date));
    }
    const days = [...daySet].sort();

    // Puntero de forward-fill por activo: avanza a medida que crecen los días.
    const ffIndex = new Map<string, number>();
    const points = days.map((dayStr) => {
      const dayEnd = Date.parse(`${dayStr}T00:00:00.000Z`) + MS_PER_DAY - 1;
      const asOf = new Date(dayEnd);
      let value = 0;
      for (const inv of included) {
        const snaps = snapsByInv.get(inv.id);
        if (!snaps) continue;
        let idx = ffIndex.get(inv.id) ?? -1;
        while (idx + 1 < snaps.length && snaps[idx + 1].t <= dayEnd) idx++;
        ffIndex.set(inv.id, idx);
        if (idx < 0) continue; // todavía no hay precio conocido a esta fecha
        const pos = positionAsOf(opsByInv.get(inv.id) ?? [], asOf);
        const qty = pos?.quantity ?? 0;
        if (qty <= 0) continue;
        const factor = inv.priceFactor > 0 ? inv.priceFactor : 1;
        const rate = inv.currency === null ? 1 : rateMap.get(inv.currency)!;
        value += ((qty * snaps[idx].price) / factor) * rate;
      }
      return { date: dayStr, value: round2(value) };
    });

    // Línea de referencia: costo invertido acumulado actual, en moneda base.
    let invested = 0;
    for (const inv of included) {
      const pos = computePosition(opsByInv.get(inv.id) ?? []);
      if (!pos || pos.quantity <= 0) continue;
      const factor = inv.priceFactor > 0 ? inv.priceFactor : 1;
      const rate = inv.currency === null ? 1 : rateMap.get(inv.currency)!;
      invested += (pos.investedCost / factor) * rate;
    }

    res.json({ points, invested: round2(invested), missingRates: [...missing].sort() });
  }),
);

// --- Refresh de precios on-demand ---

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
/**
 * Última corrida de refresh por usuario (memoria del proceso). Acota el gasto de
 * créditos de Twelve Data a 1 corrida cada 5 min. El mapa crece a lo sumo un
 * entry por usuario activo (escala personal): no necesita limpieza.
 */
const lastRefreshByUser = new Map<string, number>();

function formatRetry(seconds: number): string {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
}

/**
 * Corre la lógica del cron de precios acotada al usuario. Rate-limit en memoria:
 * máx. 1 cada 5 min; si se excede, 429 con `retryAfter` (segundos) para proteger
 * los créditos de Twelve Data.
 */
router.post(
  '/refresh-prices',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const now = Date.now();
    const last = lastRefreshByUser.get(userId);
    if (last !== undefined && now - last < REFRESH_COOLDOWN_MS) {
      const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - (now - last)) / 1000);
      res.status(429).json({
        error: `Ya actualizaste los precios hace poco. Volvé a intentar en ${formatRetry(retryAfter)}.`,
        retryAfter,
      });
      return;
    }
    lastRefreshByUser.set(userId, now);

    const result = await refreshPricesForUser(userId);
    const latest = await prisma.investment.findFirst({
      where: { userId, priceUpdatedAt: { not: null } },
      orderBy: { priceUpdatedAt: 'desc' },
      select: { priceUpdatedAt: true },
    });
    res.json({
      updated: result.updated,
      lastUpdatedAt: latest?.priceUpdatedAt ? latest.priceUpdatedAt.toISOString() : null,
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

const priceHistoryQuerySchema = z.object({
  range: z.enum(PRICE_HISTORY_RANGES as [PriceHistoryRange, ...PriceHistoryRange[]]),
});

/** Histórico de precios de un activo acotado a un rango (para el gráfico de detalle). */
router.get(
  '/:id/price-history',
  asyncHandler(async (req, res) => {
    const investment = await findOwned(req.auth!.userId, req.params.id);
    const { range } = priceHistoryQuerySchema.parse(req.query);
    const cutoff = priceHistoryCutoff(range, new Date());
    const snapshots = await prisma.investmentPriceSnapshot.findMany({
      where: { investmentId: investment.id, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    });
    res.json(serialize(snapshots.map((s) => ({ id: s.id, price: s.price, date: s.date }))));
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
async function resolveHistoricalMatch(
  existing: Investment,
  target: Date,
): Promise<{ price: number; date: Date } | null> {
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

  return match;
}

/**
 * Precio automático para una operación de compra/venta en un activo vinculado a
 * proveedor: si la fecha es hoy usa `currentPrice` (más fresco que el snapshot
 * diario), si es pasada resuelve contra el histórico. `null` si no hay dato
 * disponible (p. ej. notes/corp sin OHLC todavía) — en ese caso el precio se
 * carga a mano, el servidor no lo fuerza.
 */
async function resolveAutoOperationPrice(existing: Investment, opDate: Date): Promise<number | null> {
  if (!existing.providerSymbol) return null;
  if (dayKey(opDate) === dayKey(new Date())) {
    return existing.currentPrice ? existing.currentPrice.toNumber() : null;
  }
  const match = await resolveHistoricalMatch(existing, opDate);
  return match ? match.price : null;
}

router.get(
  '/:id/price-at',
  asyncHandler(async (req, res) => {
    const { date } = priceAtQuerySchema.parse(req.query);
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const target = new Date(`${date}T00:00:00.000Z`);
    const match = await resolveHistoricalMatch(existing, target);

    res.json({
      price: match ? match.price : null,
      date: match ? match.date.toISOString() : null,
      exact: match !== null && dayKey(match.date) === dayKey(target),
    });
  }),
);

// --- Operaciones ---

/**
 * Valida una operación (nueva o editada) contra la secuencia completa: ninguna
 * venta puede exceder la tenencia a su fecha, y una RENTA exige tenencia > 0 a la
 * suya (no se cobra renta de lo que no se tiene). `others` son las operaciones sin
 * la que se está creando/editando; `createdAt` desempata el orden a igual fecha.
 */
function assertOperationValid(input: OperationInput, opDate: Date, others: DatedOp[], createdAt: Date): void {
  const stored = opStorageFields(input);
  const candidate = sortOps([
    ...others,
    { type: stored.type, quantity: stored.quantity, unitPrice: stored.unitPrice, date: opDate, createdAt },
  ]);
  if (computePosition(candidate) === null) {
    throw new HttpError(400, 'La venta supera la tenencia disponible a esa fecha.');
  }
  if (input.type === 'RENTA') {
    const pos = positionAsOf(candidate, opDate);
    if (!pos || pos.quantity <= 0) {
      throw new HttpError(400, 'No tenés tenencia de este activo a esa fecha: no se puede registrar renta.');
    }
  }
  // El cambio no puede dejar huérfana ninguna renta previa (p. ej. mover la única
  // compra a una fecha posterior a una renta, o cargar una venta que anule la tenencia).
  assertNoOrphanRenta(candidate);
}

/**
 * Revalida la secuencia completa: ninguna RENTA puede quedar sin tenencia a su
 * fecha. `computePosition` ignora la RENTA, así que este chequeo es el único que
 * atrapa una renta huérfana dejada por editar o borrar OTRA operación.
 */
function assertNoOrphanRenta(ops: DatedOp[]): void {
  const orphan = firstRentaWithoutHolding(ops);
  if (orphan) {
    throw new HttpError(
      400,
      `El cambio dejaría la renta del ${dayKey(orphan.date)} sin tenencia del activo a esa fecha.`,
    );
  }
}

router.post(
  '/:id/operations',
  asyncHandler(async (req, res) => {
    const input = operationSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const userId = req.auth!.userId;

    const now = new Date();
    const opDate = input.date ?? now;
    const ops = toDatedOps(await fetchOps(existing.id));
    assertOperationValid(input, opDate, ops, now);

    const stored = opStorageFields(input);
    // Activo vinculado a proveedor: el precio de compra/venta lo resuelve el
    // servidor, nunca confía en el que mande el cliente (mismo criterio que
    // priceFactor). Si no hay precio automático para esa fecha, se acepta el
    // que cargó el usuario a mano.
    if (stored.type !== 'RENTA') {
      const autoPrice = await resolveAutoOperationPrice(existing, opDate);
      if (autoPrice !== null) stored.unitPrice = autoPrice;
    }
    // Acreditar la renta como INCOME en una cuenta (opcional, default off). Sin
    // categoría: `checkBudgetAlert` sólo mira gastos con categoría, así que nunca dispara alerta.
    const credit =
      input.type === 'RENTA' && input.credit
        ? { accountId: await resolveAccountId(userId, input.accountId), amount: input.amount }
        : null;

    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.investmentOperation.create({
        data: {
          type: stored.type,
          quantity: stored.quantity,
          unitPrice: stored.unitPrice,
          date: opDate,
          note: input.note ?? null,
          investmentId: existing.id,
          userId,
        },
      }),
    ];
    if (credit) {
      writes.push(
        prisma.transaction.create({
          data: {
            type: 'INCOME',
            amount: credit.amount,
            date: opDate,
            note: `Renta: ${existing.name}`,
            accountId: credit.accountId,
            userId,
          },
        }),
      );
    }
    await prisma.$transaction(writes);
    res.status(201).json(await buildDetail(existing));
  }),
);

router.put(
  '/:id/operations/:operationId',
  asyncHandler(async (req, res) => {
    const input = operationSchema.parse(req.body);
    const existing = await findOwned(req.auth!.userId, req.params.id);
    const operation = await prisma.investmentOperation.findFirst({
      where: { id: req.params.operationId, investmentId: existing.id },
    });
    if (!operation) throw new HttpError(404, 'Operación no encontrada');

    const opDate = input.date ?? operation.date;
    const ops = await fetchOps(existing.id);
    const others = toDatedOps(ops.filter((op) => op.id !== operation.id));
    // Revalida la secuencia completa con el cambio aplicado (createdAt intacto para el desempate).
    assertOperationValid(input, opDate, others, operation.createdAt);

    const stored = opStorageFields(input);
    // Ídem alta: el servidor resuelve el precio si el activo está vinculado y hay dato.
    if (stored.type !== 'RENTA') {
      const autoPrice = await resolveAutoOperationPrice(existing, opDate);
      if (autoPrice !== null) stored.unitPrice = autoPrice;
    }
    // La edición no toca el INCOME que se hubiera acreditado al alta: no hay vínculo
    // persistido entre operación y movimiento (acreditar es una conveniencia del alta).
    await prisma.investmentOperation.update({
      where: { id: operation.id },
      data: {
        type: stored.type,
        quantity: stored.quantity,
        unitPrice: stored.unitPrice,
        date: opDate,
        note: input.note ?? null,
      },
    });
    res.json(await buildDetail(existing));
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
    const remaining = sortOps(toDatedOps(ops.filter((op) => op.id !== operation.id)));
    if (computePosition(remaining) === null) {
      throw new HttpError(400, 'No se puede eliminar: dejaría ventas sin tenencia suficiente.');
    }
    // Borrar la operación no puede dejar una renta previa sin tenencia (p. ej. eliminar la única compra).
    assertNoOrphanRenta(remaining);

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
    const investment = await prisma.investment.update({
      where: { id: existing.id },
      data: { currentPrice: price, priceUpdatedAt: now },
    });
    // Un punto por día calendario en el histórico: varias cargas el mismo día pisan el punto de hoy.
    await upsertDailySnapshot(investment.id, price, now);
    const ops = await fetchOps(investment.id);
    res.json(toInvestmentJson(investment, toDatedOps(ops)));
  }),
);

export default router;
