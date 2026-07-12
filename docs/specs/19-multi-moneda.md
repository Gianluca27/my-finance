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

### Deuda registrada al implementar la fase A

- **Mobile sin paridad multi-moneda (spec 18):** solo se adaptó al nuevo shape de
  `GET /api/accounts` (`{ items, netWorth }` en vez de array) para que compile y no
  rompa. Sigue formateando todo como ARS, suma el patrimonio nominal entre monedas,
  no ofrece selector de moneda en cuentas/preferencias y su formulario de
  transferencia no pide `amountTo` (la API rechaza con 400 y mensaje claro las
  transferencias entre cuentas de distinta moneda creadas desde mobile).
- **Agregados del dashboard que siguen en nominales (fases B/C):** gastos por
  categoría (dona), comparativa de 6 meses, insights (comparación vs mes anterior,
  anomalías), "Ahorro en metas", deudas y presupuestos. Solo balance,
  ingresos/gastos del mes, netWorthTrend y safe-to-spend consolidan a moneda base.
  Para usuarios multi-moneda la dona puede no cuadrar exactamente con el total de
  gastos consolidado. *(Actualización fase B: "Ahorro en metas" y el resumen de
  deudas ya consolidan a moneda base; quedan dona, comparativas, insights y
  presupuestos para la fase C.)* *(Actualización fase C: cerrado — dona,
  comparativa de 6 meses, insights/anomalías y presupuestos consolidan a moneda
  base al TC vigente y reportan en `currency.missingRates`; la dona vuelve a
  cuadrar con el total de gastos consolidado.)*
- **Gastos recurrentes sin moneda propia:** el "safe-to-spend" asume los fijos
  comprometidos en moneda base. *(Actualización fase C: deja de ser deuda y pasa a
  ser regla documentada — los montos de recurrentes son nominales que se
  INTERPRETAN en la moneda base, igual que los presupuestos: al cambiar la base no
  se convierten. Darles moneda propia queda fuera de alcance de la spec.)*
- **Inversiones no cambia:** sus totales siguen convirtiendo con la fila `USD`
  (oficial) hacia el pivote ARS, independiente de `User.baseCurrency`. El flujo
  personal (cuentas/dashboard) usa `USDMEP` con fallback al oficial
  (`PERSONAL_USD_RATE` en `apps/api/src/lib/currency.ts`).

### Deuda registrada al implementar la fase B

- **Mobile sin paridad multi-moneda en deudas/metas:** compila y opera contra la
  nueva API pero sigue formateando todo como ARS aunque la entidad tenga
  `currency` USD, no ofrece selector de moneda al crear/editar deudas o metas
  (las altas nuevas heredan la moneda base del usuario vía el default de la API)
  y sus formularios de pago/aporte/retiro no muestran la conversión: el monto
  ingresado se registra en la moneda de la cuenta usada (la por defecto en
  pagos de deuda) y la API lo convierte al TC del día o rechaza con 400 si falta
  cotización. El prellenado y la validación local del monto usan
  `remainingBalance`/`saved` (moneda de la entidad) aunque la cuenta esté en
  otra moneda, y los totales del dashboard/resúmenes se muestran sin "≈" ni
  aviso de `missingRates`.
- **Recordatorios de deudas con "$" fijo:** el copy de email/push
  (`debtReminderContent`) prefija `$` sin distinguir la moneda de la deuda; una
  deuda USD avisa "restan $500". Estructuralmente no cambió nada (los montos ya
  están en la moneda de la deuda), falta solo el símbolo/código. *(Actualización
  fase C: cerrado — `moneyLabel` en `lib/currency.ts` pone el símbolo según la
  moneda de la deuda; mismo helper para alertas de presupuesto y PDF.)*
- **Presupuestos y `spent` en nominales (fase C):** un pago de deuda EXPENSE
  desde una cuenta no-base sigue contando su monto nominal contra el
  presupuesto de la categoría, igual que cualquier gasto (los presupuestos aún
  no tienen moneda). *(Actualización fase C: cerrado — el `spent` consolida por
  moneda de cuenta a la base al TC vigente, ver sección de fase C.)*
- **La dona de gastos y las comparativas siguen en nominales (fase C):** los
  pagos de deuda cross-currency entran a esos agregados por el monto de la
  transacción (moneda de la cuenta), no por el convertido. *(Actualización
  fase C: cerrado — esos agregados consolidan a base por moneda de cuenta; el
  monto que entra sigue siendo el de la transacción convertido al TC vigente,
  no el `entityAmount`, coherente con que son agregados de flujo de caja.)*

### Deuda registrada al implementar la fase C

- **Mobile sin paridad multi-moneda en presupuestos/dashboard:** compila y opera
  sin cambios (los campos nuevos de `BudgetStatus` — `baseCurrency`, `converted`,
  `missingRates` — son aditivos y los ignora). Sigue formateando todo como ARS
  aunque la moneda base sea otra, no muestra "≈" en gastado/dona/comparativa/
  insights ni banner de cotizaciones faltantes (si falta un rate, el gastado
  simplemente excluye esos gastos sin avisar), y su formulario de presupuesto no
  indica la moneda base. Reportes mobile (CSV/PDF/import) usan los mismos
  endpoints que web, así que la columna `moneda` y el PDF multi-moneda llegan
  gratis; el copy de la pantalla no explica la regla de import (la moneda es la
  de la cuenta destino).
- **Decisiones documentadas de la fase C** (no son deuda, son la regla):
  - Presupuestos SIEMPRE en moneda base, sin columna `Budget.currency`. El
    `spent` (y el arrastre del rollover, mes a mes) convierte los gastos de
    cuentas no-base al **TC vigente** — no hay historial de rates (fuera de
    alcance; ver spec 14) — y excluye+reporta monedas sin cotización por
    presupuesto. Las alertas de umbral evalúan ese mismo `spent` consolidado.
  - Al cambiar `User.baseCurrency` los montos de presupuestos y recurrentes NO
    se convierten (son nominales del usuario): pasan a interpretarse en la base
    nueva. Preferencias lo advierte.
  - Import CSV: las filas quedan en la cuenta elegida y por lo tanto en SU
    moneda; el monto se toma tal cual, sin conversión (columna `moneda` del
    export ignorada, como `meta`/`cuenta`).
  - CSV: `moneda` = moneda de la cuenta del movimiento, sin conversión. No se
    exporta el `entityAmount` de pagos cross-currency (su moneda es la de la
    deuda/meta y complicaría el formato).
  - PDF: resumen y categorías consolidados a base con "≈" y desglose por moneda
    cuando hay más de una; el listado de transacciones muestra cada monto en la
    moneda de su cuenta (`moneyLabel`).
