# 13 — Reportes: filtros en export, preview de import y período unificado

**Esfuerzo:** M · **Dependencias:** ninguna

## Contexto

- El CSV solo filtra por `from`/`to` (`reports.ts:12-15, 26-36`); no acepta tipo/categoría/cuenta aunque `TransactionFilters` ya los modela para el listado.
- El import escribe a ciegas: sin preview ni dry-run, errores capados a 10, sin deshacer (`transactions.ts:205-317`, `ReportsPage.tsx:182-233`).
- El "Resumen del mes" está clavado al mes actual mientras el selector del PDF es independiente — dos períodos distintos en la misma pantalla sin aviso (`ReportsPage.tsx:120` vs `:174`).
- El footnote hace una request paginada `pageSize:1` solo para leer un conteo (`:57-60`).

## Alcance

### 1. Filtros en export CSV

- API: `GET /api/reports/transactions.csv` acepta además `type`, `categoryId`, `accountId` (validación zod compartible con `filtersSchema` de transactions). Columna nueva `cuenta` en el CSV.
- UI: selects de tipo/categoría/cuenta junto a los date pickers existentes.

### 2. Import con preview (dry-run)

- API: `POST /api/transactions/import?dryRun=true` — parsea y valida todo el flujo actual **sin escribir**: devuelve `{ total, valid, skipped, errors, sample }` con las primeras 10 filas interpretadas (fecha, tipo, monto, categoría resuelta o "se creará/regla aplicada", nota).
- UI: al elegir archivo → dry-run automático → tabla de preview + resumen "Se importarán N, se omitirán M" + lista de errores completa con scroll (quitar el cap visual de 10) → botón "Confirmar importación" ejecuta el POST real.

### 3. Período unificado

- Un solo `MonthPicker` (componente de spec 04) al tope de la página que gobierna el resumen en pantalla, el default del PDF y el footnote de conteo. El resumen usa `api.dashboard(month)` (ya soporta mes).
- El rango del CSV sigue siendo libre (from/to independientes) — es un export, no una vista.

### 4. Menores

- Estados `busy` separados para CSV y PDF (hoy comparten flag y se bloquean entre sí, `:42`).
- Footnote: derivar el conteo del dashboard data o aceptar el costo una vez por mes elegido — eliminar la request `pageSize:1` extra.
- Tras un import exitoso, disparar `api.refreshSuggestions()` e invalidar la caché `suggestions` — cierra el gap residual 1 de la spec 01 (hoy la detección solo corre al entrar a `/sugerencias` y el badge queda viejo tras importar).

## Cambios concretos

- `apps/api/src/routes/reports.ts` — filtros CSV + columna cuenta.
- `apps/api/src/routes/transactions.ts` — modo dryRun en import.
- `packages/shared/src/types.ts` + `api.ts` — params de export, `ImportPreview`.
- `apps/web/src/pages/ReportsPage.tsx` — selects, flujo preview→confirmar, MonthPicker, busy separados.

## Testing

Manual:
- CSV filtrado por categoría → filas y total coinciden con el listado filtrado igual.
- Import de archivo con errores → preview los muestra todos, nada escrito en DB; confirmar → escribe exactamente lo previsto.
- Dry-run de archivo válido → conteos idénticos al import real posterior.
- Cambiar mes en el picker → resumen, PDF y footnote se mueven juntos.
- Generar CSV y PDF simultáneos → ya no se bloquean.

## Fuera de alcance

- Mapeo de columnas configurable / otros delimitadores en el import.
- Deshacer importación (anotar: podría implementarse con un `importBatchId` en Transaction a futuro).
- Reportes programados por email.
- Preview del PDF en pantalla.
