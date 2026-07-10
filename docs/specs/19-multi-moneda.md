# 19 — Multi-moneda

**Esfuerzo:** L/XL · **Dependencias:** hacer al final del roadmap corto — toca casi todos los agregados. Requiere 12 (cuentas) y conviene 16 (presupuestos) ya estables.

## Contexto

La limitación transversal más grande: `Account`, `Debt`, `Goal` y `Budget` no tienen `currency`; `formatMoney` hardcodea ARS (`apps/web/src/api.ts:44-51`); el PDF hardcodea `$` (`reports.ts:102-128`). Solo Inversiones maneja monedas (con `ExchangeRate` USD/USDMEP/USDCCL mantenidos por cron). Para el usuario argentino típico — cuenta en pesos + cuenta/colchón en dólares, deudas en USD — hoy la app obliga a elegir una moneda y mentir en la otra.

Principio de diseño: **la moneda vive en la cuenta**. Una transacción está en la moneda de su cuenta (sin campo propio). La app consolida a una **moneda base por usuario** usando los `ExchangeRate` existentes, con el patrón `missingRates` que Inversiones ya estableció.

## Alcance por fases (cada una deployable)

### Fase A — cuentas y consolidación

- Prisma: `Account.currency String @default("ARS")` (migración backfill trivial); `User.baseCurrency String @default("ARS")`.
- Preferencias: selector de moneda base. Alta/edición de cuenta: selector de moneda (**inmutable con transacciones existentes** — regla dura, evita reinterpretar historial).
- Agregados (`dashboard.ts`: balance, ingresos/gastos, netWorthTrend, safe-to-spend; `accounts.ts`: balances): agrupar por moneda de cuenta y convertir a base con el rate elegido (usar `USDMEP` como default de conversión USD↔ARS para flujo personal — decisión a confirmar; hacerla constante nombrada). Monedas sin rate → excluir + `missingRates` (patrón de `buildInvestmentsSummary`).
- Web: `formatMoney(amount, currency)` — refactor mecánico de todos los call sites; cards de cuenta muestran su moneda; totales consolidados muestran "≈" y la base.
- Transferencias entre cuentas de distinta moneda: pedir el monto en **ambas** puntas (`amountFrom`/`amountTo` — el TC implícito queda registrado); misma moneda: comportamiento actual.

### Fase B — deudas y metas

- `Debt.currency`, `Goal.currency` (default base). Pagos/aportes: la transacción va en la moneda de la cuenta elegida; si difiere de la moneda de la entidad, convertir con rate del día para descontar del saldo (guardar el monto convertido en el payload del pago — evita que el saldo de la deuda flote con el TC).
- Dashboard `debtsSummary`: consolidar a base.

### Fase C — presupuestos y reportes

- Presupuestos: siempre en moneda base; el `spent` convierte gastos de cuentas no-base al rate del día de la transacción (documentar la aproximación: rate actual si no hay histórico).
- CSV: columna `moneda`. PDF: símbolo según moneda/base.

## Cambios concretos (resumen)

- Migraciones: `Account.currency`, `User.baseCurrency`, luego `Debt`/`Goal`.
- `apps/api`: dashboard, accounts, transfers, debts, goals, budgets, reports — conversión centralizada en un helper `convertToBase(amount, currency, rates)` en `lib/`.
- `packages/shared`: `currency` en tipos; firmas de transferencia cross-currency.
- `apps/web` + `apps/mobile`: formatMoney con moneda, selectores, badges de moneda.

## Testing

- Unit: `convertToBase` (con/sin rate, misma moneda).
- Manual por fase: cuenta USD con movimientos → dashboard consolida con MEP y lo indica; sin rate cargado → banner missingRates, totales excluyen y lo dicen; transferencia ARS→USD registra ambos montos y los balances cierran en cada moneda; deuda USD pagada desde cuenta ARS descuenta el equivalente correcto y el saldo no cambia si el TC se mueve después.

## Fuera de alcance

- Historial de tipos de cambio para conversión a fecha exacta (mejora natural: snapshot diario de rates — ver nota en spec 14).
- Monedas más allá de ARS/USD como first-class en UI (el modelo las soporta por string; UI ofrece ARS/USD primero).
- Ganancia/pérdida por diferencia de cambio como concepto contable.
