import { z } from 'zod';

/**
 * Filtros comunes a listado y export de transacciones: rango de fecha, tipo, categoría y cuenta.
 * Compartido entre `routes/transactions.ts` (que le suma búsqueda y paginación) y
 * `routes/reports.ts` (export CSV), para que ambos acepten exactamente los mismos filtros.
 *
 * `to` es inclusivo a nivel DÍA: "2026-07-28" cubre el 28 completo. Sin esta normalización,
 * el `lte` de las rutas cortaría en la medianoche del día y dejaría afuera las transacciones
 * con hora intra-día (las genera el server: aportes/retiros de meta y los pagos sin fecha
 * explícita usan `new Date()`), desalineando el listado y el CSV de los totales derivados —
 * en particular el drill-down del ciclo de tarjeta (spec 20), que filtra con `to` = día de
 * cierre y debe mostrar exactamente las filas que suma `cardCycleSpent`. Un `to` con hora
 * explícita (no es solo fecha) se respeta tal cual.
 */
export const transactionFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z
    .preprocess(
      (value) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value,
      z.coerce.date(),
    )
    .optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
});

export type TransactionFilterInput = z.infer<typeof transactionFilterSchema>;
