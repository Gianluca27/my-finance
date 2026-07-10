# 05 — Movimientos: filtro por fechas y filtros en URL

**Esfuerzo:** S · **Dependencias:** ninguna · **Habilita:** spec 11 (drill-down)

## Contexto

- El listado soporta `from`/`to` en el server (`filtersSchema`, `transactions.ts:24-33, 57-59`) pero `TransactionsPage` nunca los envía: no hay date pickers.
- Bug: la búsqueda de la topbar navega a `/transacciones?q=...`, pero la página lee `q` solo como estado inicial (`useState(initialQuery)`, `TransactionsPage.tsx:55-56`). Si ya estás en la página, la URL cambia y el filtro no reacciona.
- Los filtros (tipo, categoría, cuenta, búsqueda) viven solo en estado local: no son compartibles ni enlazables — lo que bloquea el drill-down desde el dashboard.

## Alcance

### 1. Filtro por rango de fechas

- Dos inputs `date` (desde/hasta) + chips rápidos: "Este mes", "Mes pasado", "Últimos 30 días", "Todo". Enviar `from`/`to` al endpoint existente.
- Chip activo visible y limpiable.

### 2. Filtros sincronizados con la URL

- Todos los filtros (`q`, `type`, `categoryId`, `accountId`, `from`, `to`, `page`) se reflejan en query params y se leen de ellos con un `useEffect` sobre `useSearchParams` — única fuente de verdad la URL.
- Esto arregla de paso el bug de la topbar (la página reacciona a cambios de `?q=`) y hace que atrás/adelante del navegador funcione sobre filtros.

## Cambios concretos

- `apps/web/src/pages/TransactionsPage.tsx` — date pickers + chips, migrar estado de filtros a `searchParams` (leer con efecto, escribir con `setSearchParams` replace para no ensuciar el historial en cada tecla; mantener el debounce de 350 ms para `q`).
- Sin cambios de API ni de shared (`TransactionFilters` ya modela `from`/`to`).

## Testing

Manual:
- Filtrar "Mes pasado" → el server recibe from/to correctos (verificar conteo contra Reportes CSV del mismo rango).
- Buscar desde la topbar estando ya en `/transacciones` → la lista se actualiza.
- Copiar URL con filtros y abrirla en otra pestaña → misma vista.
- Combinar fecha + categoría + búsqueda → AND correcto; paginación conserva filtros.
- Botón atrás del navegador deshace el último cambio de filtro.

## Fuera de alcance

- Orden configurable (requiere `sort` en la API — hoy fijo `date desc`; anotar como mejora menor futura).
- Búsqueda por rango de montos.
- Selección múltiple y acciones en lote (spec 10).
