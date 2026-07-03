# Insights de gasto — diseño

## Contexto

`GET /api/dashboard` (`apps/api/src/routes/dashboard.ts`) ya calcula, para un mes dado: balance histórico, ingreso/gasto del mes, gasto por categoría, comparación de 6 meses (SQL crudo) y próximos pagos a 14 días. `DashboardPage` (web) renderiza esto en tarjeta de balance + pie chart + barra + tabla de próximos pagos.

Esta spec agrega tres insights derivados, calculados server-side y expuestos como cards nuevas en el dashboard web:

1. Proyección de gasto a fin de mes.
2. Comparación de gasto vs el mes anterior (alineada por día), total y por categoría.
3. Alertas de anomalía por categoría (gasto muy por encima de su propio promedio histórico).

## Alcance

### 1. Proyección fin de mes

`proyección = (gasto acumulado del mes actual / días transcurridos del mes) * días totales del mes`.

Si el usuario no tiene al menos 1 mes completo de historial de transacciones, `projectedMonthTotal` es `null` (no se proyecta con datos insuficientes).

### 2. Comparación vs mes anterior

Alineada por día del mes: se suma el gasto del día 1 al día N del mes actual (N = día de hoy) y se compara contra el día 1 al día N del mes anterior. N se cappea al total de días del mes anterior (para que un 31 de un mes de 31 días comparado contra febrero no se pase de rango).

Se devuelve:
- Total: `{ current, previous, deltaPercent }`.
- Por categoría: mismo shape, una entrada por categoría con gasto en cualquiera de los dos períodos.

Si no hay datos del mes anterior, la comparación se omite (`previousMonthComparison: null`).

### 3. Alertas de anomalía por categoría

Una categoría se marca como anómala si:
- Tiene **≥ 3 meses completos** de historial de gasto (meses anteriores al actual, no el mes en curso).
- El gasto del mes actual (acumulado a la fecha) es **> 1.5x** el promedio de gasto mensual de esos últimos 3 meses completos.

Categorías con menos de 3 meses de historial no se evalúan (evita falsos positivos con categorías recién creadas). Umbral (1.5x) y ventana (3 meses) son constantes hardcodeadas, no configurables — no existe pantalla de settings en la app hoy.

## Cambios concretos

- **`packages/shared/src/types.ts`** — extender `DashboardData` con:
  ```ts
  insights: {
    projectedMonthTotal: number | null;
    previousMonthComparison: {
      total: { current: number; previous: number; deltaPercent: number };
      byCategory: Array<{ categoryId: string; name: string; current: number; previous: number; deltaPercent: number }>;
    } | null;
    anomalies: Array<{ categoryId: string; name: string; currentAmount: number; avgAmount: number; percentOfAvg: number }>;
  }
  ```
- **`apps/api/src/routes/dashboard.ts`** — agregar los 3 cálculos a la respuesta del handler `GET /`, reusando el mes/rango de fechas que el endpoint ya recibe como parámetro.
- **`apps/web/src/pages/DashboardPage`** — 3 cards nuevas, junto a las existentes:
  - "Proyección fin de mes": número + texto explicativo. Si `null`, estado vacío ("necesitás más historial para proyectar").
  - "Vs. mes anterior": total + variación %, con lista de categorías con mayor delta. Si `null`, estado vacío ("sin datos del mes anterior").
  - "Alertas": lista de categorías anómalas con su % sobre el promedio. Si vacía, estado neutral ("todo normal este mes").

## Flujo de datos

Sin cambios en el mecanismo de fetch: `DashboardPage` ya llama a `ApiClient.dashboard(month)`; la respuesta simplemente trae el campo `insights` adicional. No hay nuevo endpoint, no hay nueva lógica de fetch en el cliente.

## Manejo de errores

No hay casos de error nuevos más allá de los "sin datos suficientes" ya cubiertos arriba (`null` / lista vacía + estado vacío explicativo en la card correspondiente, nunca ocultar la card silenciosamente).

## Testing

No hay test suite en el repo. Verificación manual:

- Usuario con >1 mes de historial: proyección muestra un número coherente con el gasto acumulado y el día del mes.
- Usuario con <1 mes de historial: proyección en estado vacío.
- Mes actual vs anterior con datos en ambos: delta % correcto, alineado por día (no por mes completo).
- Categoría con gasto 2x su promedio de 3 meses y con ≥3 meses de historial: aparece en alertas.
- Categoría nueva (creada este mes, sin historial previo): no aparece en alertas aunque gaste mucho.
- Mes sin ninguna anomalía: card de alertas en estado neutral, no vacía/rota.

## Fuera de alcance

- Mobile (dashboard mobile es más simple hoy; se evalúa junto con la paridad general de mobile más adelante, feature separado).
- Umbral/ventana de anomalía configurable por el usuario.
- Gráfico de tendencia histórica por categoría (más allá de los números puntuales de estas cards).
