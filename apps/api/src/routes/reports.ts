import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { currentMonth, isValidMonth, monthRange } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Exporta transacciones a CSV (?from=YYYY-MM-DD&to=YYYY-MM-DD). */
router.get(
  '/transactions.csv',
  asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.parse(req.query);
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: req.auth!.userId,
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    const header = 'fecha,tipo,monto,categoria,nota';
    const rows = transactions.map((tx) =>
      [
        tx.date.toISOString().slice(0, 10),
        tx.type === 'INCOME' ? 'ingreso' : 'gasto',
        tx.amount.toFixed(2),
        csvEscape(tx.category?.name ?? 'Sin categoría'),
        csvEscape(tx.note ?? ''),
      ].join(','),
    );
    const csv = '﻿' + [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transacciones.csv"');
    res.send(csv);
  }),
);

/** Reporte mensual en PDF (?month=YYYY-MM, default mes actual). */
router.get(
  '/summary.pdf',
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' && isValidMonth(req.query.month)
      ? req.query.month
      : currentMonth();
    const { start, end } = monthRange(month);
    const userId = req.auth!.userId;

    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.transaction.findMany({
        where: { userId, date: { gte: start, lt: end } },
        include: { category: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    let income = 0;
    let expense = 0;
    const byCategory = new Map<string, number>();
    for (const tx of transactions) {
      const amount = tx.amount.toNumber();
      if (tx.type === 'INCOME') income += amount;
      else {
        expense += amount;
        const name = tx.category?.name ?? 'Sin categoría';
        byCategory.set(name, (byCategory.get(name) ?? 0) + amount);
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${month}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(20).text('MyFinance — Reporte mensual', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#555').text(`Mes: ${month} · Usuario: ${user?.name ?? ''}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fillColor('#000').fontSize(14).text('Resumen');
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Ingresos: $${income.toFixed(2)}`);
    doc.text(`Gastos: $${expense.toFixed(2)}`);
    doc.text(`Balance del mes: $${(income - expense).toFixed(2)}`);
    doc.moveDown(1);

    doc.fontSize(14).text('Gastos por categoría');
    doc.moveDown(0.5);
    doc.fontSize(11);
    if (byCategory.size === 0) {
      doc.fillColor('#777').text('Sin gastos registrados este mes.').fillColor('#000');
    } else {
      for (const [name, total] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
        const percent = expense > 0 ? Math.round((total / expense) * 100) : 0;
        doc.text(`${name}: $${total.toFixed(2)} (${percent}%)`);
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
        const line = `${tx.date.toISOString().slice(0, 10)}  ${sign}$${tx.amount.toFixed(2)}  ${tx.category?.name ?? 'Sin categoría'}${tx.note ? ` — ${tx.note}` : ''}`;
        doc.text(line);
      }
    }

    doc.end();
  }),
);

export default router;
