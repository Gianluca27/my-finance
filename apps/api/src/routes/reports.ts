import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { consolidateToBase, moneyLabel } from '../lib/currency';
import { currentMonth, isValidMonth, monthRange } from '../lib/dates';
import { getRateMap } from '../lib/exchangeRates';
import { transactionFilterSchema } from '../lib/transactionFilters';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Exporta transacciones a CSV (?from&to&type&categoryId&accountId, todos opcionales). */
router.get(
  '/transactions.csv',
  asyncHandler(async (req, res) => {
    const { from, to, type, categoryId, accountId } = transactionFilterSchema.parse(req.query);
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: req.auth!.userId,
        ...(type ? { type } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      include: { category: true, account: true },
      orderBy: { date: 'desc' },
    });

    // El CSV no excluye aportes/retiros de metas (a diferencia del dashboard y el PDF): tiene que
    // cuadrar con los movimientos reales de las cuentas. Se identifican con una columna aparte.
    // `cuenta` y `moneda` van al final (no entre categoria/nota) para no romper el import, que lee
    // las primeras 5 columnas por posición (ver lib/importCsv.ts). `moneda` es la moneda de la
    // cuenta del movimiento (spec 19: la transacción no tiene moneda propia — sin conversión; el
    // `entityAmount` de pagos cross-currency no se exporta porque su moneda es la de la
    // deuda/meta, que no viene en esta query).
    const header = 'fecha,tipo,monto,categoria,nota,meta,cuenta,moneda';
    const rows = transactions.map((tx) => {
      const metaTag = tx.goalId ? (tx.type === 'EXPENSE' ? 'aporte_meta' : 'retiro_meta') : '';
      return [
        tx.date.toISOString().slice(0, 10),
        tx.type === 'INCOME' ? 'ingreso' : 'gasto',
        tx.amount.toFixed(2),
        csvEscape(tx.category?.name ?? 'Sin categoría'),
        csvEscape(tx.note ?? ''),
        metaTag,
        csvEscape(tx.account.name),
        csvEscape(tx.account.currency),
      ].join(',');
    });
    const csv = '﻿' + [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transacciones.csv"');
    res.send(csv);
  }),
);

/**
 * Reporte mensual en PDF (?month=YYYY-MM, default mes actual).
 *
 * Multi-moneda (spec 19, fase C): los totales del resumen y los gastos por categoría se
 * consolidan a la moneda base del usuario al TC vigente y llevan "≈" cuando hubo conversión
 * (con desglose por moneda si hay más de una); cada transacción del listado se muestra en la
 * moneda de su cuenta, sin convertir. Las monedas sin cotización quedan fuera de los totales
 * consolidados y se anotan al pie del resumen.
 */
router.get(
  '/summary.pdf',
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' && isValidMonth(req.query.month)
      ? req.query.month
      : currentMonth();
    const { start, end } = monthRange(month);
    const userId = req.auth!.userId;

    const [user, transactions, rateMap] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      // Excluye aportes/retiros de metas: no son gasto/ingreso real (ver dashboard).
      prisma.transaction.findMany({
        where: { userId, date: { gte: start, lt: end }, goalId: null },
        include: { category: true, account: { select: { currency: true } } },
        orderBy: { date: 'asc' },
      }),
      getRateMap(userId),
    ]);
    const baseCurrency = user?.baseCurrency ?? 'ARS';

    // Nominales por moneda de cuenta (para el desglose) y consolidación a base.
    const incomeByCurrency = new Map<string, number>();
    const expenseByCurrency = new Map<string, number>();
    const byCategory = new Map<string, Map<string, number>>(); // categoría -> moneda -> nominal
    const addTo = (map: Map<string, number>, key: string, value: number) =>
      map.set(key, (map.get(key) ?? 0) + value);
    for (const tx of transactions) {
      const amount = tx.amount.toNumber();
      const currency = tx.account.currency;
      if (tx.type === 'INCOME') addTo(incomeByCurrency, currency, amount);
      else {
        addTo(expenseByCurrency, currency, amount);
        const name = tx.category?.name ?? 'Sin categoría';
        const catMap = byCategory.get(name) ?? new Map<string, number>();
        addTo(catMap, currency, amount);
        byCategory.set(name, catMap);
      }
    }
    const incomeC = consolidateToBase(incomeByCurrency, baseCurrency, rateMap);
    const expenseC = consolidateToBase(expenseByCurrency, baseCurrency, rateMap);
    const categoryTotals = Array.from(byCategory, ([name, amounts]) => ({
      name,
      totals: consolidateToBase(amounts, baseCurrency, rateMap),
    }));
    const converted = incomeC.converted || expenseC.converted;
    const approx = converted ? '≈ ' : '';
    const missingRates = Array.from(
      new Set([...incomeC.missingRates, ...expenseC.missingRates]),
    ).sort();
    const currencies = Array.from(
      new Set([...incomeByCurrency.keys(), ...expenseByCurrency.keys()]),
    ).sort();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${month}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(20).text('MyFinance — Reporte mensual', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#555').text(`Mes: ${month} · Usuario: ${user?.name ?? ''}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fillColor('#000').fontSize(14).text(converted ? `Resumen (en ${baseCurrency})` : 'Resumen');
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Ingresos: ${approx}${moneyLabel(incomeC.total, baseCurrency)}`);
    doc.text(`Gastos: ${approx}${moneyLabel(expenseC.total, baseCurrency)}`);
    doc.text(`Balance del mes: ${approx}${moneyLabel(incomeC.total - expenseC.total, baseCurrency)}`);
    if (currencies.length > 1) {
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor('#555');
      doc.text(`Detalle por moneda (montos originales, consolidados al TC vigente):`);
      for (const currency of currencies) {
        const inc = incomeByCurrency.get(currency) ?? 0;
        const exp = expenseByCurrency.get(currency) ?? 0;
        doc.text(`  ${currency}: ingresos ${moneyLabel(inc, currency)} · gastos ${moneyLabel(exp, currency)}`);
      }
      doc.fillColor('#000').fontSize(11);
    }
    if (missingRates.length > 0) {
      doc.moveDown(0.4);
      doc
        .fontSize(9)
        .fillColor('#b45309')
        .text(`Sin cotización para ${missingRates.join(', ')}: esos montos no entran en los totales consolidados.`)
        .fillColor('#000')
        .fontSize(11);
    }
    doc.moveDown(1);

    doc.fontSize(14).text('Gastos por categoría');
    doc.moveDown(0.5);
    doc.fontSize(11);
    if (categoryTotals.length === 0) {
      doc.fillColor('#777').text('Sin gastos registrados este mes.').fillColor('#000');
    } else {
      for (const { name, totals } of categoryTotals.sort((a, b) => b.totals.total - a.totals.total)) {
        const percent = expenseC.total > 0 ? Math.round((totals.total / expenseC.total) * 100) : 0;
        const prefix = totals.converted ? '≈ ' : '';
        doc.text(`${name}: ${prefix}${moneyLabel(totals.total, baseCurrency)} (${percent}%)`);
      }
    }
    doc.moveDown(1);

    doc.fontSize(14).text('Transacciones');
    doc.moveDown(0.5);
    doc.fontSize(9);
    if (transactions.length === 0) {
      doc.fillColor('#777').text('Sin transacciones este mes.').fillColor('#000');
    } else {
      for (const tx of transactions) {
        const sign = tx.type === 'INCOME' ? '+' : '−';
        const line = `${tx.date.toISOString().slice(0, 10)}  ${sign}${moneyLabel(tx.amount.toNumber(), tx.account.currency)}  ${tx.category?.name ?? 'Sin categoría'}${tx.note ? ` — ${tx.note}` : ''}`;
        doc.text(line);
      }
    }

    doc.end();
  }),
);

export default router;
