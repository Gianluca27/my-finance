# 08 — Metas: aportes que no ensucian reportes, retiros y cuenta de origen

**Esfuerzo:** M · **Dependencias:** ninguna · **Nota:** corrige distorsión de datos — prioridad dentro de su fase

## Contexto

Hoy cada aporte a meta crea una `Transaction` **EXPENSE sin categoría** en la cuenta default (`goals.ts:101-135`). Consecuencias:

- Infla el "gasto del mes" en dashboard y reportes, y deprime la tasa de ahorro — exactamente al revés de lo que es ahorrar.
- Aparece como "gasto sin categoría" en el donut y el CSV.
- No hay retiros: una meta no tiene vuelta atrás.
- No se puede elegir cuenta de origen.

Decisión de diseño: **mantener la transacción EXPENSE** (es correcto que el balance de la cuenta baje) pero **excluir las transacciones con `goalId` de todos los agregados de "gasto"** y mostrarlas como línea propia "Ahorro en metas". Es el cambio de menor invasividad que corrige la semántica (la alternativa — nuevo tipo de transacción — toca el enum en toda la app).

## Alcance

### 1. Exclusión en agregados (API)

Auditar cada agregación de gasto y agregar `goalId: null` al filtro:

- `dashboard.ts` — ingreso/gasto del mes, gasto por categoría, comparación 6 meses (SQL crudo — revisar la query), proyección, comparación vs mes anterior, anomalías, safe-to-spend.
- `budgets.ts` — `spent` por categoría (los aportes no tienen categoría hoy, pero blindar igual).
- `reports.ts` — resumen PDF; en el CSV **no excluir**: agregar columna/tipo visible `aporte_meta` para que el export siga siendo completo.
- `dashboard` suma nueva: `goalContributions` del mes, para mostrar "Ahorro en metas" como línea propia y que la tasa de ahorro lo cuente como ahorro, no gasto.

### 2. Retiros

- `POST /api/goals/:id/withdrawals` — body `{ amount, accountId?, note? }`. Crea `Transaction` **INCOME** con `goalId` (también excluida de agregados de ingreso — mismo criterio). Valida `amount ≤ saved`. Si tras el retiro `saved < targetAmount`, limpiar `achievedAt`.
- UI: botón "Retirar" en la card de meta (visible si `saved > 0`), modal con monto y cuenta destino.

### 3. Cuenta de origen en aportes

`POST /:id/contributions` acepta `accountId?` (default: cuenta default, comportamiento actual). Selector en el modal de aporte.

## Cambios concretos

- `apps/api/src/routes/goals.ts` — withdrawals, accountId en contributions, recálculo de `achievedAt`.
- `apps/api/src/routes/dashboard.ts`, `budgets.ts`, `reports.ts` — filtros `goalId: null` + campo `goalContributions`.
- `packages/shared/src/types.ts` + `api.ts` — `withdrawFromGoal`, `accountId` en contribute, `goalContributions` en `DashboardData`.
- `apps/web/src/pages/GoalsPage.tsx` — modal retiro + selector de cuenta.
- `apps/web/src/pages/DashboardPage.tsx` — línea "Ahorro en metas" (en la card de KPIs o junto a tasa de ahorro).

## Testing

Manual:
- Aportar $100 → gasto del mes NO sube, tasa de ahorro NO baja, balance de la cuenta sí baja $100, dashboard muestra "Ahorro en metas $100".
- Retirar $50 → `saved` baja, ingreso del mes no sube, balance de cuenta sube.
- Retiro que deja la meta bajo el objetivo → vuelve de "lograda" a activa.
- Retiro > saved → 400.
- CSV: los aportes aparecen identificados, el total del CSV cuadra con los movimientos reales de las cuentas.
- Datos históricos: aportes viejos (EXPENSE con `goalId` ya seteado) quedan automáticamente excluidos — verificar que el gasto histórico de meses con aportes baja de forma coherente tras el deploy. **Comunicar este cambio de números.**

## Fuera de alcance

- Vincular meta a cuenta dedicada / reservar saldo.
- Aportes automáticos o recurrentes hacia una meta.
- Proyección inversa ("a este ritmo llegás en {fecha}") — mejora de UI menor, puede colarse si sobra tiempo.
