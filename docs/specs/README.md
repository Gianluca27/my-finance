# Specs de mejoras — índice y orden de implementación

Specs numeradas por orden recomendado. Cada una es implementable como branch/PR independiente salvo dependencia explícita. Origen: análisis completo de la app (julio 2026) — cada spec referencia el código actual con `file:line`.

**Escala de esfuerzo:** S = horas · M = 1–3 días · L = una semana o más.

## Orden recomendado

| # | Spec | Esfuerzo | Depende de |
|---|------|----------|------------|
| **Fase 1 — deuda pendiente y riesgo** | | | |
| 01 | ✅ [Sugerencias inteligentes](01-sugerencias-inteligentes.md) — **implementado** (`ffbc542`); quedan gaps menores anotados en la spec | ~~M~~ | — |
| 02 | [Contraseña y perfil](02-gestion-contrasena-perfil.md) — cambio + reset por email | M | SendGrid |
| **Fase 2 — quick wins (API ya existe o solo frontend)** | | | |
| 03 | [Edición de entidades](03-edicion-entidades.md) — recurrentes, metas, categorías | S | — |
| 04 | [Navegación temporal](04-navegacion-temporal.md) — mes en Dashboard y Presupuestos | S | — |
| 05 | [Filtros de movimientos](05-filtros-movimientos.md) — fechas + filtros en URL | S | — |
| 06 | [Dashboard: comparativa y fixes](06-dashboard-comparativa-fixes.md) | S | — |
| **Fase 3 — calidad de datos (antes = menos datos sucios)** | | | |
| 07 | [Pago flexible de recurrentes](07-pago-flexible-recurrentes.md) — monto/cuenta/skip/historial | M | — |
| 08 | [Metas: aportes internos](08-metas-aportes-internos.md) — no ensuciar reportes + retiros | M | — |
| 09 | [Deudas fase 1](09-deudas-fase-1.md) — cuenta, historial, recordatorios | S/M | — |
| **Fase 4 — productividad y visibilidad** | | | |
| 10 | [Productividad en movimientos](10-productividad-movimientos.md) — lote, duplicar, reglas retro | M | 05 |
| 11 | [Drill-down desde Dashboard](11-drilldown-dashboard.md) | S | **05** |
| 12 | [Cuentas: archivar y reconciliar](12-cuentas-archivar-reconciliar.md) + transferencias editables | M | — |
| 13 | [Reportes](13-reportes.md) — filtros export, preview import, período unificado | M | 04 |
| **Fase 5 — inversiones y presupuestos** | | | |
| 14 | [Portafolio: curva, TIR, refresh](14-portafolio-metricas.md) | M/L | — |
| 15 | [Inversiones: renta y edición de operaciones](15-inversiones-renta.md) | M/L | 14 |
| 16 | [Presupuestos avanzados](16-presupuestos-avanzados.md) — rollover + total mensual | M | 04 |
| **Fase 6 — expansión** | | | |
| 17 | ✅ [Deudas en cuotas](17-deudas-cuotas.md) — **implementado** (cronograma derivado, sin tabla nueva; mobile queda para la 18) | ~~M/L~~ | 09 |
| 18 | [Mobile: registro e Inversiones](18-mobile-paridad.md) | L | 14/15 |
| 19 | ✅ [Multi-moneda](19-multi-moneda.md) — **implementado** (fases A, B y C: cuentas, deudas/metas, presupuestos y reportes; paridad mobile queda para la 18, deuda anotada en la spec) | ~~L/XL~~ | 12, ideal 16 |
| 20 | [Tarjetas de crédito](20-tarjetas-credito.md) (exploratorio) | L | 19, 12 |

## Racional del orden

1. ~~**01 primero**~~ **Hecho** (commit `ffbc542`): módulo de sugerencias completo — ruta + servicio de sincronización + página `/sugerencias` con badge + chip en modales web/mobile. Gaps menores en la spec.
2. **02 ahora es lo primero pendiente**: app desplegada sin recuperación de contraseña = cuentas perdidas. Riesgo operativo, no feature.
3. **Fase 2 antes que features grandes**: cuatro specs S que en conjunto suman más valor percibido que cualquier feature L, y destraban dependencias (04 → 13/16, 05 → 10/11).
4. **Fase 3 temprano a propósito**: cada mes que pasa sin 07/08 acumula pagos de recurrentes con monto falso y aportes a metas contados como gasto — datos que después nadie corrige. 08 además **cambia números históricos visibles** (el gasto de meses con aportes baja): mejor que pase pronto.
5. **Multi-moneda (19) al final del roadmap corto**: toca todos los agregados; hacerla con 12/16 ya estables reduce el frente de conflicto. Todo lo anterior está diseñado para no estorbarla (la moneda vive en la cuenta).
6. **20 es exploratorio**: pasada de diseño previa obligatoria; no comprometerse al modelado sin resolver las preguntas abiertas de la spec.

Dentro de cada fase el orden es sugerido; entre fases 2 y 3 se puede intercalar sin riesgo.

## Convenciones al implementar

- Regla de tres ediciones para cambios de contrato: `packages/shared/src/types.ts` (+ `api.ts`) → `apps/api/src/routes/*` → clientes web/mobile (ver CLAUDE.md).
- Toda respuesta nueva de Prisma pasa por `serialize()`.
- Nueva lógica pura en `apps/api/src/lib/` lleva tests Vitest (patrón `lib/investments.test.ts`).
- Cada spec que agrega UI web y no incluye mobile lo anota en "Fuera de alcance" — la deuda de paridad se salda en la 18 y en adelante por spec.
