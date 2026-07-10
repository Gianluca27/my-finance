# 15 — Inversiones: dividendos/cupones y edición de operaciones

**Esfuerzo:** M/L · **Dependencias:** spec 14 recomendado antes (para que la TIR incorpore la renta desde el diseño)

## Contexto

- El enum de operación solo tiene `COMPRA`/`VENTA` (`operationSchema`, `investments.ts:86-92`). No hay forma de registrar dividendos, cupones ni amortizaciones — el retorno real de bonos (foco fuerte de la app: data912, priceFactor per-100) y acciones con dividendo queda subestimado.
- Las operaciones se pueden crear y borrar pero no editar (`investments.ts:561-579`): un error de tipeo = borrar y recrear.

## Alcance

### 1. Operación de renta

- Prisma: extender enum `OperationType` con `RENTA` (cubre dividendo, cupón y amortización con un solo tipo + nota; evita sobre-modelar). Para `RENTA`: `quantity` no aplica (guardar 0 o null según constraint), `price` almacena el **monto total cobrado**. Alternativa evaluada y descartada: campos separados `amount` — reusar `price` con semántica documentada evita migración más invasiva; revisar en implementación cuál queda más limpio con los constraints actuales.
- API: `operationSchema` acepta `type: 'RENTA'` con `{ amount, date, note? }`; validar `amount > 0` y que exista tenencia > 0 a esa fecha (no cobrás renta de lo que no tenés).
- Métricas (`lib/investments.ts`): separar `pnlPrice` (actual) de `incomeCollected` (Σ RENTA); `pnlTotal = pnlPrice + incomeCollected`. `avgCost` y tenencia no cambian con RENTA. La TIR (spec 14) suma cada RENTA como flujo positivo en su fecha.
- UI: en el detalle del activo, botón "Registrar renta" (label contextual: "Dividendo" para acciones/CEDEARs/ETF, "Cupón" para bonos); historial mixto con las RENTA diferenciadas visualmente; card del activo muestra "Renta cobrada" cuando > 0.
- Opcional dentro del alcance: checkbox "acreditar en cuenta" que crea una `Transaction` INCOME vinculable a cuenta elegida — default apagado (mantiene inversiones y flujo de caja desacoplados como hoy).

### 2. Edición de operaciones

- API: `PUT /api/investments/:id/operations/:operationId`. Revalidar la secuencia completa tras el cambio (misma validación que el DELETE actual: ninguna venta puede exceder tenencia disponible a su fecha, `investments.ts:536-544`); si la edición rompe la secuencia → 400 con detalle.
- UI: lápiz en cada fila del historial → modal precargado (mismo form del alta de operación).

## Cambios concretos

- `apps/api/prisma/schema.prisma` + migración (enum).
- `apps/api/src/routes/investments.ts` — RENTA en schema/validaciones, PUT de operación.
- `apps/api/src/lib/investments.ts` — `incomeCollected`, `pnlTotal`, RENTA en flujos de TIR (+ tests: renta no altera tenencia/avgCost, pnlTotal correcto, edición que invalida ventas posteriores).
- `packages/shared/src/types.ts` + `api.ts` — tipos y métodos.
- `apps/web/src/pages/InvestmentsPage.tsx` — alta/edición de renta, historial, métricas.

## Testing

- Unit: los casos de `lib/investments` listados arriba.
- Manual: bono con 2 cupones cobrados → PnL total = precio + cupones, TIR mayor que sin cupones; editar una compra bajando cantidad con venta posterior que quedaría en descubierto → 400; RENTA con "acreditar en cuenta" → aparece el INCOME en movimientos.

## Fuera de alcance

- Detección automática de fechas de pago de cupones (calendario de bonos).
- Retención de impuestos sobre dividendos.
- Split/contrasplit de acciones.
