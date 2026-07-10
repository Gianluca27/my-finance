# 10 — Movimientos: selección múltiple, duplicar y reglas retroactivas

**Esfuerzo:** M · **Dependencias:** conviene después de 05 (filtros ya en URL simplifican "seleccionar lo filtrado")

## Contexto

- No hay selección múltiple ni acciones en lote: corregir 30 gastos mal categorizados = 30 ediciones en modal.
- No hay "duplicar": gastos repetidos no recurrentes (nafta, super) se cargan de cero cada vez.
- Crear una regla de categorización no toca el historial (`loadRules`/`matchRule` corren solo al crear/importar, `transactions.ts:82-87, 297-298`): las transacciones viejas sin categoría quedan huérfanas para siempre.

## Alcance

### 1. Acciones en lote

- API: `POST /api/transactions/bulk` — body `{ ids: string[] (max 100), action: 'delete' | 'setCategory', categoryId? }`. Verifica que **todos** los ids pertenezcan al usuario (una query `count` con `userId` + `id in`; si no coincide, 404 sin ejecutar nada — todo o nada). Para `setCategory`, valida la categoría con `assertCategoryOwned` y que su tipo coincida con el de cada transacción (rechazar mezcla INCOME/EXPENSE con categoría de un solo tipo → 400 con detalle).
- UI: checkbox por fila + "seleccionar página"; barra flotante al haber selección: "N seleccionados — Recategorizar · Eliminar". Eliminar con confirm que indique la cantidad. Recategorizar abre un select de categoría (filtrado por tipo si la selección es homogénea).

### 2. Duplicar transacción

Solo frontend: botón por fila que abre `AddTransactionModal` en modo alta precargado con los datos de la fila y **fecha = hoy**. Sin cambios de API.

### 3. Aplicación retroactiva de reglas

- API: `POST /api/rules/apply` — body `{ dryRun?: boolean }`. Recorre transacciones del usuario **sin categoría**, aplica `matchRule` (reusar `lib/categoryRules.ts`), y: con `dryRun` devuelve `{ total, byRule: [{keyword, count}] }` sin escribir; sin dryRun ejecuta los updates y devuelve el conteo aplicado. Solo toca sin-categoría — nunca pisa una categoría asignada (manual o previa).
- UI (`CategoriesPage`, sección reglas): botón "Aplicar reglas a movimientos sin categoría" → llama dryRun, muestra "Se categorizarían N movimientos" → confirmar ejecuta. Invalidar cachés de transactions/dashboard/budgets.

## Cambios concretos

- `apps/api/src/routes/transactions.ts` — endpoint bulk.
- `apps/api/src/routes/rules.ts` — endpoint apply.
- `packages/shared/src/types.ts` + `api.ts` — `bulkTransactions`, `applyRules`.
- `apps/web/src/pages/TransactionsPage.tsx` — selección + barra + duplicar.
- `apps/web/src/pages/CategoriesPage.tsx` — botón aplicar con preview.

## Testing

Manual:
- Seleccionar 3 y recategorizar → las 3 cambian, dashboard/presupuestos reflejan (caché invalidada).
- Lote con un id ajeno (forzar por API) → 404 y ninguna modificada.
- Eliminar lote → confirm con cantidad correcta; totales de cuenta recalculan.
- Duplicar → modal precargado, fecha hoy, editar antes de guardar funciona.
- Regla "spotify" + 5 movimientos viejos sin categoría que la contienen → dryRun dice 5, aplicar categoriza 5, ninguno con categoría previa fue tocado.

## Fuera de alcance

- "Seleccionar todos los que matchean el filtro" cross-página (solo página visible por ahora).
- Edición masiva de otros campos (fecha, cuenta, nota).
- Deshacer lote (los borrados son definitivos, como el borrado individual actual).
