import cron from 'node-cron';
import { config } from '../config';
import { sumInBase } from '../lib/currency';
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
 *
 * Multi-moneda (spec 19, fase C): igual que el dashboard y el PDF, los totales se agrupan
 * por moneda de cuenta y se consolidan a la moneda base del usuario al TC vigente; "≈"
 * cuando hubo conversión y nota al pie con las monedas sin cotización (excluidas).
 */

interface Period {
  start: Date;
  end: Date;
}

/** Moneda base + cotizaciones + moneda por cuenta: contexto para consolidar los totales. */
interface CurrencyContext {
  baseCurrency: string;
  rateMap: Map<string, number>;
  currencyOf: (accountId: string) => string;
}

interface PeriodSummary {
  income: number;
  expense: number;
  net: number;
  prevExpense: number;
  topCategories: Array<{ name: string; total: number }>;
  /** true si algún monto entró convertido desde otra moneda (el email muestra "≈"). */
  converted: boolean;
  /** Monedas sin cotización cargada: sus montos quedan fuera de los totales. */
  missingRates: string[];
  /** true si el período tuvo movimientos (aunque los totales consolidados den 0). */
  hasActivity: boolean;
}

async function currencyContext(userId: string, baseCurrency: string): Promise<CurrencyContext> {
  const [accounts, rates] = await Promise.all([
    prisma.account.findMany({ where: { userId }, select: { id: true, currency: true } }),
    prisma.exchangeRate.findMany({ where: { userId } }),
  ]);
  const byAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  return {
    baseCurrency,
    rateMap: new Map(rates.map((r) => [r.currency, r.rate.toNumber()])),
    currencyOf: (accountId) => byAccount.get(accountId) ?? 'ARS',
  };
}

/** Como `moneyLabel` (lib/currency.ts) pero con separadores de miles es-AR, el formato
 * histórico de estos emails. */
function money(n: number, currency: string): string {
  const value = n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'ARS') return `$${value}`;
  if (currency === 'USD') return `US$${value}`;
  return `${currency} ${value}`;
}

function deltaPct(current: number, previous: number): number {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

async function buildPeriodSummary(
  userId: string,
  period: Period,
  prev: Period,
  ctx: CurrencyContext,
): Promise<PeriodSummary> {
  // Excluye aportes/retiros de metas (goalId): no son gasto/ingreso real, mismo criterio que el
  // dashboard — si no, el resumen por email queda inconsistente con lo que se ve en la app.
  // Agrupado por cuenta para consolidar cada moneda a base (antes sumaba nominales de monedas
  // distintas como si fueran una sola).
  const [curTotals, prevTotals, byCategory] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type', 'accountId'],
      where: { userId, date: { gte: period.start, lt: period.end }, goalId: null },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['type', 'accountId'],
      where: { userId, date: { gte: prev.start, lt: prev.end }, goalId: null },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId', 'accountId'],
      where: { userId, type: 'EXPENSE', date: { gte: period.start, lt: period.end }, goalId: null },
      _sum: { amount: true },
    }),
  ]);

  const rowsFor = (rows: typeof curTotals, type: 'INCOME' | 'EXPENSE') =>
    rows
      .filter((r) => r.type === type)
      .map((r) => ({ currency: ctx.currencyOf(r.accountId), amount: r._sum.amount?.toNumber() ?? 0 }));
  const incomeC = sumInBase(rowsFor(curTotals, 'INCOME'), ctx.baseCurrency, ctx.rateMap);
  const expenseC = sumInBase(rowsFor(curTotals, 'EXPENSE'), ctx.baseCurrency, ctx.rateMap);
  const prevExpenseC = sumInBase(rowsFor(prevTotals, 'EXPENSE'), ctx.baseCurrency, ctx.rateMap);

  const missing = new Set([...incomeC.missingRates, ...expenseC.missingRates, ...prevExpenseC.missingRates]);
  let converted = incomeC.converted || expenseC.converted || prevExpenseC.converted;

  // Gasto por categoría, consolidado por fila (categoría, cuenta) — misma unión de
  // faltantes/conversiones que los totales.
  const catRows = new Map<string | null, Array<{ currency: string; amount: number }>>();
  for (const r of byCategory) {
    const list = catRows.get(r.categoryId) ?? [];
    list.push({ currency: ctx.currencyOf(r.accountId), amount: r._sum.amount?.toNumber() ?? 0 });
    catRows.set(r.categoryId, list);
  }
  const catIds = [...catRows.keys()].filter((id): id is string => id !== null);
  const categories = catIds.length ? await prisma.category.findMany({ where: { id: { in: catIds } } }) : [];
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const topCategories = Array.from(catRows, ([categoryId, rows]) => {
    const totals = sumInBase(rows, ctx.baseCurrency, ctx.rateMap);
    for (const c of totals.missingRates) missing.add(c);
    converted = converted || totals.converted;
    return {
      name: categoryId ? catMap.get(categoryId) ?? 'Sin categoría' : 'Sin categoría',
      total: totals.total,
    };
  })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    income: incomeC.total,
    expense: expenseC.total,
    net: incomeC.total - expenseC.total,
    prevExpense: prevExpenseC.total,
    topCategories,
    converted,
    missingRates: Array.from(missing).sort(),
    hasActivity: curTotals.length > 0,
  };
}

function renderDigestHtml(name: string, periodLabel: string, s: PeriodSummary, baseCurrency: string): string {
  const delta = deltaPct(s.expense, s.prevExpense);
  const deltaColor = delta > 0 ? '#dc2626' : '#16a34a';
  const deltaText =
    s.prevExpense > 0
      ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs. período anterior`
      : 'Sin período anterior para comparar';
  const netColor = s.net >= 0 ? '#16a34a' : '#dc2626';
  // "≈" cuando algún monto entró convertido desde otra moneda (mismo criterio que la web).
  const approx = s.converted ? '≈ ' : '';

  const catRows = s.topCategories.length
    ? s.topCategories
        .map(
          (c) =>
            `<tr><td style="padding:6px 0;color:#374151">${c.name}</td>` +
            `<td style="padding:6px 0;text-align:right;font-weight:600">${approx}${money(c.total, baseCurrency)}</td></tr>`,
        )
        .join('')
    : '<tr><td style="padding:6px 0;color:#9ca3af" colspan="2">Sin gastos en el período.</td></tr>';

  const missingNote = s.missingRates.length
    ? `<p style="margin:0 0 16px;color:#b45309;font-size:12px">Sin cotización para ${s.missingRates.join(', ')}: esos montos no entran en los totales consolidados.</p>`
    : '';

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827">
    <h2 style="margin:0 0 4px">Hola, ${name} 👋</h2>
    <p style="margin:0 0 20px;color:#6b7280">Tu resumen de ${periodLabel}.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:8px 0;color:#6b7280">Ingresos</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#16a34a">${approx}${money(s.income, baseCurrency)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b7280">Gastos</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#dc2626">${approx}${money(s.expense, baseCurrency)}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:8px 0;font-weight:600">Balance</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:${netColor}">${approx}${money(s.net, baseCurrency)}</td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:${deltaColor};font-weight:600">${deltaText}</p>
    ${missingNote}
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
      const ctx = await currencyContext(user.id, user.baseCurrency);
      const summary = await buildPeriodSummary(
        user.id,
        { start: weekStart, end: now },
        { start: prevStart, end: weekStart },
        ctx,
      );
      // hasActivity y no los totales: un período cuyos movimientos quedaron todos en monedas
      // sin cotización consolida a 0 pero merece el email (con la nota de faltantes).
      if (summary.hasActivity) {
        await sendEmail(
          user.email,
          'Tu resumen semanal — MyFinance',
          renderDigestHtml(user.name, 'los últimos 7 días', summary, ctx.baseCurrency),
        );
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
      const ctx = await currencyContext(user.id, user.baseCurrency);
      const summary = await buildPeriodSummary(
        user.id,
        { start: prevMonthStart, end: thisMonthStart },
        { start: prevPrevStart, end: prevMonthStart },
        ctx,
      );
      if (summary.hasActivity) {
        await sendEmail(
          user.email,
          `Tu resumen de ${monthLabel} — MyFinance`,
          renderDigestHtml(user.name, monthLabel, summary, ctx.baseCurrency),
        );
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
