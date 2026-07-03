# Deudas / préstamos simples — diseño

## Contexto

No existe ninguna entidad de deuda en el schema hoy (confirmado en inventario del repo). Esta spec agrega un tracker de **deuda simple sin interés**: monto total + pagos parciales hasta llegar a 0, sin cronograma de amortización ni tasa. Cubre dos casos de uso simétricos: plata que el usuario debe, y plata que le deben a él.

## Alcance

### Modelo `Debt`

Nuevo modelo en `apps/api/prisma/schema.prisma`:

- `direction: DebtDirection` — nuevo enum `{ I_OWE, OWED_TO_ME }`. **Inmutable** después de creada la deuda (no se puede editar una vez creada).
- `counterparty: string` — nombre de la persona/entidad ("Juan", "tarjeta X").
- `description: string?` — opcional.
- `totalAmount: Decimal(12,2)` — monto original de la deuda.
- `categoryId: string?` — FK a `Category`, `onDelete: SetNull` (mismo patrón que `Transaction.categoryId`).
- `settledAt: DateTime?` — se completa automáticamente cuando el saldo restante llega a 0. No se setea manualmente.
- `userId`, `createdAt` — como el resto de los modelos.

**No incluye:** interés, cronograma de cuotas, fecha límite, recordatorios. Explícitamente fuera de alcance (ver abajo).

### Saldo restante (no persistido)

`remainingBalance = totalAmount - SUM(amount de Transactions vinculadas a esta deuda)`, calculado al vuelo — mismo patrón que `Budget.spent` en `GET /api/budgets`. No se guarda como columna, evita drift entre el saldo guardado y los pagos reales.

### Integración con `Transaction`

Se agrega `debtId: string?` (FK nullable, `onDelete: SetNull`) a `Transaction`. Un pago de deuda crea una `Transaction` normal con `debtId` seteado:
- `direction = I_OWE` → `Transaction.type = EXPENSE`.
- `direction = OWED_TO_ME` → `Transaction.type = INCOME`.
- `categoryId` de la transacción = `categoryId` de la deuda (si tiene) o `null`.

Esto hace que pagar/cobrar una deuda impacte el balance general y el dashboard exactamente igual que cualquier otra transacción — no hay doble contabilidad ni un sistema paralelo.

Borrar una deuda **no borra** las transacciones vinculadas: `debtId` pasa a `null` (mismo patrón que borrar una categoría con `Transaction.categoryId`), preservando el historial real de movimientos de plata.

## Cambios concretos

- **`apps/api/prisma/schema.prisma`** — modelo `Debt`, enum `DebtDirection`, campo `debtId` en `Transaction`, migración nueva.
- **`packages/shared/src/types.ts`** — tipo `Debt` (+ `remainingBalance` calculado en la respuesta), `DebtDirection`, extender `DashboardData` con `debtsSummary`.
- **`packages/shared/src/api.ts`** — métodos CRUD de deudas + `payDebt` en `ApiClient`.
- **`apps/api/src/routes/debts.ts`** (nuevo):
  - `GET /` — lista deudas del usuario con `remainingBalance` calculado por deuda.
  - `POST /` — crear deuda.
  - `PUT /:id` — editar `totalAmount`/`counterparty`/`description`/`categoryId` (no `direction`).
  - `DELETE /:id` — borra la deuda; transacciones vinculadas quedan con `debtId = null`.
  - `POST /:id/payments` — body `{ amount }`. Valida `0 < amount <= remainingBalance` (400 si no). Crea la `Transaction` correspondiente (ver arriba). Si `remainingBalance` resultante es 0, setea `settledAt = now()`.
- **`apps/api/src/routes/dashboard.ts`** — agregar `debtsSummary: { totalIOwe: number, totalOwedToMe: number }` a la respuesta: suma de `remainingBalance` de deudas **activas** (`settledAt = null`), agrupado por `direction`.
- **`apps/web/src/pages/DebtsPage`** (nueva página, tab en el nav):
  - Lista de deudas activas: counterparty, barra de progreso (pagado/total), botón "Registrar pago" (modal con monto).
  - Form de alta: direction, counterparty, description, totalAmount, categoría (opcional).
  - Sección/toggle de deudas saldadas (historial, `settledAt != null`).
- **`apps/web/src/pages/DashboardPage`** — card nueva "Deudas": "Debés: $totalIOwe" / "Te deben: $totalOwedToMe".

## Flujo de datos

Alta: form → `POST /api/debts` → aparece en lista con `remainingBalance = totalAmount`.

Pago: modal monto → `POST /api/debts/:id/payments` → crea `Transaction` (EXPENSE o INCOME según dirección) con `debtId` → invalida cache de transacciones + deudas + dashboard (mismo mecanismo de invalidación por recurso que ya usa `cache.ts` en otras mutaciones) → lista de deudas y dashboard reflejan el nuevo saldo en el próximo fetch.

## Manejo de errores

- Pago con `amount <= 0` o `amount > remainingBalance` → 400, mensaje claro en el form.
- Intentar cambiar `direction` en `PUT /:id` → 400 (o directamente no aceptar el campo en el body de edición).
- Borrar deuda con pagos existentes → permitido, transacciones se conservan (`debtId → null`), sin error.

## Testing

No hay test suite en el repo. Verificación manual:

- Crear deuda `I_OWE`, pagar parcial → `remainingBalance` baja, aparece una `Transaction EXPENSE` con `debtId` seteado.
- Pagar el resto → `settledAt` se completa, deuda pasa a historial, no aparece más en la lista activa.
- Crear deuda `OWED_TO_ME`, cobrar → genera `Transaction INCOME`, balance general sube.
- Dashboard: `debtsSummary.totalIOwe`/`totalOwedToMe` reflejan la suma correcta de deudas activas, deudas saldadas no suman.
- Borrar deuda con pagos ya hechos → transacciones siguen existiendo, `debtId` es `null`, no se rompe nada en `TransactionsPage`.
- Intentar pagar más del saldo restante → error 400, no se crea la transacción.

## Fuera de alcance

- Interés / tasa.
- Cronograma de cuotas / amortización.
- Fecha límite y recordatorios (no se integra con el sistema de notificaciones existente).
- Mobile (gestión solo desde web, mismo patrón que budgets/recurring/categorías hoy).
- Umbral o alertas automáticas sobre deudas (más allá de mostrar los totales en el dashboard).
