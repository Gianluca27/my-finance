import { z } from 'zod';

/**
 * Filtros comunes a listado y export de transacciones: rango de fecha, tipo, categoría y cuenta.
 * Compartido entre `routes/transactions.ts` (que le suma búsqueda y paginación) y
 * `routes/reports.ts` (export CSV), para que ambos acepten exactamente los mismos filtros.
 */
export const transactionFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
});

export type TransactionFilterInput = z.infer<typeof transactionFilterSchema>;
