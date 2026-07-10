# 16 — Presupuestos: rollover y presupuesto total mensual

**Esfuerzo:** M · **Dependencias:** spec 04 (selector de mes) recomendado antes — el rollover se entiende navegando meses

## Contexto

- Presupuesto = límite fijo por categoría por mes calendario, sin memoria: lo no gastado (o el exceso) se evapora al cortar el mes (`budgets.ts:33-42`). Sin rollover, el presupuesto es decorativo para gastos irregulares (ropa, regalos).
- Solo existe presupuesto por categoría (`@@unique([userId, categoryId])`, `schema.prisma:213`); no hay techo global de gasto mensual.

## Alcance

### 1. Rollover opt-in por presupuesto

- Prisma: `Budget.rollover Boolean @default(false)`. Migración.
- Cálculo (server, `budgets.ts`): para presupuestos con rollover, `disponibleEfectivo(mes) = amount + carry(mesAnterior)`, donde `carry = disponibleEfectivo(anterior) − gastado(anterior)` (puede ser negativo: exceso descuenta). Calcular on-the-fly iterando desde `max(createdAt del budget, 12 meses atrás)` — cap de 12 meses para acotar el costo y el efecto de datos viejos. Sin persistencia de snapshots por mes (consistente con el resto de la app: todo derivado de transacciones).
- Respuesta del GET: agregar `effectiveLimit` y `carryOver` por budget. `percentUsed` pasa a calcularse sobre `effectiveLimit`.
- UI (`BudgetsPage`): toggle "Acumular sobrante" en el form; en la card con rollover, mostrar "Límite {amount} + arrastre {carryOver} = {effectiveLimit}" (o "− arrastre" si negativo).
- Alertas (`budgetAlerts.ts`): el umbral evalúa contra `effectiveLimit`.

### 2. Presupuesto total mensual

- Modelado: permitir `categoryId: null` = presupuesto global. El `@@unique([userId, categoryId])` de Postgres admite múltiples NULL → agregar índice único parcial vía migración SQL manual (`CREATE UNIQUE INDEX ... WHERE "categoryId" IS NULL`) para garantizar un solo global por usuario.
- `spent` del global = gasto total del mes (excluyendo `goalId ≠ null` si spec 08 ya está).
- UI: card destacada arriba de la grilla "Presupuesto total del mes" con su barra; alta desde el mismo form con opción "Todas las categorías".
- Alertas: mismo mecanismo `alertThreshold`/`lastAlertMonth`.

## Cambios concretos

- `apps/api/prisma/schema.prisma` + 2 migraciones (rollover; unique parcial con `categoryId` nullable).
- `apps/api/src/routes/budgets.ts` — carry, effectiveLimit, soporte global.
- `apps/api/src/services/budgetAlerts.ts` — evaluar contra effectiveLimit + presupuesto global.
- `packages/shared/src/types.ts` + `api.ts` — campos nuevos.
- `apps/web/src/pages/BudgetsPage.tsx` — toggle, card global, desglose de arrastre.

## Testing

Manual:
- Budget $100 con rollover, mes 1 gasta $60 → mes 2 muestra límite efectivo $140; mes 2 gasta $150 → mes 3 muestra $90.
- Sin rollover → comportamiento idéntico al actual.
- Activar rollover a mitad de año → arrastre solo desde meses con el flag (definir: el carry se computa desde que `rollover=true`; documentar en el toggle).
- Global $1000 + categorías: alertas independientes, la global salta por el total.
- Navegar meses (spec 04) → carry coherente hacia atrás.

## Fuera de alcance

- Períodos no mensuales (semanal, ciclo de tarjeta).
- Presupuesto de ingresos.
- Cap configurable del arrastre (siempre completo, 12 meses máx).
