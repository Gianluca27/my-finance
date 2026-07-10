# 14 — Inversiones: curva del portafolio, rendimiento anualizado y refresh de precios

**Esfuerzo:** M/L · **Dependencias:** ninguna (mejor después de la fase de calidad de datos)

## Contexto

- Solo hay gráfico de precio **por activo** (`DetailBody`, `InvestmentsPage.tsx:1240-1303`); no existe curva de valor total del portafolio, aunque los snapshots diarios por activo ya se persisten (cron `upsertDailySnapshot`, `prices.ts:133-144`).
- El PnL% es cociente simple valor/invertido−1 (`lib/investments.ts:73-95`) — sin ponderar tiempo. Con las fechas de operaciones ya registradas se puede calcular TIR.
- El precio de activos vinculados solo se actualiza con el cron diario (22:30 UTC); no hay refresh on-demand.

## Alcance

### 1. Curva de valor del portafolio

- API: `GET /api/investments/portfolio-history?months=12` (default 12, máx 24). Para cada día con snapshots: `Σ activo (tenencia a esa fecha × precio snapshot / priceFactor)`, con tenencia derivada de las operaciones hasta esa fecha (reusar `computePosition` con corte temporal). Conversión a moneda base con el TC **actual** — limitación documentada: no hay historial de TC (ver Fuera de alcance). Monedas sin TC se excluyen y se reporta `missingRates` (patrón existente).
- Rellenar días sin snapshot con el último precio conocido (forward-fill) para que la curva no serruche por huecos de `notes`/`corp`.
- UI: card al tope de Inversiones con la curva (mismo estilo SVG del gráfico de patrimonio del dashboard), rango 3/6/12 meses, y marca del total invertido acumulado como línea de referencia.

### 2. TIR anualizada (money-weighted)

- `lib/investments.ts`: función pura `xirr(flows: {date, amount}[])` (Newton-Raphson con bisección de respaldo, tolerancia 1e-6, null si no converge o si hay <2 flujos o <30 días de rango). Flujos: compras negativas, ventas positivas, valor actual como flujo final positivo.
- Calcular por activo (en su moneda) y para el portafolio (flujos convertidos a base). Exponer en el detalle del activo y en las hero cards ("TIR anualizada").
- **Tests unitarios Vitest** — es función pura, entra en la suite existente (`lib/investments.test.ts`): casos con TIR conocida, no-convergencia, venta total.

### 3. Refresh de precios on-demand

- API: `POST /api/investments/refresh-prices` — corre la lógica del cron acotada al usuario (extraer de `jobs/prices.ts` una función `refreshPricesForUser(userId)` reutilizada por ambos). Rate-limit: máx 1 cada 5 min por usuario (en memoria), respuesta 429 con `retryAfter` si se excede — protege los 8 créditos/min de Twelve Data.
- UI: botón "Actualizar precios" junto a las hero cards, spinner, "Actualizado hace {x}" con el timestamp del snapshot más reciente.

## Cambios concretos

- `apps/api/src/lib/investments.ts` — `xirr`, tenencia con corte temporal (+ tests).
- `apps/api/src/routes/investments.ts` — portfolio-history, refresh-prices.
- `apps/api/src/jobs/prices.ts` — extraer `refreshPricesForUser`.
- `packages/shared/src/types.ts` + `api.ts` — `PortfolioHistory`, `refreshPrices`, TIR en tipos de detalle/summary.
- `apps/web/src/pages/InvestmentsPage.tsx` — card curva, TIR en cards/detalle, botón refresh.

## Testing

- Unit: `xirr` (casos conocidos), tenencia a fecha con compras/ventas intercaladas.
- Manual: portafolio con 2 activos en monedas distintas → curva consistente con `totalValue` actual en el último punto; refresh → precios cambian sin esperar cron; segundo refresh inmediato → 429 manejado en UI.

## Fuera de alcance

- Historial de tipos de cambio (guardar snapshot diario de `ExchangeRate` habilitaría curva multi-moneda exacta — anotar como continuación natural; el cron ya corre a diario).
- TWR (time-weighted return) — TIR alcanza para uso personal.
- Dividendos/cupones en los flujos de TIR (se suman cuando exista spec 15; diseñar `xirr` para recibirlos).
- Benchmark (comparar contra MERVAL/S&P).
