import { Prisma } from '@prisma/client';

/**
 * Convierte recursivamente los Prisma.Decimal a number y las fechas a ISO string,
 * para que la API devuelva JSON plano consistente con los tipos de @myfinance/shared.
 */
export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serialize(val);
    }
    return out;
  }
  return value;
}
