import cron from 'node-cron';
import { config } from '../config';
import { prisma } from '../prisma';
import {
  DOLAR_CURRENCIES,
  data912Enabled,
  fetchDolar,
  fetchOfficialUsdRate,
  getProvider,
  refKey,
  twelveDataEnabled,
  type ProviderMarket,
  type ProviderSource,
  type SymbolRef,
} from '../services/providers';

/**
 * Job diario de precios (post-cierre de Wall Street; BYMA ya cerró hace horas):
 * 1. Actualiza el precio de los activos vinculados no archivados, agrupados por
 *    proveedor, y deja un snapshot por día para el histórico.
 * 2. Actualiza el dólar OFICIAL (Twelve Data) y el MEP/CCL (data912).
 *
 * Cada bloque va en su propio try/catch: si un proveedor se cae, el otro igual
 * actualiza lo suyo.
 */

export interface PricesJobResult {
  /** Activos actualizados por proveedor. */
  updated: Record<ProviderSource, number>;
  usdRate: boolean;
  mep: number | null;
  ccl: number | null;
}

const KNOWN_SOURCES: ProviderSource[] = ['TWELVE_DATA', 'DATA912'];

function isKnownSource(value: string | null): value is ProviderSource {
  return value !== null && (KNOWN_SOURCES as string[]).includes(value);
}

/** Datos mínimos de un activo vinculado para pedirle el precio a su proveedor. */
interface LinkedInvestment {
  id: string;
  providerSymbol: string | null;
  providerSource: string | null;
  providerMarket: string | null;
}

/** Resultado del refresh acotado a un usuario (reusa la lógica del cron). */
export interface RefreshResult {
  /** Activos con precio actualizado en esta corrida. */
  updated: number;
  usdRate: boolean;
  mep: number | null;
  ccl: number | null;
}

/**
 * Actualiza el precio de una lista de activos vinculados (agrupados por proveedor)
 * y deja un snapshot por día. Devuelve cuántos se actualizaron por proveedor.
 * Cada proveedor va en su propio try/catch: si uno se cae, el otro igual actualiza.
 */
async function updateInvestmentPrices(
  investments: LinkedInvestment[],
  now: Date,
): Promise<Record<ProviderSource, number>> {
  const updated: Record<ProviderSource, number> = { TWELVE_DATA: 0, DATA912: 0 };
  const bySource = new Map<ProviderSource, LinkedInvestment[]>();
  for (const inv of investments) {
    if (!isKnownSource(inv.providerSource)) {
      console.warn(`[prices] Activo ${inv.id} con providerSource desconocido: ${inv.providerSource}`);
      continue;
    }
    const list = bySource.get(inv.providerSource) ?? [];
    list.push(inv);
    bySource.set(inv.providerSource, list);
  }

  for (const [source, group] of bySource) {
    const provider = getProvider(source);
    if (!provider.enabled) continue;
    try {
      const refs: SymbolRef[] = group.map((inv) => ({
        symbol: inv.providerSymbol!,
        market: inv.providerMarket as ProviderMarket | null,
      }));
      const prices = await provider.fetchPrices(refs);
      for (const inv of group) {
        const price = prices.get(
          refKey({ symbol: inv.providerSymbol!, market: inv.providerMarket as ProviderMarket | null }),
        );
        if (price === undefined) continue;
        await prisma.investment.update({
          where: { id: inv.id },
          data: { currentPrice: price, priceUpdatedAt: now },
        });
        await upsertDailySnapshot(inv.id, price, now);
        updated[source]++;
      }
    } catch (err) {
      console.error(`[prices] Error actualizando precios de ${source}:`, err);
    }
  }
  return updated;
}

export async function runPricesJob(): Promise<PricesJobResult> {
  const result: PricesJobResult = {
    updated: { TWELVE_DATA: 0, DATA912: 0 },
    usdRate: false,
    mep: null,
    ccl: null,
  };
  if (!twelveDataEnabled && !data912Enabled) return result;

  const investments = await prisma.investment.findMany({
    where: { providerSymbol: { not: null }, archivedAt: null },
    select: { id: true, providerSymbol: true, providerSource: true, providerMarket: true },
  });

  const now = new Date();
  result.updated = await updateInvestmentPrices(investments, now);

  if (twelveDataEnabled) {
    try {
      const usdRate = await fetchOfficialUsdRate();
      if (usdRate !== null) {
        await upsertRateForAllUsers('USD', usdRate);
        result.usdRate = true;
      }
    } catch (err) {
      console.error('[prices] Error actualizando el dólar oficial:', err);
    }
  }

  if (data912Enabled) {
    try {
      const { mep, ccl } = await fetchDolar();
      if (mep !== null) await upsertRateForAllUsers(DOLAR_CURRENCIES.mep, mep);
      if (ccl !== null) await upsertRateForAllUsers(DOLAR_CURRENCIES.ccl, ccl);
      result.mep = mep;
      result.ccl = ccl;
    } catch (err) {
      console.error('[prices] Error actualizando el dólar MEP/CCL:', err);
    }
  }

  return result;
}

/**
 * Refresh on-demand acotado a un usuario: misma lógica que el cron pero solo
 * sobre sus activos vinculados y sus cotizaciones. El rate-limit vive en la ruta.
 */
export async function refreshPricesForUser(userId: string): Promise<RefreshResult> {
  const result: RefreshResult = { updated: 0, usdRate: false, mep: null, ccl: null };
  if (!twelveDataEnabled && !data912Enabled) return result;

  const investments = await prisma.investment.findMany({
    where: { userId, providerSymbol: { not: null }, archivedAt: null },
    select: { id: true, providerSymbol: true, providerSource: true, providerMarket: true },
  });

  const now = new Date();
  const counts = await updateInvestmentPrices(investments, now);
  result.updated = counts.TWELVE_DATA + counts.DATA912;

  if (twelveDataEnabled) {
    try {
      const usdRate = await fetchOfficialUsdRate();
      if (usdRate !== null) {
        await upsertRateForUser(userId, 'USD', usdRate);
        result.usdRate = true;
      }
    } catch (err) {
      console.error('[prices] Error actualizando el dólar oficial:', err);
    }
  }

  if (data912Enabled) {
    try {
      const { mep, ccl } = await fetchDolar();
      if (mep !== null) await upsertRateForUser(userId, DOLAR_CURRENCIES.mep, mep);
      if (ccl !== null) await upsertRateForUser(userId, DOLAR_CURRENCIES.ccl, ccl);
      result.mep = mep;
      result.ccl = ccl;
    } catch (err) {
      console.error('[prices] Error actualizando el dólar MEP/CCL:', err);
    }
  }

  return result;
}

/** Upsert de una cotización automática para un usuario. */
async function upsertRateForUser(userId: string, currency: string, rate: number): Promise<void> {
  await prisma.exchangeRate.upsert({
    where: { userId_currency: { userId, currency } },
    update: { rate },
    create: { userId, currency, rate },
  });
}

/** Las cotizaciones automáticas son las mismas para todos: se replican por usuario. */
async function upsertRateForAllUsers(currency: string, rate: number): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    await upsertRateForUser(user.id, currency, rate);
  }
}

/** Un snapshot por día calendario (UTC): si ya hay uno de hoy, lo pisa. */
export async function upsertDailySnapshot(investmentId: string, price: number, date: Date): Promise<void> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const existing = await prisma.investmentPriceSnapshot.findFirst({
    where: { investmentId, date: { gte: dayStart, lt: dayEnd } },
  });
  if (existing) {
    await prisma.investmentPriceSnapshot.update({ where: { id: existing.id }, data: { price, date } });
  } else {
    await prisma.investmentPriceSnapshot.create({ data: { investmentId, price, date } });
  }
}

export function schedulePricesJob(): void {
  if (!twelveDataEnabled && !data912Enabled) return;
  cron.schedule(config.pricesCron, async () => {
    try {
      const r = await runPricesJob();
      console.log(
        `[prices] td=${r.updated.TWELVE_DATA} d912=${r.updated.DATA912} ` +
          `usd=${r.usdRate ? 'ok' : '—'} mep=${r.mep ?? '—'} ccl=${r.ccl ?? '—'}`,
      );
    } catch (err) {
      console.error('[prices] Error en job de precios:', err);
    }
  });
  console.log(`[prices] Job programado: ${config.pricesCron}`);
}
