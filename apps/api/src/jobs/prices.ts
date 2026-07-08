import cron from 'node-cron';
import { config } from '../config';
import { prisma } from '../prisma';
import { fetchPrices, twelveDataEnabled } from '../services/twelveData';

/**
 * Job diario de precios (post-cierre de Wall Street):
 * 1. Actualiza el precio de todos los activos vinculados a Twelve Data que no
 *    estén archivados (deduplicando símbolos entre usuarios) y deja un
 *    snapshot por día para el histórico.
 * 2. Actualiza la cotización del dólar OFICIAL (par configurable) para todos
 *    los usuarios.
 */
export async function runPricesJob(): Promise<{ updated: number; usdRate: boolean }> {
  if (!twelveDataEnabled) return { updated: 0, usdRate: false };

  const investments = await prisma.investment.findMany({
    where: { providerSymbol: { not: null }, archivedAt: null },
    select: { id: true, providerSymbol: true },
  });
  const symbols = investments.map((inv) => inv.providerSymbol!);

  const prices = await fetchPrices([...symbols, config.twelveDataUsdPair]);
  const now = new Date();
  let updated = 0;

  for (const inv of investments) {
    const price = prices.get(inv.providerSymbol!);
    if (price === undefined) continue;
    await prisma.investment.update({
      where: { id: inv.id },
      data: { currentPrice: price, priceUpdatedAt: now },
    });
    await upsertDailySnapshot(inv.id, price, now);
    updated++;
  }

  const usdRate = prices.get(config.twelveDataUsdPair);
  if (usdRate !== undefined) {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await prisma.exchangeRate.upsert({
        where: { userId_currency: { userId: user.id, currency: 'USD' } },
        update: { rate: usdRate },
        create: { userId: user.id, currency: 'USD', rate: usdRate },
      });
    }
  }

  return { updated, usdRate: usdRate !== undefined };
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
  if (!twelveDataEnabled) return;
  cron.schedule(config.pricesCron, async () => {
    try {
      const result = await runPricesJob();
      console.log(`[prices] updated=${result.updated} usdRate=${result.usdRate}`);
    } catch (err) {
      console.error('[prices] Error en job de precios:', err);
    }
  });
  console.log(`[prices] Job programado: ${config.pricesCron}`);
}
