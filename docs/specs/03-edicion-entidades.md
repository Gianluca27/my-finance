# 03 — Edición de recurrentes, metas y categorías

**Esfuerzo:** S · **Dependencias:** ninguna — los tres PUT ya existen en la API

## Contexto

Tres entidades se crean pero no se pueden editar desde la web, y en los tres casos la API ya lo soporta:

- **Recurrentes**: `PUT /api/recurring/:id` es completo y recalcula `nextDueDate` si cambia el schedule (`recurring.ts:74-104`), pero la UI solo lo usa para el toggle `active` (`RecurringPage.tsx:108`). Cambiar el monto de la luz hoy = borrar y recrear.
- **Metas**: `PUT /api/goals/:id` existe (`goals.ts:77-87`), `updateGoal` está en el cliente, la web nunca lo llama.
- **Categorías**: `PUT /api/categories/:id` acepta nombre/color/ícono/tipo (`categories.ts:51-67`), sin UI.

## Alcance

- **RecurringPage**: botón lápiz por card → reutilizar el form de alta como modal de edición precargado (mismo patrón que `AddTransactionModal` con `editing`). Todos los campos: type, name, amount, frequency, dueDay, dueMonth, reminderDaysBefore, categoryId.
- **GoalsPage**: ídem — editar name, targetAmount, targetDate, icon, color. Si el nuevo `targetAmount` queda por debajo de lo ya aportado, el server debe marcar `achievedAt` (y a la inversa, si sube por encima, limpiarlo) — revisar que el PUT actual lo contemple; si no, agregarlo.
- **CategoriesPage**: botón lápiz por card → modal con name, color, icon. **No exponer cambio de `type`** aunque la API lo permita: cambiar INCOME↔EXPENSE con transacciones existentes rompe la semántica de reportes y presupuestos (anotar como restricción consciente; idealmente el server también lo rechaza si `transactionCount > 0`).

## Cambios concretos

- `apps/web/src/pages/RecurringPage.tsx` — estado `editing`, form reutilizado, submit a `updateRecurring`.
- `apps/web/src/pages/GoalsPage.tsx` — ídem con `updateGoal`.
- `apps/web/src/pages/CategoriesPage.tsx` — ídem con `updateCategory` (sin `type`).
- `apps/api/src/routes/goals.ts` — recálculo de `achievedAt` en PUT si no está.
- `apps/api/src/routes/categories.ts` — (opcional, recomendado) rechazar cambio de `type` con transacciones asociadas.

## Testing

Manual:
- Editar frequency/dueDay de un recurrente → `nextDueDate` se recalcula y el badge de vencimiento cambia coherente.
- Editar monto objetivo de una meta por debajo de lo aportado → pasa a "lograda"; subirlo de nuevo → vuelve a activa.
- Editar color/ícono de categoría → se refleja en transacciones, donut del dashboard y presupuestos (invalidar caché de esas claves).
- Intentar cambiar tipo de categoría con movimientos → rechazado con mensaje.

## Fuera de alcance

- Edición de transferencias (spec 12) y de operaciones de inversión (spec 15).
- Merge de categorías.
- Mobile (spec 18).
