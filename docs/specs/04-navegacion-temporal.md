# 04 — Navegación temporal (selector de mes en Dashboard y Presupuestos)

**Esfuerzo:** S · **Dependencias:** ninguna — la API ya soporta `?month=` en ambos casos

## Contexto

- Dashboard: el server valida y recalcula todo para cualquier mes (`dashboard.ts:30-33`) y el cliente ya tiene la firma `dashboard(month?)`, pero la UI llama siempre sin mes (`DashboardPage.tsx:81`). El usuario está clavado al mes en curso.
- Presupuestos: `GET /api/budgets?month=YYYY-MM` funciona (`budgets.ts:22-24`), la UI siempre pide el mes actual (`BudgetsPage.tsx:17-19`).

## Alcance

### Componente compartido `MonthPicker`

Chips `‹ {mes año} ›` + botón "Hoy" cuando no se está en el mes actual. Límite hacia adelante: mes actual (no navegar al futuro). Nuevo componente en `apps/web/src/components/`.

### Dashboard

- Estado `month` (default: actual) → `api.dashboard(month)`. Clave de caché por mes (`dashboard:2026-06`), la ventana de 30 s del cache SWR ya cubre revisitas.
- Widgets que **solo tienen sentido en el mes actual** y deben ocultarse (o mostrarse en modo histórico) al navegar a un mes pasado:
  - "Proyección del mes": la barra usa el día real de hoy (`DashboardPage.tsx:133-136`) — en mes pasado no aplica; ocultar la card o mostrar solo el total real del mes.
  - "Disponible / safe-to-spend" y "Próximos pagos": son estado presente; ocultar en meses pasados.
- El resto (balance del corte, ingresos/gastos, donut, comparativa, presupuestos) ya viene calculado por mes desde el server.

### Presupuestos

- `MonthPicker` arriba de la grilla → `api.listBudgets(month)`.
- En meses pasados: solo lectura (sin form de alta/edición ni borrar — los presupuestos son configuración presente; lo que se consulta es la ejecución histórica). Banner sutil "Viendo {mes} — solo lectura".
- "Disponible por día" (`BudgetsPage.tsx:27-30`) solo aplica al mes actual; en históricos mostrar gastado vs límite final.

## Cambios concretos

- `apps/web/src/components/MonthPicker.tsx` — nuevo.
- `apps/web/src/pages/DashboardPage.tsx` — estado month, condicionales de cards presentes-only.
- `apps/web/src/pages/BudgetsPage.tsx` — estado month + modo solo lectura.
- Sin cambios de API ni de shared.

## Testing

Manual:
- Navegar 3 meses atrás en dashboard: KPIs y donut cambian, proyección/disponible/próximos pagos desaparecen, "Hoy" vuelve al presente.
- Mes sin datos → cards en estado vacío, sin NaN.
- Presupuestos de mes pasado: barras con el gasto real de ese mes, sin botones de edición.
- Volver al mes actual restaura todo el comportamiento actual.

## Fuera de alcance

- Selector de rango arbitrario (solo mes calendario, que es la unidad de toda la API).
- Deep-link `?mes=` en URL (nice-to-have, se puede sumar en spec 11 junto al drill-down).
- Reportes (su unificación de período va en spec 13).
