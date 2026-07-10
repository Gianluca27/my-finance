# 11 — Drill-down desde el Dashboard

**Esfuerzo:** S · **Dependencias:** **requiere spec 05** (filtros de Movimientos leídos de la URL)

## Contexto

El dashboard es de solo lectura: donut, leyenda de categorías, barras mensuales, anomalías y próximos pagos no enlazan a nada (`DashboardPage.tsx:366-504`). Ves "Comida 40%" y no podés ver qué transacciones lo componen. Con los filtros en URL (spec 05), cada widget puede volverse un link con filtros precargados — cero API nueva.

## Alcance

Convertir en links (o click handlers con `navigate`) hacia `/transacciones?...`:

| Widget | Destino |
|---|---|
| Segmento/leyenda del donut | `?type=EXPENSE&categoryId={id}&from={inicioMes}&to={finMes}` |
| Barra de un mes (ingresos vs gastos) | `?from={inicioMesBarra}&to={finMesBarra}` (+ `type` si se clickea la serie) |
| Categoría anómala | `?type=EXPENSE&categoryId={id}&from={inicioMes}&to={finMes}` |
| KPI Ingresos / Gastos del mes | `?type=INCOME|EXPENSE&from&to` |
| Ítem de "Próximos pagos" | `/recurrentes` (ya existe el link general; hacerlo por ítem) |
| Card de presupuesto | `?type=EXPENSE&categoryId={id}&from&to` del mes visible |

Si spec 04 (selector de mes) ya está, `from`/`to` salen del mes visible, no del actual.

Affordance: cursor pointer + hover state en todo lo clickeable (hoy nada lo indica). En el donut SVG hecho a mano, click sobre `path` con `aria-label` por categoría.

## Cambios concretos

- `apps/web/src/pages/DashboardPage.tsx` — links/navigate + estilos hover. Solo frontend.
- Verificar que `TransactionsPage` acepte `type`, `categoryId`, `from`, `to` iniciales desde URL (lo garantiza spec 05).
- `apps/web/src/pages/BudgetsPage.tsx` — mismas migas: card → movimientos de esa categoría en el mes.

## Testing

Manual:
- Click en "Comida" del donut → listado filtrado cuyo total coincide con el monto del donut.
- Click en barra de marzo → movimientos de marzo.
- Click en anomalía → movimientos que explican el pico.
- Navegación atrás vuelve al dashboard intacto (caché SWR evita recarga).

## Fuera de alcance

- Drill-down dentro de la misma página (panel lateral con transacciones sin navegar) — versión futura si la navegación resulta incómoda.
- Tooltips enriquecidos en los SVG.
