import { prisma } from '../prisma';

/**
 * Cotizaciones vigentes del usuario como mapa `currency -> rate` (ARS por unidad),
 * la forma que consumen `convertToBase`/`convertPaymentAmount` (lib/currency.ts).
 */
export async function getRateMap(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.exchangeRate.findMany({ where: { userId } });
  return new Map(rows.map((r) => [r.currency, r.rate.toNumber()]));
}
