# 06 — Dashboard: comparativa por categoría y correcciones

**Esfuerzo:** S · **Dependencias:** ninguna

## Contexto

Cuatro problemas puntuales, todos con los datos ya disponibles en la respuesta del endpoint:

1. `previousMonthComparison.byCategory` se calcula alineado por día (`dashboard.ts:259-278`) y la UI lo descarta — solo consume `.total` (`DashboardPage.tsx:141`).
2. El badge "vs. mes anterior" está **debajo del Balance total** pero compara *gasto* alineado por día, no balance; colorea rojo/▲ al gastar más, sugiriendo que el balance cayó (`DashboardPage.tsx:141-167`). Semántica engañosa.
3. La card "Disponible" muestra `available` dos veces (`:240` y `:243`) y nunca expone `safeToSpend.committedExpenses`, que es justo lo que explica el número.
4. Loading: un texto único "Cargando resumen…" reemplaza toda la página (`:121`).

## Alcance

### 1. Widget "Qué cambió vs. mes anterior"

Card nueva con el top 5 de categorías por delta absoluto de `byCategory`: nombre, `current` vs `previous`, delta % con flecha y color (subió gasto = rojo). Estado vacío si `previousMonthComparison` es null. Ordenar por `|current − previous|` para que pesos chicos con % gigantes no dominen.

### 2. Corrección del badge de balance

Mover el badge a la KPI de **Gastos** con label explícito "vs. mismo día del mes pasado". Bajo el balance no va comparación (o, si se quiere conservar, comparar balance real contra el cierre del mes anterior usando `netWorthTrend`, que ya trae la serie).

### 3. Card "Disponible" explicativa

Estructura: `available` grande; debajo "Balance {balance} − Fijos por vencer {committedExpenses}". Los tres campos ya vienen en `safeToSpend` (`types.ts:314-321`).

### 4. Skeletons por card

Reemplazar el texto único por skeletons con el mismo layout de grilla (bloques grises animados por card). Con `error && !data`, mantener el banner actual.

### 5. Menores (mismo PR)

- Card Inversiones: mostrar también `pnl` absoluto junto al `pnlPercent` (ya viene en `investmentsSummary`).
- Anomalías: mostrar "gastaste {currentAmount} vs. promedio {avgAmount}" — ambos campos ya llegan (`dashboard.ts:301`).

## Cambios concretos

- `apps/web/src/pages/DashboardPage.tsx` — todo es frontend; cero cambios de API/shared.
- Nuevo componente `apps/web/src/components/Skeleton.tsx` (reutilizable por otras páginas después).

## Testing

Manual:
- Usuario con datos en ambos meses → widget por categoría coherente con el total ya mostrado.
- Primer mes de uso (`previousMonthComparison: null`) → card en estado vacío, badge ausente, sin crash.
- `committedExpenses` = 0 → card Disponible muestra "sin fijos pendientes".
- Recarga en frío → skeletons; con caché tibia (SWR 30 s) → datos instantáneos sin flash de skeleton.

## Fuera de alcance

- Drill-down desde estas cards (spec 11).
- Tooltip/ejes del gráfico de patrimonio (mejora cosmética, queda anotada).
- Configurabilidad de ventanas (6 meses de comparativa, 14 días de próximos pagos).
