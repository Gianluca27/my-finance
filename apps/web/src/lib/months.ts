/**
 * Mes actual en formato YYYY-MM, en UTC: la API define "mes actual" con getters
 * UTC (`currentMonth()` en apps/api/src/lib/dates.ts), así que el cliente usa la
 * misma vara. Con hora local, en UTC-3 las últimas ~3 h de cada mes el picker
 * seguiría tratando al mes viejo como "actual" (mostrando las cards de estado
 * presente y bloqueando avanzar) cuando el server ya pasó al siguiente.
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Etiqueta en español del mes, ej: "junio 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Rango `from`/`to` (YYYY-MM-DD, UTC) de un mes "YYYY-MM" — para armar links de
 * drill-down hacia `/transacciones` que filtren por el mes visible del dashboard
 * o de presupuestos. Mismo criterio UTC que el chip "Este mes" de TransactionsPage
 * (`monthRangeUTC`), así los movimientos que aparecen coinciden con los del widget.
 */
export function monthDateRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const toParam = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: toParam(new Date(Date.UTC(y, m - 1, 1))),
    to: toParam(new Date(Date.UTC(y, m, 0))),
  };
}
