import cron from 'node-cron';
import { config } from '../config';
import { startOfTodayUTC } from '../lib/dates';
import { prisma } from '../prisma';
import { sendEmail } from '../services/notifications';

/**
 * Job diario de resúmenes por email. Corre una vez al día y ramifica según la fecha:
 * - Lunes (UTC): resumen semanal (últimos 7 días) a usuarios con digestFrequency WEEKLY o BOTH.
 * - Día 1 (UTC): resumen mensual (mes anterior) a usuarios con digestFrequency MONTHLY o BOTH.
 *
 * El envío del resumen depende SOLO de digestFrequency, independiente de emailAlerts
 * (que gobierna las alertas de pagos/presupuestos). Se evita duplicar con
 * lastWeeklyDigestFor / lastMonthlyDigestFor.
 */

interface Period {
  start: Date;
  end: Date;
}

interface PeriodSummary {
  income: number;
  expense: number;
  net: number;
  prevExpense: number;
  topCategories: Array<{ name: string; total: number }>;
}

function money(n: number): string {
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function deltaPct(current: number, previous: number): number {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

async function buildPeriodSummary(userId: string, period: Period, prev: Period): Promise<PeriodSummary> {
  const [curTotals, prevTotals, byCategory] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, date: { gte: period.start, lt: period.end } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, date: { gte: prev.start, lt: prev.end } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', date: { gte: period.start, lt: period.end } },
      _sum: { amount: true },
    }),
  ]);

  const income = curTotals.find((t) => t.type === 'INCOME')?._sum.amount?.toNumber() ?? 0;
  const expense = curTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;
  const prevExpense = prevTotals.find((t) => t.type === 'EXPENSE')?._sum.amount?.toNumber() ?? 0;

  const catIds = byCategory.map((r) => r.categoryId).filter((id): id is string => id !== null);
  const categories = catIds.length ? await prisma.category.findMany({ where: { id: { in: catIds } } }) : [];
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const topCategories = byCategory
    .map((r) => ({
      name: r.categoryId ? catMap.get(r.categoryId) ?? 'Sin categoría' : 'Sin categoría',
      total: r._sum.amount?.toNumber() ?? 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return { income, expense, net: income - expense, prevExpense, topCategories };
}

function renderDigestHtml(name: string, periodLabel: string, s: PeriodSummary): string {
  const delta = deltaPct(s.expense, s.prevExpense);
  const deltaColor = delta > 0 ? '#dc2626' : '#16a34a';
  const deltaText =
    s.prevExpense > 0
      ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs. período anterior`
      : 'Sin período anterior para comparar';
  const netColor = s.net >= 0 ? '#16a34a' : '#dc2626';

  const catRows = s.topCategories.length
    ? s.topCategories
        .map(
          (c) =>
            `<tr><td style="padding:6px 0;color:#374151">${c.name}</td>` +
            `<td style="padding:6px 0;text-align:right;font-weight:600">${money(c.total)}</td></tr>`,
        )
        .join('')
    : '<tr><td style="padding:6px 0;color:#9ca3af" colspan="2">Sin gastos en el período.</td></tr>';

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827">
    <h2 style="margin:0 0 4px">Hola, ${name} 👋</h2>
    <p style="margin:0 0 20px;color:#6b7280">Tu resumen de ${periodLabel}.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:8px 0;color:#6b7280">Ingresos</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#16a34a">${money(s.income)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b7280">Gastos</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#dc2626">${money(s.expense)}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:8px 0;font-weight:600">Balance</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:${netColor}">${money(s.net)}</td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:${deltaColor};font-weight:600">${deltaText}</p>
    <h3 style="margin:0 0 8px;font-size:15px">Gastos por categoría</h3>
    <table style="width:100%;border-collapse:collapse">${catRows}</table>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">
      Recibís este email porque tenés activo el resumen periódico en MyFinance.
      Podés cambiarlo desde Ajustes.
    </p>
  </div>`;
}

export interface RunDigestsOptions {
  now?: Date;
  /** Ignora la fecha y el anti-duplicado; útil para pruebas manuales. No escribe los timestamps. */
  force?: boolean;
}

export async function runDigestsJob(options: RunDigestsOptions = {}): Promise<{ weekly: number; monthly: number }> {
  const now = options.now ?? startOfTodayUTC();
  const force = options.force ?? false;
  let weekly = 0;
  let monthly = 0;

  // --- Resumen semanal (lunes) ---
  if (force || now.getUTCDay() === 1) {
    const users = await prisma.user.findMany({ where: { digestFrequency: { in: ['WEEKLY', 'BOTH'] } } });
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const prevStart = new Date(now);
    prevStart.setUTCDate(prevStart.getUTCDate() - 14);
    for (const user of users) {
      if (!force && user.lastWeeklyDigestFor?.getTime() === now.getTime()) continue;
      const summary = await buildPeriodSummary(
        user.id,
        { start: weekStart, end: now },
        { start: prevStart, end: weekStart },
      );
      if (summary.income !== 0 || summary.expense !== 0) {
        await sendEmail(user.email, 'Tu resumen semanal — MyFinance', renderDigestHtml(user.name, 'los últimos 7 días', summary));
        weekly++;
      }
      if (!force) {
        await prisma.user.update({ where: { id: user.id }, data: { lastWeeklyDigestFor: now } });
      }
    }
  }

  // --- Resumen mensual (día 1) ---
  if (force || now.getUTCDate() === 1) {
    const users = await prisma.user.findMany({ where: { digestFrequency: { in: ['MONTHLY', 'BOTH'] } } });
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevPrevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const monthLabel = prevMonthStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (const user of users) {
      if (!force && user.lastMonthlyDigestFor?.getTime() === thisMonthStart.getTime()) continue;
      const summary = await buildPeriodSummary(
        user.id,
        { start: prevMonthStart, end: thisMonthStart },
        { start: prevPrevStart, end: prevMonthStart },
      );
      if (summary.income !== 0 || summary.expense !== 0) {
        await sendEmail(user.email, `Tu resumen de ${monthLabel} — MyFinance`, renderDigestHtml(user.name, monthLabel, summary));
        monthly++;
      }
      if (!force) {
        await prisma.user.update({ where: { id: user.id }, data: { lastMonthlyDigestFor: thisMonthStart } });
      }
    }
  }

  return { weekly, monthly };
}

export function scheduleDigestsJob(): void {
  cron.schedule(config.digestsCron, async () => {
    try {
      const result = await runDigestsJob();
      console.log(`[digests] weekly=${result.weekly} monthly=${result.monthly}`);
    } catch (err) {
      console.error('[digests] Error en job de resúmenes:', err);
    }
  });
  console.log(`[digests] Job programado: ${config.digestsCron}`);
}
