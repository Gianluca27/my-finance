# Búsqueda en transacciones — diseño

## Contexto

`TransactionsPage` (web) ya tiene una toolbar de filtros (tipo, categoría, rango de fechas) sobre `GET /api/transactions`, paginado server-side. No existe forma de buscar por texto libre. Esta spec agrega un campo de búsqueda a esa misma toolbar.

Mobile queda fuera de alcance: hoy no tiene ninguna UI de filtros (solo trae las últimas 50 transacciones), así que agregarle búsqueda implicaría construir infraestructura de filtros desde cero. Eso se aborda en un feature separado (paridad mobile), no acá.

## Alcance

El texto libre matchea contra dos campos, combinados con OR:

1. **`note`** — substring, case-insensitive (`contains`).
2. **`amount`** — match exacto, solo si el texto ingresado parsea como número válido (acepta decimales, ej. "1500" o "1500.50").

Categoría queda explícitamente afuera del matching de texto: ya existe un filtro dedicado por categoría en la misma toolbar, agregarlo a la búsqueda libre sería redundante.

El resultado de búsqueda se combina con **AND** al resto de los filtros activos (tipo/categoría/fecha) — no los reemplaza.

## Cambios concretos

- **`packages/shared/src/types.ts`** — agregar `search?: string` al tipo de filtros de transacciones (el que usa `ApiClient.transactions(...)` / `GET /api/transactions`).
- **`packages/shared/src/api.ts`** — pasar `search` como query param en el método correspondiente de `ApiClient`.
- **`apps/api/src/routes/transactions.ts`** — extender el `where` de Prisma en el handler de `GET /`:
  - Si `search` viene y parsea como número: `OR: [{ note: { contains: search, mode: 'insensitive' } }, { amount: parsedNumber }]`.
  - Si `search` viene y NO parsea como número: solo `{ note: { contains: search, mode: 'insensitive' } }`.
  - Si `search` no viene: sin cambios (comportamiento actual).
- **`apps/web/src/pages/TransactionsPage`** — input de texto en la toolbar de filtros existente. Debounce ~350ms antes de disparar el refetch (los filtros actuales son select/date, disparan al toque; texto libre necesita debounce para no bombardear la API en cada tecla).

## Flujo de datos

Usuario tipea → debounce 350ms → se arma el mismo objeto de filtros que ya usa la toolbar (tipo/categoría/fecha) + `search` → `ApiClient` hace `GET /api/transactions?...&search=...` → Prisma arma el `where` con los filtros existentes + el bloque OR de búsqueda → resultado paginado reemplaza la tabla. Mismo mecanismo de fetch/paginación que ya existe, sin cambios en la forma de la respuesta.

## Manejo de errores

No hay casos de error nuevos. Sin resultados: la tabla debe mostrar un empty-state ("no hay resultados"); si no existe ya uno para el caso de filtros sin coincidencias, agregar uno chico como parte de este cambio.

## Testing

No hay test suite en el repo (confirmado, no hay `*.test.*`/`*.spec.*`). Verificación manual:

- Buscar substring parcial de una nota existente → aparece esa transacción.
- Buscar un monto exacto (ej. "1500") → aparecen transacciones con ese monto, sin importar la nota.
- Buscar un monto que no exista → tabla vacía con empty-state.
- Combinar búsqueda con filtro de tipo/categoría/fecha ya activos → resultado respeta ambos.
- Limpiar el campo de búsqueda (string vacío) → vuelve al comportamiento actual (solo filtros existentes).

## Fuera de alcance

- Mobile (ver Contexto).
- Búsqueda por nombre de categoría (ya cubierta por el filtro de categoría existente).
- Rangos de monto (ej. "entre 1000 y 2000") — solo match exacto.
- Sintaxis de búsqueda avanzada (operadores, comillas, etc.).
